use super::*;
use sf_core::{runner::MockRunner, OrgIdentity, RawOutput};
use sf_schema::identity::lookup;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "metadata-context-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::SeqCst)
    ))
}

fn payload(id: &str, version: Option<&str>) -> String {
    serde_json::json!({"status":0,"result":{
        "id":id,"username":"synthetic@example.invalid","apiVersion":version,
        "accessToken":"SYNTHETIC_SECRET_ACCESS","refreshToken":"SYNTHETIC_SECRET_REFRESH"
    }})
    .to_string()
}

#[tokio::test]
async fn equivalent_literal_targets_share_one_context_and_require_one_display_each() {
    let root = root();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let calls = captured.clone();
    let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
        calls.lock().unwrap().push(args.to_vec());
        Ok(RawOutput {
            status: 0,
            stdout: payload("00D000000000001", Some("64.0")),
            stderr: String::new(),
        })
    })));
    let alias = "alias / 合成;&";
    let first = resolve(&invoker, &root, alias).await.unwrap();
    let second = resolve(&invoker, &root, first.binding.username())
        .await
        .unwrap();
    assert_eq!(first.binding, second.binding);
    assert_eq!(first.api_version, "64.0");
    assert!(first.api_version_detected);
    assert_eq!(
        *captured.lock().unwrap(),
        vec![
            vec!["org", "display", "--target-org", alias, "--json"],
            vec![
                "org",
                "display",
                "--target-org",
                "synthetic@example.invalid",
                "--json"
            ],
        ]
    );
    let bytes = std::fs::read(root.join("_identity/bindings.db")).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("SYNTHETIC_SECRET"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn resolution_order_is_reserved_before_cli_and_old_completion_stays_in_its_context() {
    let root = root();
    let during_cli = root.clone();
    let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, _| {
        assert_eq!(lookup(&during_cli, "moving").unwrap(), None);
        begin_resolution(&during_cli, "moving")
            .unwrap()
            .complete(&OrgIdentity {
                id: "00D000000000002".into(),
                username: "new@example.invalid".into(),
                alias: None,
                api_version: None,
            })
            .unwrap();
        Ok(RawOutput {
            status: 0,
            stdout: payload("00D000000000001", Some("60.0")),
            stderr: String::new(),
        })
    })));
    let completed = resolve(&invoker, &root, "moving").await.unwrap();
    assert_eq!(completed.binding.username(), "synthetic@example.invalid");
    let current = lookup(&root, "moving").unwrap().unwrap();
    assert_eq!(current.username(), "new@example.invalid");
    assert_ne!(current.cache_key(), completed.binding.cache_key());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn canonical_snapshot_version_and_requested_override_win_without_extra_cli_calls() {
    let root = root();
    let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(payload(
        "00D000000000001",
        None,
    ))));
    let requested = format!("override-{}", root.file_name().unwrap().to_string_lossy());
    let first = resolve(&invoker, &root, &requested).await.unwrap();
    assert_eq!(first.api_version, "60.0");
    assert!(!first.api_version_detected);
    apex_lang::save_snapshot(
        &root,
        &apex_lang::Ost::default(),
        &apex_lang::IndexManifest {
            org_id: first.binding.cache_key().into(),
            api_version: "63.0".into(),
            indexed_at: "2026-10-21T00:00:00Z".into(),
            namespaces: 0,
            classes: 0,
            sobjects: 0,
            stdlib_error: None,
        },
    )
    .unwrap();
    assert_eq!(
        apex_lang::snapshot_api_version(&root, first.binding.cache_key()),
        Some("63.0".into())
    );
    let cached = resolve(&invoker, &root, &requested).await.unwrap();
    assert_eq!(cached.binding, first.binding);
    assert_eq!(cached.api_version, "63.0");
    assert!(!cached.api_version_detected);
    crate::api_version::set_api_version_override(&requested, Some("59.0".into()));
    let configured = resolve(&invoker, &root, &requested).await.unwrap();
    crate::api_version::set_api_version_override(&requested, None);
    assert_eq!(configured.api_version, "59.0");
    assert!(configured.api_version_detected);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn failed_identity_discovery_never_fabricates_a_binding_or_reuses_legacy_snapshot() {
    let root = root();
    apex_lang::save_snapshot(
        &root,
        &apex_lang::Ost::default(),
        &apex_lang::IndexManifest {
            org_id: "unknown".into(),
            api_version: "63.0".into(),
            indexed_at: "2026-10-21T00:00:00Z".into(),
            namespaces: 0,
            classes: 0,
            sobjects: 0,
            stdlib_error: None,
        },
    )
    .unwrap();
    let path = root.join("unknown/index.db");
    let before = std::fs::read(&path).unwrap();
    let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(
        r#"{"status":1,"name":"SyntheticOffline","message":"Synthetic unavailable / 合成不可用"}"#,
    )));
    assert!(resolve(&invoker, &root, "unknown").await.is_err());
    assert_eq!(lookup(&root, "unknown").unwrap(), None);
    assert_eq!(std::fs::read(path).unwrap(), before);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn reassigned_alias_does_not_reuse_its_process_cached_api_version() {
    let root = root();
    let requested = format!("moving-{}", root.file_name().unwrap().to_string_lossy());
    let previous = begin_resolution(&root, &requested)
        .unwrap()
        .complete(&OrgIdentity {
            id: "00D000000000001".into(),
            username: "synthetic@example.invalid".into(),
            alias: None,
            api_version: None,
        })
        .unwrap();
    let calls = Arc::new(AtomicU64::new(0));
    let captured = calls.clone();
    let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, _| {
        let old = captured.fetch_add(1, Ordering::SeqCst) == 0;
        Ok(RawOutput {
            status: 0,
            stdout: payload(
                if old {
                    "00D000000000001"
                } else {
                    "00D000000000002"
                },
                Some(if old { "60.0" } else { "64.0" }),
            ),
            stderr: String::new(),
        })
    })));
    assert_eq!(
        crate::api_version::api_version_for(&invoker, &requested).await,
        "60.0"
    );
    let current = resolve(&invoker, &root, &requested).await.unwrap();
    assert_eq!(current.api_version, "64.0");
    assert!(current.api_version_detected);
    assert_ne!(current.binding.cache_key(), previous.cache_key());
    assert_eq!(lookup(&root, &requested).unwrap(), Some(current.binding));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn default_target_is_resolved_without_a_literal_default_cli_flag() {
    let root = root();
    let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
        assert_eq!(args, ["org", "display", "--json"]);
        Ok(RawOutput {
            status: 0,
            stdout: payload("00D000000000001", Some("60.0")),
            stderr: String::new(),
        })
    })));
    let context = resolve(&invoker, &root, "default").await.unwrap();
    assert_eq!(lookup(&root, "default").unwrap(), Some(context.binding));
    std::fs::remove_dir_all(root).unwrap();
}
