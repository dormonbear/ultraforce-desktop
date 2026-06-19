//! Wire apex-lang completion into a stateful, org-keyed in-memory OST cache.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use apex_lang::acquire::{parse_org_types, parse_stdlib};
use apex_lang::complete::{complete as ost_complete, Candidate};
use apex_lang::store::{OstSource, OstStore};
use apex_lang::symbols::Ost;
use sf_core::{SfError, SfInvoker};

const API_VERSION: &str = "60.0";

/// Owns the assembled-OST cache (one `Arc<Ost>` per org id). The mutex guards only the
/// cheap swap of the cached pointer -- it is NEVER held across an `.await`.
pub struct ApexCompleter {
    root: PathBuf,
    cache: Mutex<Option<(String, Arc<Ost>)>>,
}

impl ApexCompleter {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            cache: Mutex::new(None),
        }
    }

    /// OST root under the OS cache dir, mirroring apex-lang's default.
    pub fn with_default_root() -> Self {
        Self::new(OstStore::default_root())
    }

    fn cached(&self, org_id: &str) -> Option<Arc<Ost>> {
        let guard = self.cache.lock().unwrap();
        match &*guard {
            Some((id, ost)) if id == org_id => Some(ost.clone()),
            _ => None,
        }
    }

    /// Build (or reuse) the OST for `org_id`, then complete at `cursor`.
    pub async fn complete(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        src: &str,
        cursor: usize,
    ) -> Result<Vec<Candidate>, SfError> {
        if let Some(ost) = self.cached(org_id) {
            return Ok(ost_complete(src, cursor, &ost));
        }
        let ost = Arc::new(self.build(invoker, org_id).await?);
        // brief lock, no await held
        *self.cache.lock().unwrap() = Some((org_id.to_string(), ost.clone()));
        Ok(ost_complete(src, cursor, &ost))
    }

    async fn build(&self, invoker: &SfInvoker, org_id: &str) -> Result<Ost, SfError> {
        // Fresh disk-backed store each rebuild; the disk cache makes repeat builds cheap.
        let mut store = OstStore::new(self.root.clone(), org_id);
        // get_or_fetch returns an OWNED Value -- do NOT add `.clone()` (clippy redundant_clone).
        let stdlib = store
            .get_or_fetch(invoker, API_VERSION, OstSource::Stdlib)
            .await?;
        let namespaces = parse_stdlib(&stdlib);
        let org_raw = store
            .get_or_fetch(invoker, API_VERSION, OstSource::OrgTypes)
            .await?;
        let records = org_raw.as_array().cloned().unwrap_or_default();
        let org_types = parse_org_types(&records);
        Ok(Ost {
            namespaces,
            org_types,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    // Minimal real-shape payloads (see apex-lang fixtures for the full shape).
    const STDLIB: &str = r#"{"publicDeclarations":{"System":{"String":{"constructors":[],"methods":[{"name":"valueOf","returnType":"String","isStatic":true,"argTypes":["Integer"],"parameters":[{"name":"i","type":"Integer"}]}],"properties":[]}}}}"#;
    const ORGTYPES: &str = r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#;

    /// Counting runner: stdlib `api request rest` (raw, NO --json) then `data query` (--json).
    fn counting(seen: Arc<AtomicUsize>) -> MockRunner {
        MockRunner::new(move |_p, args| {
            seen.fetch_add(1, Ordering::SeqCst);
            let is_completions = args.iter().any(|a| a.contains("tooling/completions"));
            let body = if is_completions { STDLIB } else { ORGTYPES };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        })
    }

    #[tokio::test]
    async fn completes_stdlib_type_and_caches() {
        let seen = Arc::new(AtomicUsize::new(0));
        let invoker = sf_core::SfInvoker::new(Arc::new(counting(seen.clone())));
        let dir = std::env::temp_dir().join(format!("apex-complete-test-{}", std::process::id()));
        let completer = ApexCompleter::new(dir.clone());

        let c1 = completer
            .complete(&invoker, "myorg", "String.va", 9)
            .await
            .unwrap();
        assert!(c1.iter().any(|c| c.label == "valueOf"), "{c1:?}");
        let calls_after_first = seen.load(Ordering::SeqCst);
        assert!(
            calls_after_first >= 2,
            "expected stdlib+orgtypes fetch, got {calls_after_first}"
        );

        // Second call, same org -> served from the in-memory Ost, no new sf calls.
        let c2 = completer
            .complete(&invoker, "myorg", "Stri", 4)
            .await
            .unwrap();
        assert!(c2.iter().any(|c| c.label == "String"), "{c2:?}");
        assert_eq!(
            seen.load(Ordering::SeqCst),
            calls_after_first,
            "second call must not re-fetch"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
