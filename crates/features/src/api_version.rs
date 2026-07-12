//! Best-effort, org-keyed cache of the org's API version. Detection failures fall
//! back to `DEFAULT_API_VERSION` (no regression vs the previously hardcoded const).

use sf_core::{OrgRegistry, SfInvoker};
use std::collections::HashMap;
use std::path::Path;
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
    api_version_for_checked(invoker, org).await.0
}

/// Like [`api_version_for`], but also reports whether the version was genuinely
/// resolved — an override or a successful `sf org display` detection (`true`) —
/// versus a blind fallback to `DEFAULT_API_VERSION` because detection failed
/// (`false`). Callers that key persisted state on the version (the Apex
/// snapshot, the api-version-keyed raw cache) use the flag to avoid discarding a
/// good snapshot when detection transiently fails on cold startup.
pub async fn api_version_for_checked(invoker: &SfInvoker, org: &str) -> (String, bool) {
    if let Some(v) = overrides().lock().unwrap().get(org).cloned() {
        return (v, true);
    }
    detected_api_version_checked(invoker, org).await
}

/// The org's *detected* API version (a username/alias, or `"default"`), ignoring
/// any override. Detected once per org via `sf org display`, then cached
/// process-wide; `"60.0"` on any failure. Used for the config edit-panel
/// placeholder, which shows the baseline the user would get without an override.
/// ponytail: failures are NOT cached, so a transient error retries next call.
pub async fn detected_api_version_for(invoker: &SfInvoker, org: &str) -> String {
    detected_api_version_checked(invoker, org).await.0
}

/// Resolve the API version an index/sync run (and its persisted snapshot) is
/// keyed on. Detection success or an override wins; when detection FAILS
/// (e.g. cold startup with network/auth not ready), prefer an existing
/// snapshot's stored version so the fallback default never invalidates a good
/// snapshot; with no snapshot, keep the fallback. Returns the effective
/// version plus whether it was genuinely resolved (vs fallback-or-stored).
pub async fn resolve_index_api_version(
    invoker: &SfInvoker,
    root: &Path,
    org_id: &str,
) -> (String, bool) {
    let (resolved, detected) = api_version_for_checked(invoker, org_id).await;
    if detected {
        return (resolved, true);
    }
    let snapshot = apex_lang::snapshot_api_version(root, org_id);
    tracing::warn!(
        org = %org_id,
        fallback_api = %resolved,
        snapshot_api = ?snapshot,
        "api-version detection failed; falling back"
    );
    (effective_api_version(false, resolved, snapshot), false)
}

/// Pure decision behind [`resolve_index_api_version`], unit-testable without a
/// live org: detected → resolved value; fallback + snapshot → the snapshot's
/// stored version; fallback + no snapshot → the fallback.
fn effective_api_version(detected: bool, resolved: String, snapshot: Option<String>) -> String {
    match (detected, snapshot) {
        (true, _) => resolved,
        (false, Some(stored)) => stored,
        (false, None) => resolved,
    }
}

/// [`detected_api_version_for`] plus a `detected` flag: `true` on a cache hit or
/// a successful detection, `false` when it fell back to `DEFAULT_API_VERSION`.
async fn detected_api_version_checked(invoker: &SfInvoker, org: &str) -> (String, bool) {
    if let Some(v) = cache().lock().unwrap().get(org).cloned() {
        return (v, true);
    }
    let target = if org == "default" { None } else { Some(org) };
    match OrgRegistry::api_version(invoker, target).await {
        Ok(Some(v)) => {
            cache().lock().unwrap().insert(org.to_string(), v.clone());
            (v, true)
        }
        _ => (DEFAULT_API_VERSION.to_string(), false),
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
    async fn checked_reports_detected_true_on_success_false_on_fallback() {
        let ok = SfInvoker::new(Arc::new(MockRunner::ok_json(
            r#"{"status":0,"result":{"apiVersion":"63.0"}}"#,
        )));
        assert_eq!(
            api_version_for_checked(&ok, "unique-org-checked-ok@x.com").await,
            ("63.0".to_string(), true)
        );

        let bad = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":1}"#)));
        assert_eq!(
            api_version_for_checked(&bad, "unique-org-checked-bad@x.com").await,
            ("60.0".to_string(), false)
        );
    }

    #[tokio::test]
    async fn checked_reports_override_as_detected() {
        let bad = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":1}"#)));
        let org = "unique-org-checked-override@x.com";
        set_api_version_override(org, Some("59.0".to_string()));
        // Override present → detected=true even though live detection would fail.
        assert_eq!(
            api_version_for_checked(&bad, org).await,
            ("59.0".to_string(), true)
        );
        set_api_version_override(org, None);
    }

    #[test]
    fn effective_api_version_prefers_snapshot_only_on_fallback() {
        // Detected → always use the resolved version, snapshot ignored (a genuine
        // version change must still trigger a rebuild).
        assert_eq!(
            effective_api_version(true, "63.0".into(), Some("60.0".into())),
            "63.0"
        );
        // Fallback + snapshot present → reuse the snapshot's stored version so a
        // good snapshot still loads (the bug being fixed).
        assert_eq!(
            effective_api_version(false, "60.0".into(), Some("63.0".into())),
            "63.0"
        );
        // Fallback + no snapshot → keep the fallback as before.
        assert_eq!(effective_api_version(false, "60.0".into(), None), "60.0");
    }

    #[tokio::test]
    async fn resolve_uses_snapshot_version_when_detection_fails() {
        let root = std::env::temp_dir().join(format!("resolve-fb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let m = apex_lang::IndexManifest {
            org_id: "uorg_resolve_fb".into(),
            api_version: "63.0".into(),
            indexed_at: "2026-01-01T00:00:00Z".into(),
            namespaces: 0,
            classes: 0,
            sobjects: 0,
            stdlib_error: None,
        };
        apex_lang::save_snapshot(&root, &apex_lang::Ost::default(), &m).unwrap();
        // Detection fails (non-zero envelope) → resolver must reuse the
        // snapshot's stored 63.0, not the 60.0 fallback that would reject it.
        let inv = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":1}"#)));
        assert_eq!(
            resolve_index_api_version(&inv, &root, "uorg_resolve_fb").await,
            ("63.0".to_string(), false)
        );
        // No snapshot → the fallback stands.
        assert_eq!(
            resolve_index_api_version(&inv, &root, "uorg_resolve_nosnap").await,
            ("60.0".to_string(), false)
        );
        let _ = std::fs::remove_dir_all(&root);
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
