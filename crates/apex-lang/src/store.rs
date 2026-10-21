use crate::acquire::{fetch_apex_symbols, fetch_completions};
use crate::db;
use crate::shared_stdlib;
use serde_json::Value;
use sf_core::{SfError, SfInvoker};
use std::collections::HashMap;
use std::path::PathBuf;

/// Wrap an I/O-shaped error as `SfError::Spawn` (mirrors sf-schema's
/// fs-error convention for this store).
fn io_err(e: impl std::fmt::Display) -> SfError {
    SfError::Spawn(std::io::Error::other(e.to_string()))
}

type Key = (String, OstSource);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OstSource {
    Stdlib,
    OrgTypes,
}

impl OstSource {
    fn stem(self) -> &'static str {
        match self {
            Self::Stdlib => "stdlib",
            Self::OrgTypes => "org_types",
        }
    }
}

pub struct OstStore {
    root: PathBuf,
    cache_key: String,
    target: String,
    mem: HashMap<Key, Value>,
}

impl OstStore {
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
        }
    }

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

    /// `<root>/<cache_key>/index.db`, with separators sanitized. / 替换分隔符后的缓存数据库路径。
    fn db_path(&self) -> PathBuf {
        self.root.join(sanitize(&self.cache_key)).join("index.db")
    }

    pub fn get(&self, api_version: &str, source: OstSource) -> Option<&Value> {
        self.mem.get(&Self::key(api_version, source))
    }

    pub fn load_disk(
        &mut self,
        api_version: &str,
        source: OstSource,
    ) -> Result<Option<Value>, SfError> {
        let path = self.db_path();
        if !path.exists() {
            return Ok(None);
        }
        let conn = sf_schema::sqlite::open_readonly(&path).map_err(io_err)?;
        let has_cache: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_cache')", [], |row| row.get(0)).map_err(io_err)?;
        if !has_cache {
            return Ok(None);
        }
        let Some(raw) = db::read_raw(&conn, api_version, source.stem()).map_err(io_err)? else {
            return Ok(None);
        };
        let value: Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) if source == OstSource::Stdlib => return Ok(None),
            Err(error) => return Err(SfError::Parse(error)),
        };
        // Failed/corrupt stdlib responses are cache misses, not a reason to erase a generation.
        // 失败或损坏的标准库响应视为缓存未命中，无需删除代次。
        if source == OstSource::Stdlib && !shared_stdlib::is_usable(&value) {
            return Ok(None);
        }
        self.mem
            .insert(Self::key(api_version, source), value.clone());
        Ok(Some(value))
    }

    pub async fn get_or_fetch(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        source: OstSource,
    ) -> Result<Value, SfError> {
        if let Some(value) = self.get(api_version, source) {
            return Ok(value.clone());
        }
        if let Some(value) = self.load_disk(api_version, source)? {
            return Ok(value);
        }

        let value = match source {
            OstSource::Stdlib => self.stdlib(invoker, api_version).await?,
            OstSource::OrgTypes => Value::Array(fetch_apex_symbols(invoker, &self.target).await?),
        };
        // Also writes a shared hit into this org's `raw_cache`, so a per-org
        // snapshot stays self-contained (offline completion, MCP status).
        self.persist(api_version, source, &value)?;
        self.mem
            .insert(Self::key(api_version, source), value.clone());
        Ok(value)
    }

    /// The stdlib acquisition path: shared cache before the network, since the
    /// payload is identical for every org on this API version.
    ///
    /// A live fetch is shared only when it parses — see
    /// [`shared_stdlib::is_usable`]. The write is best-effort: failing it costs
    /// the next org a re-download, which is exactly today's behaviour.
    async fn stdlib(&self, invoker: &SfInvoker, api_version: &str) -> Result<Value, SfError> {
        if let Some(value) = shared_stdlib::read(&self.root, api_version) {
            return Ok(value);
        }
        let value = fetch_completions(invoker, &self.target, api_version).await?;
        if shared_stdlib::is_usable(&value) {
            if let Err(e) = shared_stdlib::write(&self.root, api_version, &value) {
                tracing::warn!(api = %api_version, error = %e, "shared stdlib cache write failed");
            }
        }
        Ok(value)
    }

    /// Drops this org's copy only. The shared stdlib survives on purpose: it is
    /// keyed by API version, not by org, so nothing about one org going stale
    /// makes it wrong. Clearing it means removing `<root>/_shared/stdlib/`.
    pub fn invalidate(&mut self, api_version: &str, source: OstSource) -> Result<(), SfError> {
        self.mem.remove(&Self::key(api_version, source));
        let path = self.db_path();
        if !path.exists() {
            return Ok(());
        }
        let conn = open_raw_cache(&path).map_err(io_err)?;
        db::delete_raw(&conn, api_version, source.stem()).map_err(io_err)
    }

    fn key(api_version: &str, source: OstSource) -> Key {
        (api_version.to_string(), source)
    }

    fn persist(&self, api_version: &str, source: OstSource, value: &Value) -> Result<(), SfError> {
        let conn = open_raw_cache(&self.db_path()).map_err(io_err)?;
        let body = serde_json::to_string(value).map_err(SfError::Parse)?;
        db::write_raw(&conn, api_version, source.stem(), &body).map_err(io_err)
    }
}

