//! On-disk (SQLite) + in-memory cache of trimmed object schemas.

use crate::model::SObjectSchema;
use crate::puller::describe_object;
use crate::sqlite;
use sf_core::{SfError, SfInvoker};
use std::collections::HashMap;
use std::path::PathBuf;

#[path = "store_demand.rs"]
mod demand;

/// Wrap an I/O-shaped error as `SfError::Spawn` (mirrors the existing
/// fs-error convention in this store).
fn io_err(e: impl std::fmt::Display) -> SfError {
    SfError::Spawn(std::io::Error::other(e.to_string()))
}

/// In-memory key: `(api_version, lowercased object name)`.
type Key = (String, String);

/// Caches schemas in memory and on disk under a per-org/version directory.
pub struct SchemaStore {
    root: PathBuf,
    cache_key: String,
    target: String,
    mem: HashMap<Key, SObjectSchema>,
    mem_generation: Option<i64>,
}

impl SchemaStore {
    /// Build a store rooted at an explicit cache directory.
    pub fn new(root: impl Into<PathBuf>, org_id: impl Into<String>) -> Self {
        let org_id = org_id.into();
        Self::for_target(root, org_id.clone(), org_id)
    }

    /// Keep cache storage distinct from the pinned CLI target. / 缓存位置与固定的 CLI 目标分离。
    pub fn for_target(
        root: impl Into<PathBuf>,
        cache_key: impl Into<String>,
        target: impl Into<String>,
    ) -> Self {
        Self {
            root: root.into(),
            cache_key: cache_key.into(),
            target: target.into(),
            mem: HashMap::new(),
            mem_generation: None,
        }
    }

