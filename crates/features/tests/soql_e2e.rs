//! Gated end-to-end test that hits a live org. Run with `--ignored`.

use features::soql::{run_query, FieldValue};
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn run_query_against_live_org() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    let result = run_query(&invoker, "SELECT Id, Name FROM Account LIMIT 1", None)
        .await
        .expect("query should succeed against the default org");

    assert_eq!(result.records.len(), 1, "expected exactly one record");

    let record = &result.records[0];
    let has_scalar = record.fields.iter().any(|(name, value)| {
        (name == "Id" || name == "Name")
            && matches!(value, FieldValue::Scalar(serde_json::Value::String(s)) if !s.is_empty())
    });
    assert!(
        has_scalar,
        "record0 should have a non-empty Id or Name scalar: {record:?}"
    );
}
