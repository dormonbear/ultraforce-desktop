//! SOQL query plan (EXPLAIN): cost / cardinality / leading-operation per plan,
//! fetched from the REST `?explain=` endpoint. Mirrors the reference plugin's `SoqlExplainResponse`
//! (`plans[]` with `leadingOperationType`, `relativeCost`, `sobjectCardinality`,
//! `cardinality`, `notes`) so the UI can flag non-selective queries before they run.

use crate::api_version::api_version_for;
use serde::{Deserialize, Serialize};
use sf_core::{SfError, SfInvoker};

/// The full explain response: one [`PlanRow`] per candidate execution plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct QueryPlan {
    #[serde(default)]
    pub plans: Vec<PlanRow>,
    #[serde(default)]
    pub source_query: String,
}

/// A single candidate plan. `relative_cost > 1.0` means the optimizer expects a
/// non-selective query (Salesforce's own threshold).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct PlanRow {
    #[serde(default)]
    pub cardinality: i64,
    #[serde(default)]
    pub leading_operation_type: String,
    #[serde(default)]
    pub relative_cost: f64,
    #[serde(default)]
    pub sobject_cardinality: i64,
    #[serde(default)]
    pub sobject_type: String,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub notes: Vec<PlanNote>,
}

/// An optimizer note (e.g. "not selective", "consider an index").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct PlanNote {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub table_enum_or_id: String,
}

/// Percent-encode for the `explain` query-string value — encodes every byte
/// that isn't an RFC 3986 unreserved character.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Fetch the query plan for `soql` via `sf api request rest .../query/?explain=…`.
///
/// `sf api request rest` prints the raw API response body to stdout (CLI warnings
/// go to stderr), so the body parses directly into [`QueryPlan`].
pub async fn query_plan(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
) -> Result<QueryPlan, SfError> {
    let api = api_version_for(invoker, target_org.unwrap_or("default")).await;
    let url = format!(
        "/services/data/v{api}/query/?explain={}",
        percent_encode(soql.trim())
    );
    let mut args = vec!["api", "request", "rest", url.as_str()];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    let out = invoker.run_raw(&args).await?;
    if out.status != 0 {
        return Err(SfError::Command {
            status: out.status,
            name: "ExplainFailed".to_string(),
            message: if out.stderr.is_empty() {
                out.stdout.clone()
            } else {
                out.stderr.clone()
            },
        });
    }
    serde_json::from_str(&out.stdout).map_err(SfError::Parse)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::{Arc, Mutex};

    const PLAN_BODY: &str = r#"{
        "plans":[
            {"cardinality":1000,"fields":["Id"],"leadingOperationType":"TableScan",
             "notes":[{"description":"not selective","fields":[],"tableEnumOrId":"Account"}],
             "relativeCost":2.8,"sobjectCardinality":1000,"sobjectType":"Account"}
        ],
        "sourceQuery":"SELECT Id FROM Account"
    }"#;

    /// Mock that answers the `org display` (api-version) probe and the
    /// `api request rest` explain call, capturing the latter's args.
    fn explain_mock(seen: Arc<Mutex<Vec<String>>>) -> MockRunner {
        MockRunner::new(move |_p, args| {
            let body = if args.iter().any(|a| a == "display") {
                r#"{"status":0,"result":{"apiVersion":"61.0"}}"#.to_string()
            } else {
                *seen.lock().unwrap() = args.to_vec();
                PLAN_BODY.to_string()
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body,
                stderr: String::new(),
            })
        })
    }

    #[test]
    fn percent_encode_encodes_spaces_and_commas() {
        assert_eq!(percent_encode("SELECT Id, Name"), "SELECT%20Id%2C%20Name");
        assert_eq!(percent_encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[tokio::test]
    async fn builds_explain_url_and_parses() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let invoker = SfInvoker::new(Arc::new(explain_mock(seen.clone())));

        let plan = query_plan(&invoker, "SELECT Id FROM Account", Some("uniq-plan@x.com"))
            .await
            .unwrap();

        let args = seen.lock().unwrap().clone();
        assert_eq!(&args[..3], &["api", "request", "rest"]);
        assert!(
            args[3].contains("/services/data/v61.0/query/?explain=SELECT%20Id%20FROM%20Account"),
            "url was: {}",
            args[3]
        );
        assert!(args
            .windows(2)
            .any(|w| w == ["--target-org", "uniq-plan@x.com"]));

        assert_eq!(plan.plans.len(), 1);
        let row = &plan.plans[0];
        assert_eq!(row.leading_operation_type, "TableScan");
        assert_eq!(row.relative_cost, 2.8);
        assert_eq!(row.sobject_cardinality, 1000);
        assert_eq!(row.notes[0].description, "not selective");
    }

    #[tokio::test]
    async fn non_zero_status_is_a_loud_error() {
        let runner = MockRunner::new(|_p, args| {
            let body = if args.iter().any(|a| a == "display") {
                r#"{"status":0,"result":{"apiVersion":"61.0"}}"#
            } else {
                "MALFORMED_QUERY: unexpected token"
            };
            Ok(sf_core::RawOutput {
                status: 1,
                stdout: body.to_string(),
                stderr: "MALFORMED_QUERY".to_string(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let err = query_plan(&invoker, "SELECT bogus", Some("uniq-plan-err@x.com"))
            .await
            .unwrap_err();
        assert!(matches!(err, SfError::Command { status: 1, .. }));
    }
}
