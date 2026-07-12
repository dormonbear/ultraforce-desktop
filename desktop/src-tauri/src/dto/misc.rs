//! Cross-cutting DTOs that don't belong to a single feature domain: org list,
//! index lifecycle events/status, Apex source & run outcome, and `sf` CLI status.

use sf_core::OrgRef;

/// One Salesforce org entry handed to the frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgDto {
    pub username: String,
    pub alias: Option<String>,
    pub instance_url: Option<String>,
    pub is_default: bool,
}

impl From<&OrgRef> for OrgDto {
    fn from(o: &OrgRef) -> Self {
        OrgDto {
            username: o.username.clone(),
            alias: o.alias.clone(),
            instance_url: o.instance_url.clone(),
            is_default: o.is_default,
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgressDto {
    pub org: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultDto {
    pub org: String,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
}

/// Queryable index-lifecycle snapshot for one org, returned by `index_status` so
/// a late-mounting progress indicator can seed its state instead of relying on
/// having caught the `index-progress` event stream.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusDto {
    pub org: String,
    /// One of `idle` | `indexing` | `ready` | `error`.
    pub state: String,
    /// Current phase while `indexing` (else `None`).
    pub phase: Option<String>,
    pub done: Option<usize>,
    pub total: Option<usize>,
    /// Epoch millis of the last successful index (else `None`).
    pub last_indexed: Option<i64>,
    /// Human-readable message while `error` (else `None`).
    pub error: Option<String>,
}

/// Source code (read-only) for an Apex class or trigger, for "jump to source".
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexSourceDto {
    pub name: String,
    pub kind: String,
    pub body: String,
}

/// Result of one anonymous-Apex run, flattened for the frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexOutcomeDto {
    pub compiled: bool,
    pub success: bool,
    pub compile_problem: Option<String>,
    pub exception_message: Option<String>,
    pub exception_stack_trace: Option<String>,
    pub line: Option<i64>,
    pub column: Option<i64>,
    pub logs: String,
}

/// Classified health of the `sf` CLI, so the UI can give the right guidance:
/// install it, upgrade it, or fix a PATH problem — instead of a bare error.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfStatusDto {
    /// "ok" | "outdated" | "not_found" | "path_issue"
    pub state: &'static str,
    /// Raw `sf --version` output when the CLI was found.
    pub version: Option<String>,
    /// Minimum version Ultraforce supports, e.g. "2.0.0".
    pub min_version: String,
    /// Where a login-shell probe found `sf` when it isn't on the app's PATH.
    pub found_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn org_dto_maps_from_org_ref() {
        let r = sf_core::OrgRef {
            username: "me@x.com".into(),
            alias: Some("dev".into()),
            instance_url: Some("https://x.my".into()),
            is_default: true,
        };
        let d = OrgDto::from(&r);
        assert_eq!(d.username, "me@x.com");
        assert_eq!(d.alias.as_deref(), Some("dev"));
        assert!(d.is_default);
    }
}
