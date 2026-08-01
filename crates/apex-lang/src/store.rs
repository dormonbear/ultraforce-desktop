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
    org_id: String,
    mem: HashMap<Key, Value>,
}

impl OstStore {
    pub fn new(root: impl Into<PathBuf>, org_id: impl Into<String>) -> Self {
        Self {
            root: root.into(),
            org_id: org_id.into(),
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

    /// `<root>/<org_id>/index.db`, with separators sanitized.
    fn db_path(&self) -> PathBuf {
        self.root.join(sanitize(&self.org_id)).join("index.db")
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
        let conn = db::open_apex(&path).map_err(io_err)?;
        let Some(raw) = db::read_raw(&conn, api_version, source.stem()).map_err(io_err)? else {
            return Ok(None);
        };
        let value: Value = serde_json::from_str(&raw).map_err(SfError::Parse)?;
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
            OstSource::OrgTypes => Value::Array(fetch_apex_symbols(invoker, &self.org_id).await?),
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
        let value = fetch_completions(invoker, &self.org_id, api_version).await?;
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
        let conn = db::open_apex(&path).map_err(io_err)?;
        db::delete_raw(&conn, api_version, source.stem()).map_err(io_err)
    }

    fn key(api_version: &str, source: OstSource) -> Key {
        (api_version.to_string(), source)
    }

    fn persist(&self, api_version: &str, source: OstSource, value: &Value) -> Result<(), SfError> {
        let conn = db::open_apex(&self.db_path()).map_err(io_err)?;
        let body = serde_json::to_string(value).map_err(SfError::Parse)?;
        db::write_raw(&conn, api_version, source.stem(), &body).map_err(io_err)
    }
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
    async fn a_corrupt_shared_file_falls_through_to_a_live_fetch() {
        let root = unique_root();
        let (invoker, calls) = counting_invoker();
        let dest = crate::shared_stdlib::path(&root, API);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, "{ truncated").unwrap();

        let mut store = OstStore::new(&root, "00Dorg");
        let value = store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1, "fetched rather than failed");
        assert!(value.get("publicDeclarations").is_some());
        // And the good payload replaced the corrupt file.
        assert!(crate::shared_stdlib::read(&root, API).is_some());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
