use super::deletion_tests::class;
use super::{index_org_for_target, sync_org_for_target, NamespacePolicy, SyncOutcome};
use serde_json::{json, Value};
use sf_core::{runner::MockRunner, RawOutput, SfInvoker};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[tokio::test]
async fn full_and_delta_keep_pinned_target_separate_from_generation_identity() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("index-target-{unique}"));
    let cache_key = "metadata-context-a";
    let target = "synthetic/用户@example.invalid";
    let sync = Arc::new(AtomicBool::new(false));
    let syncing = sync.clone();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let captured = seen.clone();
    let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args: &[String]| {
        let target_pos = args.iter().position(|arg| arg == "--target-org").unwrap();
        assert_eq!(args[target_pos + 1], target);
        assert!(!args.iter().any(|arg| arg == cache_key));
        captured.lock().unwrap().push(args.to_vec());
        let command = args.join(" ");
        let delta = syncing.load(Ordering::SeqCst);
        let value = if command.contains("completions") {
            json!({"publicDeclarations":{"System":{"String":{"methods":[],"properties":[]}}}})
        } else if command.contains("SELECT Name, NamespacePrefix FROM ApexClass") {
            json!({"status":0,"result":{"records":[{"Name":"Service","NamespacePrefix":null}],"done":true,"totalSize":1}})
        } else if command.contains("ApexClass") {
            let records = if delta {
                vec![class("Service", &["NewInner"])]
            } else {
                vec![class("Service", &["OldInner"]), class("Deleted", &[])]
            };
            json!({"status":0,"result":{"totalSize":records.len(),"records":records,"done":true}})
        } else if command.contains("sobject list") {
            json!({"status":0,"result":if delta {vec!["Account"]} else {vec!["Account","Gone__c"]}})
        } else if command.contains("EntityDefinition") || command.contains("CustomField") {
            json!({"status":0,"result":{"records":[],"done":true,"totalSize":0}})
        } else if command.contains("composite") {
            let body_pos = args.iter().position(|arg| arg == "--body").unwrap();
            let body: Value = serde_json::from_str(&args[body_pos + 1]).unwrap();
            json!({"compositeResponse":body["compositeRequest"].as_array().unwrap().iter().map(|request| {
                let name = request["url"].as_str().unwrap().split('/').rev().nth(1).unwrap();
                json!({"httpStatusCode":200,"body":{"name":name,"fields":[]}})
            }).collect::<Vec<_>>()})
        } else {
            panic!("Unexpected synthetic command / 意外的合成命令: {command}");
        };
        Ok(RawOutput {
            status: 0,
            stdout: value.to_string(),
            stderr: String::new(),
        })
    })));

    index_org_for_target(
        &invoker,
        root.clone(),
        cache_key,
        target,
        "60.0",
        &NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    let (_, manifest) = apex_lang::load_snapshot(&root, cache_key, "60.0").unwrap();
    assert_eq!(manifest.org_id, cache_key);
    assert_eq!((manifest.classes, manifest.sobjects), (2, 2));
    let path = sf_schema::sqlite::db_path(&root, cache_key);
    let before_generation = {
        let conn = sf_schema::sqlite::open_readonly(&path).unwrap();
        apex_lang::db::read_meta(&conn).unwrap().unwrap().generation
    };

    sync.store(true, Ordering::SeqCst);
    let (outcome, ost) = sync_org_for_target(
        &invoker,
        root.clone(),
        cache_key,
        target,
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        SyncOutcome {
            added: 0,
            updated: 1,
            removed: 2
        }
    );
    assert!(ost.org_types.iter().any(|ty| ty.name == "NewInner"));
    for name in ["Deleted", "OldInner", "Gone__c"] {
        assert!(!ost.org_types.iter().any(|ty| ty.name == name));
    }
    let conn = sf_schema::sqlite::open_readonly(&path).unwrap();
    let meta = apex_lang::db::read_meta(&conn).unwrap().unwrap();
    assert_eq!(meta.alias, cache_key);
    assert_eq!(meta.generation, before_generation + 1);
    drop(conn);
    assert!(!sf_schema::sqlite::db_path(&root, target).exists());

    let calls = seen.lock().unwrap().len();
    let (outcome, ost) = sync_org_for_target(
        &invoker,
        root.clone(),
        "metadata-context-b",
        target,
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(outcome, SyncOutcome::default());
    assert!(ost.org_types.is_empty());
    assert_eq!(seen.lock().unwrap().len(), calls);
    assert!(!sf_schema::sqlite::db_path(&root, "metadata-context-b").exists());
    std::fs::remove_dir_all(root).unwrap();
}
