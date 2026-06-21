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

    /// `<root>/<org_id>/<api_version>/<object>.json`, with separators sanitized.
    fn file_path(&self, api_version: &str, object: &str) -> PathBuf {
        self.org_dir()
            .join(sanitize(api_version))
            .join(format!("{}.json", sanitize(object)))
    }

    /// `<root>/<org_id>`, with separators sanitized.
    fn org_dir(&self) -> PathBuf {
        self.root.join(sanitize(&self.org_id))
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
        let schema = describe_object(invoker, &self.org_id, object).await?;
        self.persist(api_version, object, &schema)?;
        self.mem
            .insert(Self::key(api_version, object), schema.clone());
        Ok(schema)
    }

    /// Batch variant: describe the cache-miss `names` via the Composite REST
    /// API (25 per call, up to 4 calls concurrently), persist each, and return
    /// every `(name, schema)` (cached + freshly described). `on_progress` is
    /// called with `(done, total)` after the initial cache scan and after each
    /// completed composite call. Objects that fail to describe are dropped.
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
                    let _ = self.persist(api_version, &name, &schema);
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

    /// Clear this org's in-memory and on-disk schema cache.
    ///
    /// Returns the number of cached object JSON files removed from disk.
    pub fn clear(&mut self) -> Result<usize, SfError> {
        self.mem.clear();
        let dir = self.org_dir();
        if !dir.exists() {
            return Ok(0);
        }

        let removed = count_json_files(&dir)?;
        std::fs::remove_dir_all(&dir).map_err(SfError::Spawn)?;
        Ok(removed)
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

fn count_json_files(dir: &std::path::Path) -> Result<usize, SfError> {
    let mut count = 0;
    for entry in std::fs::read_dir(dir).map_err(SfError::Spawn)? {
        let entry = entry.map_err(SfError::Spawn)?;
        let path = entry.path();
        if path.is_dir() {
            count += count_json_files(&path)?;
        } else if path.extension().is_some_and(|ext| ext == "json") {
            count += 1;
        }
    }
    Ok(count)
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

    #[tokio::test]
    async fn clear_removes_cached_objects() {
        let root = unique_root();
        let (invoker, _calls) = counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");

        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        let org_dir = root.join("00Dorg");
        assert!(org_dir.exists());

        let removed = store.clear().unwrap();

        assert!(removed >= 1, "removed {removed}");
        assert!(!org_dir.exists());
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
        assert!(root.join("00Dorg/60.0/Account.json").exists(), "persisted");

        // Second call: Account now cached in memory → no further composite call.
        let out2 = store
            .get_or_fetch_many(&invoker, API, &["Account".to_string()], &mut |_, _| {})
            .await;
        assert_eq!(out2.len(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1, "served from cache");
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn invalidate_removes_one_object_keeping_siblings() {
        let root = unique_root();
        let (invoker, _calls) = counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");
        store.get_or_fetch(&invoker, API, "Account").await.unwrap();
        store.get_or_fetch(&invoker, API, "Contact").await.unwrap();

        store.invalidate(API, "Account").unwrap();

        assert!(
            store.get(API, "Account").is_none(),
            "Account evicted from memory"
        );
        assert!(
            !root.join("00Dorg/60.0/Account.json").exists(),
            "Account file deleted"
        );
        assert!(
            root.join("00Dorg/60.0/Contact.json").exists(),
            "Contact untouched"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
