//! On-disk + in-memory cache of trimmed object schemas.

use crate::model::SObjectSchema;
use crate::puller::describe_object;
use sf_core::{SfError, SfInvoker};
use std::collections::HashMap;
use std::path::PathBuf;

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

    /// OS cache dir + `sf-toolkit`, computed lazily from the environment.
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

    fn key(api_version: &str, object: &str) -> Key {
        (api_version.to_string(), object.to_ascii_lowercase())
    }

    /// `<root>/<org_id>/<api_version>/<object>.json`, with separators sanitized.
    fn file_path(&self, api_version: &str, object: &str) -> PathBuf {
        self.root
            .join(sanitize(&self.org_id))
            .join(sanitize(api_version))
            .join(format!("{}.json", sanitize(object)))
    }

    /// Look up a schema in memory only.
    pub fn get(&self, api_version: &str, object: &str) -> Option<&SObjectSchema> {
        self.mem.get(&Self::key(api_version, object))
    }

    /// Load a schema from disk into memory. `Ok(None)` if the file is absent.
    pub fn load_disk(
        &mut self,
        api_version: &str,
        object: &str,
    ) -> Result<Option<SObjectSchema>, SfError> {
        let path = self.file_path(api_version, object);
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(SfError::Spawn(e)),
        };
        let schema: SObjectSchema = serde_json::from_str(&raw).map_err(SfError::Parse)?;
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
        let schema = describe_object(invoker, object).await?;
        self.persist(api_version, object, &schema)?;
        self.mem
            .insert(Self::key(api_version, object), schema.clone());
        Ok(schema)
    }

    /// Remove from memory and delete the on-disk file (NotFound is ignored).
    pub fn invalidate(&mut self, api_version: &str, object: &str) -> Result<(), SfError> {
        self.mem.remove(&Self::key(api_version, object));
        let path = self.file_path(api_version, object);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(SfError::Spawn(e)),
        }
    }

    fn persist(
        &self,
        api_version: &str,
        object: &str,
        schema: &SObjectSchema,
    ) -> Result<(), SfError> {
        let path = self.file_path(api_version, object);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(SfError::Spawn)?;
        }
        let pretty = serde_json::to_string_pretty(schema).map_err(SfError::Parse)?;
        std::fs::write(&path, pretty).map_err(SfError::Spawn)?;
        Ok(())
    }
}

/// Replace path separators so org_id / object can't escape the cache root.
fn sanitize(s: &str) -> String {
    s.replace(['/', '\\'], "_")
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
        let path = store.file_path(API, "Account");
        assert!(!path.exists());

        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
