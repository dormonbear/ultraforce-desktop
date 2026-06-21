//! Pulls object describes from the live org via sf-core.

use crate::model::SObjectSchema;
use sf_core::{SfError, SfInvoker};
use std::time::Duration;

/// Describe a single object: `sf sobject describe -s <object> --json`.
pub async fn describe_object(invoker: &SfInvoker, object: &str) -> Result<SObjectSchema, SfError> {
    invoker
        .run_json(&["sobject", "describe", "-s", object])
        .await
}

/// Salesforce composite hard limit: max subrequests per call.
const COMPOSITE_MAX: usize = 25;
/// Composite describes are larger than a single describe; give them headroom.
const DESCRIBE_BATCH_TIMEOUT: Duration = Duration::from_secs(180);

/// Append `--target-org <org>` unless `org` is empty or the "default" sentinel.
fn with_target<'a>(mut args: Vec<&'a str>, org: &'a str) -> Vec<&'a str> {
    if !org.is_empty() && org != "default" {
        args.push("--target-org");
        args.push(org);
    }
    args
}

/// Build a composite request describing each name via a GET subrequest.
pub fn build_composite_request(api_version: &str, names: &[String]) -> serde_json::Value {
    let subrequests: Vec<serde_json::Value> = names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            serde_json::json!({
                "method": "GET",
                "url": format!("/services/data/v{api_version}/sobjects/{name}/describe"),
                "referenceId": format!("r{i}"),
            })
        })
        .collect();
    serde_json::json!({ "compositeRequest": subrequests })
}

/// Parse a composite response, keeping only `httpStatusCode == 200` bodies.
/// Each describe body carries its own `name`, so no referenceId remap is needed.
pub fn parse_composite_response(raw: &str) -> Vec<SObjectSchema> {
    #[derive(serde::Deserialize)]
    struct Envelope {
        #[serde(default, rename = "compositeResponse")]
        composite_response: Vec<SubResponse>,
    }
    #[derive(serde::Deserialize)]
    struct SubResponse {
        #[serde(default, rename = "httpStatusCode")]
        http_status_code: u16,
        #[serde(default)]
        body: Option<serde_json::Value>,
    }
    let env: Envelope = match serde_json::from_str(raw) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    env.composite_response
        .into_iter()
        .filter(|r| r.http_status_code == 200)
        .filter_map(|r| r.body)
        .filter_map(|b| serde_json::from_value::<SObjectSchema>(b).ok())
        .collect()
}

/// Describe up to `COMPOSITE_MAX` objects in one composite call (caller chunks).
/// Pinned to `org`. Returns successfully-described schemas; failures are dropped.
pub async fn describe_objects(
    invoker: &SfInvoker,
    org: &str,
    api_version: &str,
    names: &[String],
) -> Result<Vec<SObjectSchema>, SfError> {
    debug_assert!(names.len() <= COMPOSITE_MAX);
    let url = format!("/services/data/v{api_version}/composite");
    let body = build_composite_request(api_version, names).to_string();
    let args = with_target(
        vec![
            "api", "request", "rest", &url, "--method", "POST", "--body", &body,
        ],
        org,
    );
    let out = invoker
        .run_raw_with_timeout(&args, DESCRIBE_BATCH_TIMEOUT)
        .await?;
    Ok(parse_composite_response(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::{Arc, Mutex};

    const FIXTURE: &str = include_str!("../tests/fixtures/describe_account.json");

    #[tokio::test]
    async fn describe_object_parses_envelope_and_passes_args() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |_program, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: FIXTURE.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let schema = describe_object(&invoker, "Account").await.unwrap();

        assert_eq!(schema.name, "Account");
        assert_eq!(schema.fields.len(), 5);
        let owner = schema.fields.iter().find(|f| f.name == "OwnerId").unwrap();
        assert_eq!(owner.reference_to, vec!["User".to_string()]);
        assert_eq!(owner.relationship_name, Some("Owner".to_string()));
        let type_field = schema.fields.iter().find(|f| f.name == "Type").unwrap();
        assert!(!type_field.picklist_values.is_empty());
        assert_eq!(schema.child_relationships.len(), 2);

        let args = seen.lock().unwrap().clone();
        assert_eq!(args, vec!["sobject", "describe", "-s", "Account", "--json"]);
    }

    #[test]
    fn builds_composite_subrequests_with_describe_urls() {
        let names = vec!["Account".to_string(), "Contact".to_string()];
        let req = build_composite_request("60.0", &names);
        let subs = req["compositeRequest"].as_array().unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0]["method"], "GET");
        assert_eq!(
            subs[0]["url"],
            "/services/data/v60.0/sobjects/Account/describe"
        );
        assert_eq!(subs[0]["referenceId"], "r0");
        assert_eq!(subs[1]["referenceId"], "r1");
    }

    #[test]
    fn parses_only_ok_subresponses() {
        let raw = r#"{"compositeResponse":[
            {"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}},
            {"httpStatusCode":404,"referenceId":"r1","body":{"errorCode":"NOT_FOUND"}}
        ]}"#;
        let schemas = parse_composite_response(raw);
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].name, "Account");
    }

    #[test]
    fn parse_composite_response_tolerates_garbage() {
        assert!(parse_composite_response("not json").is_empty());
    }

    #[tokio::test]
    async fn describe_objects_sends_one_composite_post_with_target_org() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |_program, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}}]}"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let schemas = describe_objects(&invoker, "myorg", "60.0", &["Account".to_string()])
            .await
            .unwrap();

        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].name, "Account");
        let args = seen.lock().unwrap().clone();
        assert!(args.iter().any(|a| a.contains("composite")));
        assert!(args.contains(&"--method".to_string()));
        assert!(args.contains(&"POST".to_string()));
        assert!(args.contains(&"--target-org".to_string()));
        assert!(args.contains(&"myorg".to_string()));
    }
}