/// Auxiliary source caching must not initialize generation-owned schema tables.
/// 辅助源缓存不得初始化由代际发布事务管理的表。
pub(crate) fn open_raw_cache(path: &std::path::Path) -> rusqlite::Result<rusqlite::Connection> {
    let conn = sf_schema::sqlite::open_without_schema(path)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS raw_cache (api_version TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (api_version, source));")?;
    Ok(conn)
}

pub(crate) fn sanitize(s: &str) -> String {
    s.replace(['/', '\\'], "_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use sf_core::{RawOutput, SfInvoker};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    const COMPLETIONS: &str = include_str!("../tests/fixtures/completions_apex.json");
    const API: &str = "60.0";

    static ROOT_SEQ: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = ROOT_SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "apex-lang-test-{}-{}-{}",
            std::process::id(),
            nanos,
            seq
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn counting_invoker() -> (SfInvoker, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_runner = calls.clone();
        let runner = MockRunner::new(move |_, _| {
            calls_runner.fetch_add(1, Ordering::SeqCst);
            Ok(RawOutput {
                status: 0,
                stdout: COMPLETIONS.to_string(),
                stderr: String::new(),
            })
        });
        (SfInvoker::new(Arc::new(runner)), calls)
    }

    #[tokio::test]
    async fn explicit_cache_key_keeps_both_sources_on_pinned_target() {
        let root = unique_root();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = seen.clone();
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
            captured.lock().unwrap().push(args.to_vec());
            Ok(RawOutput {
                status: 0,
                stdout: if args[0] == "api" {
                    COMPLETIONS.to_string()
                } else {
                    r#"{"status":0,"result":{"records":[{"Name":"SyntheticService","SymbolTable":{"name":"SyntheticService"}}],"done":true,"totalSize":1}}"#.to_string()
                },
                stderr: String::new(),
            })
        })));
        let target = "synthetic/用户@example.invalid";
        let cache_key = "context-a";
        let mut store = OstStore::for_target(&root, cache_key, target);
        let stdlib = store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();
        let org_types = store
            .get_or_fetch(&invoker, API, OstSource::OrgTypes)
            .await
            .unwrap();
        assert_eq!(org_types[0]["Name"], "SyntheticService");
        assert!(sf_schema::sqlite::db_path(&root, cache_key).exists());
        assert!(!sf_schema::sqlite::db_path(&root, target).exists());
        for args in seen.lock().unwrap().iter() {
            let target_pos = args.iter().position(|arg| arg == "--target-org").unwrap();
            assert_eq!(args[target_pos + 1], target);
            assert!(!args.iter().any(|arg| arg == cache_key));
        }
        assert_eq!(seen.lock().unwrap().len(), 2);
        let mut reopened = OstStore::for_target(&root, cache_key, "another-logical-alias");
        assert_eq!(
            reopened.load_disk(API, OstSource::Stdlib).unwrap(),
            Some(stdlib.clone())
        );
        assert_eq!(
            reopened.load_disk(API, OstSource::OrgTypes).unwrap(),
            Some(org_types)
        );
        let mut isolated = OstStore::for_target(&root, "context-b", target);
        assert!(isolated
            .load_disk(API, OstSource::OrgTypes)
            .unwrap()
            .is_none());
        reopened.invalidate(API, OstSource::OrgTypes).unwrap();
        assert!(reopened
            .load_disk(API, OstSource::OrgTypes)
            .unwrap()
            .is_none());
        assert_eq!(
            reopened.load_disk(API, OstSource::Stdlib).unwrap(),
            Some(stdlib)
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn get_or_fetch_acquires_once_then_hits_memory() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let mut store = OstStore::new(&root, "00D/org");

        let first = store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();
        let second = store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        assert!(first.get("publicDeclarations").is_some());
        assert_eq!(first, second);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn fresh_store_loads_persisted_value_from_disk() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        {
            let mut store = OstStore::new(&root, "00Dorg");
            store
                .get_or_fetch(&invoker, API, OstSource::Stdlib)
                .await
                .unwrap();
        }

        let mut fresh = OstStore::new(&root, "00Dorg");
        let loaded = fresh.load_disk(API, OstSource::Stdlib).unwrap();

        assert!(loaded
            .as_ref()
            .and_then(|value| value.get("publicDeclarations"))
            .is_some());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn invalidate_deletes_only_the_selected_source() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let mut store = OstStore::new(&root, "00Dorg");

        store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();
        store.invalidate(API, OstSource::OrgTypes).unwrap();
        store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        store.invalidate(API, OstSource::Stdlib).unwrap();
        let mut fresh = OstStore::new(&root, "00Dorg");
        assert!(
            fresh.load_disk(API, OstSource::Stdlib).unwrap().is_none(),
            "row deleted from db"
        );
        store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        // Still 1: invalidating an org drops its copy, but the shared payload
        // is keyed by API version and stays valid. Re-downloading 18 MB because
        // one org was invalidated is the waste this cache exists to remove.
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn a_second_org_reuses_the_shared_stdlib_and_keeps_its_own_copy() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();

        let mut first = OstStore::new(&root, "00Dfirst");
        first
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        let mut second = OstStore::new(&root, "00Dsecond");
        let value = second
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1, "no second download");
        assert!(value.get("publicDeclarations").is_some());
        // The shared hit is copied into the org's own db, so its snapshot stays
        // self-contained rather than depending on the shared file surviving.
        let mut cold = OstStore::new(&root, "00Dsecond");
        assert!(cold.load_disk(API, OstSource::Stdlib).unwrap().is_some());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn invalid_org_stdlib_is_retried_without_discarding_the_published_snapshot() {
        for raw in [
            r#"{"message":"Synthetic failed response / 合成失败响应"}"#,
            "{synthetic-broken-json",
        ] {
            let root = unique_root();
            let manifest = crate::IndexManifest {
                org_id: "context-error".into(),
                api_version: API.into(),
                indexed_at: "2026-10-21T00:00:00Z".into(),
                namespaces: 0,
                classes: 0,
                sobjects: 0,
                stdlib_error: Some("Synthetic Tooling failure / 合成 Tooling 失败".into()),
            };
            crate::save_snapshot(&root, &crate::Ost::default(), &manifest).unwrap();
            let conn = open_raw_cache(&sf_schema::sqlite::db_path(&root, "context-error")).unwrap();
            db::write_raw(&conn, API, "stdlib", raw).unwrap();
            drop(conn);
            let (invoker, calls) = counting_invoker();
            let mut reopened =
                OstStore::for_target(&root, "context-error", "synthetic@example.invalid");
            let value = reopened
                .get_or_fetch(&invoker, API, OstSource::Stdlib)
                .await
                .unwrap();
            assert!(crate::shared_stdlib::is_usable(&value));
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            let (_, retained) = crate::load_snapshot(&root, "context-error", API).unwrap();
            assert_eq!(retained, manifest);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[tokio::test]
    async fn an_unusable_payload_is_never_shared() {
        let root = unique_root();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_runner = calls.clone();
        // What a managed-package org's failing Tooling endpoint returns: shaped
        // like a response, carrying no declarations.
        let runner = MockRunner::new(move |_, _| {
            calls_runner.fetch_add(1, Ordering::SeqCst);
            Ok(RawOutput {
                status: 0,
                stdout: r#"[{"message":"INVALID_SESSION_ID"}]"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let mut store = OstStore::new(&root, "00Dbroken");
        store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        assert!(
            crate::shared_stdlib::read(&root, API).is_none(),
            "a broken org must not poison every other org's cache"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn a_corrupt_shared_row_falls_through_to_a_live_fetch() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let dest = crate::shared_stdlib::path(&root, API);
        let conn = open_raw_cache(&dest).unwrap();
        db::write_raw(&conn, API, "stdlib", "{ truncated").unwrap();
        drop(conn);

        let mut store = OstStore::new(&root, "00Dorg");
        let value = store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "fetched rather than failed"
        );
        assert!(value.get("publicDeclarations").is_some());
        // The good payload repairs the corrupt row. / 有效响应修复损坏的缓存行。
        assert!(crate::shared_stdlib::read(&root, API).is_some());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn an_unreadable_shared_database_does_not_block_org_caching() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let dest = crate::shared_stdlib::path(&root, API);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, "synthetic corrupt database").unwrap();
        let mut store = OstStore::new(&root, "00Dsynthetic");
        let value = store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();
        assert!(value.get("publicDeclarations").is_some());
        drop(store);
        let mut reopened = OstStore::new(&root, "00Dsynthetic");
        assert_eq!(
            reopened
                .get_or_fetch(&invoker, API, OstSource::Stdlib)
                .await
                .unwrap(),
            value
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            std::fs::read_to_string(dest).unwrap(),
            "synthetic corrupt database"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
