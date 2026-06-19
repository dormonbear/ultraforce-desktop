use crate::acquire::{fetch_apex_symbols, fetch_completions};
use serde_json::Value;
use sf_core::{SfError, SfInvoker};
use std::collections::HashMap;
use std::path::PathBuf;

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
        base.unwrap_or_else(std::env::temp_dir).join("sf-toolkit")
    }

    pub fn file_path(&self, api_version: &str, source: OstSource) -> PathBuf {
        self.root
            .join(sanitize(&self.org_id))
            .join(sanitize(api_version))
            .join("apex-ost")
            .join(format!("{}.json", source.stem()))
    }

    pub fn get(&self, api_version: &str, source: OstSource) -> Option<&Value> {
        self.mem.get(&Self::key(api_version, source))
    }

    pub fn load_disk(
        &mut self,
        api_version: &str,
        source: OstSource,
    ) -> Result<Option<Value>, SfError> {
        let path = self.file_path(api_version, source);
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(SfError::Spawn(e)),
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
            OstSource::Stdlib => fetch_completions(invoker, api_version).await?,
            OstSource::OrgTypes => Value::Array(fetch_apex_symbols(invoker).await?),
        };
        self.persist(api_version, source, &value)?;
        self.mem
            .insert(Self::key(api_version, source), value.clone());
        Ok(value)
    }

    pub fn invalidate(&mut self, api_version: &str, source: OstSource) -> Result<(), SfError> {
        self.mem.remove(&Self::key(api_version, source));
        let path = self.file_path(api_version, source);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(SfError::Spawn(e)),
        }
    }

    fn key(api_version: &str, source: OstSource) -> Key {
        (api_version.to_string(), source)
    }

    fn persist(&self, api_version: &str, source: OstSource, value: &Value) -> Result<(), SfError> {
        let path = self.file_path(api_version, source);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(SfError::Spawn)?;
        }
        let pretty = serde_json::to_string_pretty(value).map_err(SfError::Parse)?;
        std::fs::write(&path, pretty).map_err(SfError::Spawn)?;
        Ok(())
    }
}

fn sanitize(s: &str) -> String {
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
        assert!(!store.file_path(API, OstSource::Stdlib).exists());
        store
            .get_or_fetch(&invoker, API, OstSource::Stdlib)
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
