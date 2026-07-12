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

fn overrides() -> &'static Mutex<HashMap<String, String>> {
    static O: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    O.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Set (or clear, with `None`) a per-org API-version override sourced from the
/// user's per-org config. When present, [`api_version_for`] returns it verbatim
/// instead of detecting via `sf org display`, so the whole downstream chain
/// (index / SOQL / Apex / log REST URLs) inherits the effective version. The
/// composition root (src-tauri) reads the store and calls this on org switch and
/// before each index run.
pub fn set_api_version_override(org: &str, version: Option<String>) {
    let mut m = overrides().lock().unwrap();
    match version {
        Some(v) => {
            m.insert(org.to_string(), v);
        }
        None => {
            m.remove(org);
        }
    }
}

/// Effective API version for `org`: the per-org override when set, else the
/// detected value. This is the single resolution entry the downstream chain uses.
pub async fn api_version_for(invoker: &SfInvoker, org: &str) -> String {
    if let Some(v) = overrides().lock().unwrap().get(org).cloned() {
        return v;
    }
    detected_api_version_for(invoker, org).await
}

/// The org's *detected* API version (a username/alias, or `"default"`), ignoring
/// any override. Detected once per org via `sf org display`, then cached
/// process-wide; `"60.0"` on any failure. Used for the config edit-panel
/// placeholder, which shows the baseline the user would get without an override.
/// ponytail: failures are NOT cached, so a transient error retries next call.
pub async fn detected_api_version_for(invoker: &SfInvoker, org: &str) -> String {
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

    #[tokio::test]
    async fn override_wins_over_detected_and_clears() {
        // Detection would return 67.0, but the override must take precedence.
        let json = r#"{"status":0,"result":{"apiVersion":"67.0"}}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let org = "unique-org-override@x.com";
        set_api_version_override(org, Some("58.0".to_string()));
        assert_eq!(api_version_for(&invoker, org).await, "58.0");
        // Detected path still reports the real dynamic version (for placeholders).
        assert_eq!(detected_api_version_for(&invoker, org).await, "67.0");
        // Clearing the override falls back to detected.
        set_api_version_override(org, None);
        assert_eq!(api_version_for(&invoker, org).await, "67.0");
    }
}
