//! Live-org e2e. Excluded from the normal suite; run with `--ignored`.

use sf_core::{ProcessRunner, SfInvoker};
use sf_schema::describe_object;
use std::sync::Arc;

#[ignore = "hits the live org; run with --ignored"]
#[tokio::test]
async fn describe_account_against_live_org() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    let schema = describe_object(&invoker, "Account")
        .await
        .expect("describe Account");

    assert!(
        schema.fields.len() > 100,
        "expected >100 fields, got {}",
        schema.fields.len()
    );

    let owner = schema
        .field("Owner")
        .or_else(|| schema.field("OwnerId"))
        .expect("Owner reference field present");
    assert!(
        owner.reference_to.iter().any(|r| r == "User"),
        "Owner should reference User, got {:?}",
        owner.reference_to
    );

    assert!(
        schema
            .fields
            .iter()
            .any(|f| !f.picklist_values.is_empty()),
        "at least one field should have picklist values"
    );
}
