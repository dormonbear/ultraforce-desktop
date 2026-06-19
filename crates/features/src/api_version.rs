//! Best-effort, org-keyed cache of the org's API version. Detection failures fall
//! back to `DEFAULT_API_VERSION` (no regression vs the previously hardcoded const).

use sf_core::{OrgRegistry, SfInvoker};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const DEFAULT_API_VERSION: &str = "60.0";

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static C: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// API version for `org` (a username/alias, or `"default"`). Detected once per org
/// via `sf org display`, then cached process-wide; `"60.0"` on any failure.
/// ponytail: failures are NOT cached, so a transient error retries next call.
pub async fn api_version_for(invoker: &SfInvoker, org: &str) -> String {
    if let Some(v) = cache().lock().unwrap().get(org).cloned() {
        return v;
    }
    let target = if org == "default" { None } else { Some(org) };
    match OrgRegistry::api_version(invoker, target).await {
        Ok(Some(v)) => {
            cache().lock().unwrap().insert(org.to_string(), v.clone());
            v
        }
        _ => DEFAULT_API_VERSION.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::Arc;

    #[tokio::test]
    async fn returns_detected_version() {
        let json = r#"{"status":0,"result":{"apiVersion":"67.0"}}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let v = api_version_for(&invoker, "unique-org-detected@x.com").await;
        assert_eq!(v, "67.0");
    }

    #[tokio::test]
    async fn falls_back_on_failure() {
        // MockRunner returning a non-zero / unparseable envelope -> fallback.
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":1}"#)));
        let v = api_version_for(&invoker, "unique-org-fallback@x.com").await;
        assert_eq!(v, "60.0");
    }
}
