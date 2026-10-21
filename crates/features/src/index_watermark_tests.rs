use super::{index_org, now_iso8601, NamespacePolicy};
use sf_core::{runner::MockRunner, RawOutput, SfError, SfInvoker};
use std::sync::Arc;

fn ok(stdout: &str) -> Result<RawOutput, SfError> {
    Ok(RawOutput {
        status: 0,
        stdout: stdout.to_string(),
        stderr: String::new(),
    })
}

#[tokio::test]
async fn full_index_watermark_precedes_remote_acquisition() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("index-watermark-{unique}"));
    let observed = Arc::new(std::sync::Mutex::new(None::<String>));
    let query_started = observed.clone();
    let runner = MockRunner::new(move |_, args: &[String]| {
        let args = args.join(" ");
        if args.contains("completions") {
            ok(r#"{"publicDeclarations":{"System":{"String":{"methods":[],"properties":[]}}}}"#)
        } else if args.contains("ApexClass") {
            *query_started.lock().unwrap() = Some(now_iso8601());
            // Changes made after this read must remain eligible for delta
            // sync, even when the full index finishes in a later second.
            std::thread::sleep(std::time::Duration::from_secs(2));
            ok(r#"{"status":0,"result":{"records":[],"done":true,"totalSize":0}}"#)
        } else if args.contains("sobject list") {
            ok(r#"{"status":0,"result":[]}"#)
        } else {
            panic!("unexpected synthetic command: {args}");
        }
    });
    index_org(
        &SfInvoker::new(Arc::new(runner)),
        root.clone(),
        "SyntheticWatermark",
        "60.0",
        &NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    let (_, manifest) = apex_lang::load_snapshot(&root, "SyntheticWatermark", "60.0")
        .expect("full generation published");
    let remote_started = observed.lock().unwrap().clone().unwrap();
    std::fs::remove_dir_all(root).unwrap();
    assert!(
        manifest.indexed_at <= remote_started,
        "watermark {} skips changes after the remote read began at {}",
        manifest.indexed_at,
        remote_started
    );
}
