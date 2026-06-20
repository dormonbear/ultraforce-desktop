//! Gated end-to-end test against a real org's Account schema.
//!
//! Run with: `cargo test -p soql-lang --test e2e -- --ignored`.

use std::sync::Arc;

use sf_core::{ProcessRunner, SfInvoker};
use soql_lang::{complete, diagnostics, Severity};

#[tokio::test]
#[ignore]
async fn completion_and_diagnostics_against_real_account() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    let schema = sf_schema::describe_object(&invoker, "Account")
        .await
        .expect("describe Account");

    let input = "SELECT Nam FROM Account";
    let cursor = "SELECT Nam".len();
    let labels: Vec<String> = complete(input, cursor, &schema, &[])
        .into_iter()
        .map(|c| c.label)
        .collect();
    assert!(
        labels.contains(&"Name".to_string()),
        "expected a Name candidate, got {labels:?}"
    );

    let diags = diagnostics("SELECT NotARealField123 FROM Account", &schema);
    assert_eq!(diags.len(), 1, "expected exactly one diagnostic");
    assert_eq!(diags[0].severity, Severity::Error);
}
