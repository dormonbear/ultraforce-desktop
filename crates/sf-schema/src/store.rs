//! On-disk (SQLite) + in-memory cache of trimmed object schemas.

use crate::model::SObjectSchema;
use crate::puller::describe_object;
use crate::sqlite;
use sf_core::{SfError, SfInvoker};
use std::collections::HashMap;
use std::path::PathBuf;

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
    org_id: String,
    mem: HashMap<Key, SObjectSchema>,
}

impl SchemaStore {
    /// Build a store rooted at an explicit cache directory.
    pub fn new(root: impl Into<PathBuf>, org_id: impl Into<String>) -> Self {
        Self {
            root: root.into(),
            org_id: org_id.into(),
            mem: HashMap::new(),
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

    /// `<root>/<org_id>/index.db`, with separators sanitized.
    fn db_path(&self) -> PathBuf {
        sqlite::db_path(&self.root, &self.org_id)
    }

    /// Look up a schema in memory only.
    pub fn get(&self, api_version: &str, object: &str) -> Option<&SObjectSchema> {
        self.mem.get(&Self::key(api_version, object))
    }

    /// Load a schema from disk into memory. `Ok(None)` if no db file or the
    /// object isn't stored.
    pub fn load_disk(
        &mut self,
        api_version: &str,
        object: &str,
    ) -> Result<Option<SObjectSchema>, SfError> {
        let path = self.db_path();
        if !path.exists() {
            return Ok(None);
        }
        let conn = sqlite::open(&path).map_err(io_err)?;
        let Some(schema) = sqlite::read_object(&conn, object).map_err(io_err)? else {
            return Ok(None);
        };
        self.mem
            .insert(Self::key(api_version, object), schema.clone());
        Ok(Some(schema))
    }

    /// Memory → disk → describe (and persist). Returns the schema.
    pub async fn get_or_fetch(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        object: &str,
    ) -> Result<SObjectSchema, SfError> {
        if let Some(s) = self.get(api_version, object) {
            return Ok(s.clone());
        }
        if let Some(s) = self.load_disk(api_version, object)? {
            return Ok(s);
        }
        let schema = describe_object(invoker, &self.org_id, object).await?;
        self.persist(&schema)?;
        self.mem
            .insert(Self::key(api_version, object), schema.clone());
        Ok(schema)
    }

    /// Batch variant: describe the cache-miss `names` via the Composite REST
    /// API (25 per call, up to 4 calls concurrently) and return every
    /// `(name, schema)` (cached + freshly described). Fills the in-memory cache
    /// but does NOT persist — the caller owns persistence so a full index can
    /// commit atomically (`persist_full`) while a delta upserts (`persist_delta`).
    /// `on_progress` is called with `(done, total)` after the initial cache scan
    /// and after each completed composite call. Objects that fail to describe
    /// are dropped.
    pub async fn get_or_fetch_many(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        names: &[String],
        on_progress: &mut (dyn FnMut(usize, usize) + Send),
    ) -> Vec<(String, SObjectSchema)> {
        let total = names.len();
        let mut out: Vec<(String, SObjectSchema)> = Vec::new();
        let mut missing: Vec<String> = Vec::new();

        for name in names {
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
                let org = self.org_id.clone();
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

    /// Persist a full generation atomically: wipe and rewrite every object in
    /// one transaction. For the full-index path, where a background reindex
    /// must never expose a partial generation to concurrent readers.
    pub fn persist_full(&self, schemas: &[SObjectSchema]) -> Result<(), SfError> {
        let mut conn = sqlite::open(&self.db_path()).map_err(io_err)?;
        sqlite::replace_all_objects(&mut conn, schemas).map_err(io_err)
    }

    /// Upsert a delta (only the changed objects) in one transaction, leaving the
    /// rest of the index intact. For the incremental `sync_org` path.
    pub fn persist_delta(&self, schemas: &[SObjectSchema]) -> Result<(), SfError> {
        let mut conn = sqlite::open(&self.db_path()).map_err(io_err)?;
        sqlite::write_objects(&mut conn, schemas).map_err(io_err)
    }

    /// Remove from memory and delete the row on disk (missing db is ignored).
    pub fn invalidate(&mut self, api_version: &str, object: &str) -> Result<(), SfError> {
        self.mem.remove(&Self::key(api_version, object));
        let path = self.db_path();
        if !path.exists() {
            return Ok(());
        }
        let conn = sqlite::open(&path).map_err(io_err)?;
        sqlite::delete_object(&conn, object).map_err(io_err)
    }

    /// Clear this org's in-memory and on-disk schema cache.
    ///
    /// Returns the number of cached objects removed from disk (before
    /// deleting `index.db` and its WAL/SHM sidecars).
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

    /// Open the db (creating it if absent) and upsert a single schema.
    fn persist(&self, schema: &SObjectSchema) -> Result<(), SfError> {
        let conn = sqlite::open(&self.db_path()).map_err(io_err)?;
        sqlite::upsert_object(&conn, schema).map_err(io_err)
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
