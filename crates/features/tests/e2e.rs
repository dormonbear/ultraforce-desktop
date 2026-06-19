//! End-to-end test against the live default org (staging sandbox).
//! Ignored by default; run with: `cargo test -p features -- --ignored`.

use features::debug_log::{fetch_and_parse, list_logs};
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; run explicitly with --ignored"]
async fn e2e_list_get_parse() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));

    let logs = list_logs(&invoker).await.expect("sf apex list log");
    assert!(!logs.is_empty(), "the org should have at least one debug log");

    let view = fetch_and_parse(&invoker, &logs[0].id)
        .await
        .expect("fetch + parse the first log");
    assert!(view.header.is_some(), "parsed log should have a header");
    assert!(!view.units.is_empty(), "parsed log should have >= 1 execution unit");
}
