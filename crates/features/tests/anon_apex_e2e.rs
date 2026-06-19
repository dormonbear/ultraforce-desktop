//! End-to-end test against the live default org (staging sandbox).
//! Ignored by default; run with:
//!   cargo test -p features --test anon_apex_e2e -- --ignored

use features::anon_apex::run_anon;
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; run explicitly with --ignored"]
async fn e2e_run_anon_debug() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));

    // Read-only: a single debug statement, no DML.
    let out = run_anon(&invoker, "System.debug('sf-toolkit-e2e');", None)
        .await
        .expect("sf apex run");

    assert!(out.result.compiled, "should compile");
    assert!(out.result.success, "should run successfully");
    assert!(!out.result.logs.is_empty(), "should return a debug log");
    let view = out.log_view.expect("log_view should be Some");
    assert!(view.header.is_some(), "parsed log should have a header");
    assert!(out.result.error().is_none(), "no error on success");
}