    /// OS cache dir + `ultraforce`, computed lazily from the environment.
    pub fn default_root() -> PathBuf {
        let base = if cfg!(windows) {
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        } else {
            std::env::var_os("XDG_CACHE_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        };
        base.unwrap_or_else(std::env::temp_dir).join("ultraforce")
    }

    fn key(api_version: &str, object: &str) -> Key {
        (api_version.to_string(), object.to_ascii_lowercase())
    }

    /// `<root>/<cache_key>/index.db`, with separators sanitized. / 替换分隔符后的缓存数据库路径。
    fn db_path(&self) -> PathBuf {
        sqlite::db_path(&self.root, &self.cache_key)
    }

    /// Look up a schema in memory only.
    pub fn get(&self, api_version: &str, object: &str) -> Option<&SObjectSchema> {
        self.mem.get(&Self::key(api_version, object))
    }

    fn observe_generation(&mut self, generation: Option<i64>) {
        if self.mem_generation != generation {
            self.mem.clear();
            self.mem_generation = generation;
        }
    }

    /// Read a published schema or a generation-scoped auxiliary describe into memory.
    /// 以只读方式将已发布 schema 或按代次限定的辅助 describe 载入内存。
    pub fn load_disk(
        &mut self,
        api_version: &str,
        object: &str,
    ) -> Result<Option<SObjectSchema>, SfError> {
        let path = self.db_path();
        if !path.exists() {
            return Ok(None);
        }
        let conn = sqlite::open_readonly(&path).map_err(io_err)?;
        conn.execute_batch("BEGIN").map_err(io_err)?;
        let generation = demand::generation(&conn, &self.cache_key).map_err(SfError::Spawn)?;
        self.observe_generation(generation);
        let has_objects = demand::has_table(&conn, "objects").map_err(SfError::Spawn)?;
        let schema = if has_objects {
            sqlite::read_object(&conn, object).map_err(io_err)?
        } else {
            if generation.is_some() {
                return Err(SfError::Unexpected(
                    "Published schema is incomplete; rebuild / 已发布 schema 不完整，请重建".into(),
                ));
            }
            None
        };
        let schema = match schema {
            Some(schema) => Some(schema),
            None => demand::load(&conn, api_version, object, generation).map_err(SfError::Spawn)?,
        };
        let Some(schema) = schema else {
            return Ok(None);
        };
        self.mem
            .insert(Self::key(api_version, object), schema.clone());
        Ok(Some(schema))
    }

    /// Memory → disk → describe. Auxiliary caching preserves published generations.
    /// 内存 → 磁盘 → describe；辅助缓存保留已发布代次。
    pub async fn get_or_fetch(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        object: &str,
    ) -> Result<SObjectSchema, SfError> {
        let generation =
            demand::current(&self.db_path(), &self.cache_key).map_err(SfError::Spawn)?;
        self.observe_generation(generation);
        if let Some(s) = self.get(api_version, object) {
            return Ok(s.clone());
        }
        if let Some(s) = self.load_disk(api_version, object)? {
            return Ok(s);
        }
        let schema = describe_object(invoker, &self.target, object).await?;
        if !demand::save(
            &self.db_path(),
            &self.cache_key,
            api_version,
            &schema,
            generation,
        )
        .map_err(SfError::Spawn)?
        {
            return self.load_disk(api_version, object)?.ok_or_else(|| {
                SfError::Unexpected(
                    "Index changed during describe; retry / describe 期间索引已变化，请重试".into(),
                )
            });
        }
        self.mem
            .insert(Self::key(api_version, object), schema.clone());
        Ok(schema)
    }

    /// Return cached and newly described objects using Composite REST (25 objects
    /// per call, up to four calls concurrently). Updates memory without persisting;
    /// published generations require the index publisher. Progress reports
    /// `(done, total)` after the cache scan and each call; failed objects are omitted.
    /// 通过 Composite REST 返回缓存和新描述的对象（每次 25 个对象，最多四次并发）。
    /// 仅更新内存，不持久化；已发布代次须由索引发布器写入。缓存扫描和每次调用后
    /// 报告 `(done, total)` 进度；省略描述失败的对象。
    pub async fn get_or_fetch_many(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        names: &[String],
        on_progress: &mut (dyn FnMut(usize, usize) + Send),
    ) -> Vec<(String, SObjectSchema)> {
        match demand::current(&self.db_path(), &self.cache_key) {
            Ok(generation) => self.observe_generation(generation),
            Err(_) => self.mem.clear(),
        }
        self.fetch_many_impl(invoker, api_version, names, on_progress, true)
            .await
    }

    /// Fetch a generation's describes without reading or changing the published
    /// schema cache. The caller owns atomic publication with its Apex/meta data.
    /// 获取代次所需描述，不读取或更改已发布的 schema 缓存；调用方负责与 Apex／元数据原子发布。
    pub async fn fetch_many(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        names: &[String],
        on_progress: &mut (dyn FnMut(usize, usize) + Send),
    ) -> Vec<(String, SObjectSchema)> {
        self.fetch_many_impl(invoker, api_version, names, on_progress, false)
            .await
    }

    async fn fetch_many_impl(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        names: &[String],
        on_progress: &mut (dyn FnMut(usize, usize) + Send),
        cached: bool,
    ) -> Vec<(String, SObjectSchema)> {
        let total = names.len();
        let mut out: Vec<(String, SObjectSchema)> = Vec::new();
        let mut missing: Vec<String> = Vec::new();

        for name in names {
            if !cached {
                missing.push(name.clone());
                continue;
            }
            if let Some(s) = self.get(api_version, name) {
                out.push((name.clone(), s.clone()));
            } else if let Ok(Some(s)) = self.load_disk(api_version, name) {
                out.push((name.clone(), s));
            } else {
                missing.push(name.clone());
            }
        }
        let mut done = out.len();
        on_progress(done, total);

        // Describe misses in waves of COMPOSITE_CONCURRENCY composite calls,
        // each describing up to COMPOSITE_MAX objects.
        const COMPOSITE_MAX: usize = 25;
        const COMPOSITE_CONCURRENCY: usize = 4;
        let wave = COMPOSITE_MAX * COMPOSITE_CONCURRENCY;
        for super_chunk in missing.chunks(wave) {
            let mut set: tokio::task::JoinSet<(usize, Vec<SObjectSchema>)> =
                tokio::task::JoinSet::new();
            for batch in super_chunk.chunks(COMPOSITE_MAX) {
                let invoker = invoker.clone();
                let org = self.target.clone();
                let api = api_version.to_string();
                let batch = batch.to_vec();
                set.spawn(async move {
                    let attempted = batch.len();
                    let schemas = crate::puller::describe_objects(&invoker, &org, &api, &batch)
                        .await
                        .unwrap_or_default();
                    (attempted, schemas)
                });
            }
            while let Some(res) = set.join_next().await {
                let (attempted, schemas) = res.unwrap_or_default();
                for schema in schemas {
                    let name = schema.name.clone();
                    self.mem
                        .insert(Self::key(api_version, &name), schema.clone());
                    out.push((name, schema));
                }
                done += attempted;
                on_progress(done, total);
            }
        }
        out
    }

    /// Replace an unpublished typed cache; published generations use the index publisher.
    /// 替换未发布的类型缓存；已发布代次由索引发布器管理。
    pub fn persist_full(&self, schemas: &[SObjectSchema]) -> Result<(), SfError> {
        demand::write_unpublished(&self.db_path(), &self.cache_key, schemas, true)
            .map_err(SfError::Spawn)
    }

    /// Upsert unpublished cache rows; generation deltas use the index publisher.
    /// 更新未发布缓存行；代次增量由索引发布器管理。
    pub fn persist_delta(&self, schemas: &[SObjectSchema]) -> Result<(), SfError> {
        demand::write_unpublished(&self.db_path(), &self.cache_key, schemas, false)
            .map_err(SfError::Spawn)
    }

    /// Invalidate an auxiliary/unpublished entry; published rows require index/sync.
    /// 使辅助或未发布条目失效；已发布行须通过索引或同步变更。
    pub fn invalidate(&mut self, api_version: &str, object: &str) -> Result<(), SfError> {
        self.mem.remove(&Self::key(api_version, object));
        let path = self.db_path();
        if !path.exists() {
            return Ok(());
        }
        demand::invalidate(&path, &self.cache_key, api_version, object).map_err(SfError::Spawn)
    }

    /// Clear this org's in-memory and on-disk schema cache.
    ///
    /// Returns the typed-object count; deleting the database also clears auxiliary entries.
    /// 返回类型对象数量；删除数据库时也会清除辅助条目。
    pub fn clear(&mut self) -> Result<usize, SfError> {
        self.mem.clear();
        let path = self.db_path();
        if !path.exists() {
            return Ok(0);
        }

        let removed = {
            let conn = sqlite::open(&path).map_err(io_err)?;
            sqlite::count_objects(&conn).map_err(io_err)?
        };
        std::fs::remove_file(&path).map_err(SfError::Spawn)?;
        for ext in ["-wal", "-shm"] {
            let sidecar = PathBuf::from(format!("{}{ext}", path.display()));
            let _ = std::fs::remove_file(sidecar);
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    const FIXTURE: &str = include_str!("../tests/fixtures/describe_account.json");
    const API: &str = "60.0";

    // Monotonic counter so parallel tests never share a cache root.
    static ROOT_SEQ: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = ROOT_SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "sf-schema-test-{}-{}-{}",
            std::process::id(),
            nanos,
            seq
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn counting_invoker() -> (SfInvoker, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let runner = MockRunner::new(move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: FIXTURE.to_string(),
                stderr: String::new(),
            })
        });
        (SfInvoker::new(Arc::new(runner)), calls)
    }

    #[tokio::test]
    async fn explicit_cache_key_keeps_single_and_batch_requests_on_pinned_target() {
        let root = unique_root();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = seen.clone();
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
            captured.lock().unwrap().push(args.to_vec());
            let stdout = if args[0] == "api" {
                r#"{"compositeResponse":[{"httpStatusCode":200,"body":{"name":"Contact","fields":[]}}]}"#
            } else {
                FIXTURE
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: stdout.to_string(),
                stderr: String::new(),
            })
        })));
        let target = "synthetic/用户@example.invalid";
        let cache_key = "context-a";
        let mut store = SchemaStore::for_target(&root, cache_key, target);
        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        let batch = store
            .fetch_many(&invoker, API, &["Contact".to_string()], &mut |_, _| {})
            .await;
        assert_eq!(batch.len(), 1);
        store.persist_delta(&[batch[0].1.clone()]).unwrap();
        assert!(sqlite::db_path(&root, cache_key).exists());
        assert!(!sqlite::db_path(&root, target).exists());
        for args in seen.lock().unwrap().iter() {
            let target_pos = args.iter().position(|arg| arg == "--target-org").unwrap();
            assert_eq!(args[target_pos + 1], target);
            assert!(!args.iter().any(|arg| arg == cache_key));
        }
        assert_eq!(seen.lock().unwrap().len(), 2);
        let mut reopened = SchemaStore::for_target(&root, cache_key, "another-logical-alias");
        assert!(reopened.load_disk(API, "Account").unwrap().is_some());
        assert!(reopened.load_disk(API, "Contact").unwrap().is_some());
        let mut isolated = SchemaStore::for_target(&root, "context-b", target);
        assert!(isolated.load_disk(API, "Account").unwrap().is_none());
        reopened.invalidate(API, "Account").unwrap();
        assert!(reopened.load_disk(API, "Account").unwrap().is_none());
        assert!(reopened.load_disk(API, "Contact").unwrap().is_some());
        assert_eq!(reopened.clear().unwrap(), 1);
        assert!(!sqlite::db_path(&root, cache_key).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn get_or_fetch_describes_once_then_hits_memory() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");

        let a = store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        assert_eq!(a.name, "Account");
        let b = store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        assert_eq!(b.name, "Account");

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn fresh_store_loads_persisted_schema_from_disk() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        {
            let mut store = SchemaStore::new(&root, "00Dorg");
            store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let mut fresh = SchemaStore::new(&root, "00Dorg");
        let loaded = fresh.load_disk(API, "Account").unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().name, "Account");
        // No additional runner call occurred.
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn invalidate_deletes_file_and_forces_redescribe() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");

        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        store.invalidate(API, "Account").unwrap();
        let mut fresh = SchemaStore::new(&root, "00Dorg");
        assert!(
            fresh.load_disk(API, "Account").unwrap().is_none(),
            "row deleted from db"
        );

        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn clear_removes_cached_objects() {
        let root = unique_root();
        let (invoker, _calls) = counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");

        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        let db_path = root.join("00Dorg/index.db");
        assert!(db_path.exists());

        let removed = store.clear().unwrap();

        assert!(removed >= 1, "removed {removed}");
        assert!(!db_path.exists());
        assert!(store.get(API, "Account").is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    fn composite_counting_invoker() -> (SfInvoker, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        // Any composite call returns one Account subresponse; counts each call.
        let runner = MockRunner::new(move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}}]}"#.to_string(),
                stderr: String::new(),
            })
        });
        (SfInvoker::new(Arc::new(runner)), calls)
    }

    #[tokio::test]
    async fn get_or_fetch_many_describes_misses_and_skips_cached() {
        let root = unique_root();
        let (invoker, calls) = composite_counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");

        // First call: Account is a miss → one composite call, persisted.
        let mut seen = 0usize;
        let out = store
            .get_or_fetch_many(
                &invoker,
                API,
                &["Account".to_string()],
                &mut |done, total| {
                    seen = total;
                    let _ = done;
                },
            )
            .await;
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "Account");
        assert_eq!(seen, 1, "progress total reflects requested names");
        assert_eq!(calls.load(Ordering::SeqCst), 1, "one composite call");
        // get_or_fetch_many no longer persists — the caller does.
        let mut fresh = SchemaStore::new(&root, "00Dorg");
        assert!(
            fresh.load_disk(API, "Account").unwrap().is_none(),
            "not persisted until caller persists"
        );
        let schemas: Vec<_> = out.iter().map(|(_, s)| s.clone()).collect();
        store.persist_full(&schemas).unwrap();
        let mut fresh = SchemaStore::new(&root, "00Dorg");
        assert!(
            fresh.load_disk(API, "Account").unwrap().is_some(),
            "persisted after persist_full",
        );

        // Second call: Account now cached in memory → no further composite call.
        let out2 = store
            .get_or_fetch_many(&invoker, API, &["Account".to_string()], &mut |_, _| {})
            .await;
        assert_eq!(out2.len(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1, "served from cache");
        std::fs::remove_dir_all(&root).ok();
    }

    /// Mock that echoes the requested object name as `SObjectSchema.name`
    /// (parsed from the `-s <object>` arg), so distinct objects don't
    /// collide in storage keyed by schema name.
    fn object_named_invoker() -> SfInvoker {
        let runner = MockRunner::new(|_program, args: &[String]| {
            let name = args
                .iter()
                .position(|a| a == "-s")
                .and_then(|i| args.get(i + 1))
                .cloned()
                .unwrap_or_else(|| "Account".to_string());
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: format!(
                    r#"{{"status":0,"result":{{"name":"{name}","fields":[],"childRelationships":[]}}}}"#
                ),
                stderr: String::new(),
            })
        });
        SfInvoker::new(Arc::new(runner))
    }

    #[tokio::test]
    async fn invalidate_removes_one_object_keeping_siblings() {
        let root = unique_root();
        let invoker = object_named_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");
        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        store.get_or_fetch(&invoker, API, "Contact").await.unwrap();

        store.invalidate(API, "Account").unwrap();

        assert!(
            store.get(API, "Account").is_none(),
            "Account evicted from memory"
        );
        let mut fresh = SchemaStore::new(&root, "00Dorg");
        assert!(
            fresh.load_disk(API, "Account").unwrap().is_none(),
            "Account row deleted"
        );
        assert!(
            fresh.load_disk(API, "Contact").unwrap().is_some(),
            "Contact untouched"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
