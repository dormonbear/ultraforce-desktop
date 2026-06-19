//! E2E against the live default org (staging). Ignored by default.
//! Run with: `cargo test -p features --test debug_config_e2e -- --ignored`.

use features::debug_config::{get_debug_config, preset_levels, set_debug_config, LogLevel, Preset};
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; mutates TraceFlag/DebugLevel; run explicitly with --ignored"]
async fn e2e_set_then_get_roundtrips() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    set_debug_config(&invoker, &preset_levels(Preset::ApexOnly), None)
        .await
        .expect("set debug config");
    let cfg = get_debug_config(&invoker, None).await.expect("get debug config");
    assert_eq!(cfg.levels.apex_code, LogLevel::Debug);
    assert!(cfg.trace_flag_id.is_some());
}
