use super::*;
use serde_json::{json, Value};
use sf_core::{runner::MockRunner, RawOutput};
use std::sync::Arc;

pub(super) fn class(name: &str, inner: &[&str]) -> Value {
    json!({"Name":name,"NamespacePrefix":null,"SymbolTable":{"name":name,"methods":[],"properties":[],
        "innerClasses":inner.iter().map(|name| json!({"name":name,"methods":[],"properties":[]})).collect::<Vec<_>>()}})
}

pub(super) fn runner(classes: Vec<Value>, names: Vec<&str>, objects: Vec<&str>, changed: bool) -> SfInvoker {
    runner_names(
        classes,
        names
            .into_iter()
            .map(|n| json!({"Name":n,"NamespacePrefix":null}))
            .collect(),
        objects,
        changed,
    )
}

pub(super) fn runner_names(
    classes: Vec<Value>,
    names: Vec<Value>,
    objects: Vec<&str>,
    changed: bool,
) -> SfInvoker {
    let objects: Vec<String> = objects.into_iter().map(str::to_owned).collect();
    SfInvoker::new(Arc::new(MockRunner::new(move |_, args: &[String]| {
        let command = args.join(" ");
        let value = if command.contains("completions") {
            json!({"publicDeclarations":{"System":{"String":{"methods":[],"properties":[]}}}})
        } else if command.contains("SELECT Name, NamespacePrefix FROM ApexClass") {
            json!({"status":0,"result":{"records":names,"done":true,"totalSize":names.len()}})
        } else if command.contains("ApexClass") {
            json!({"status":0,"result":{"records":classes}})
        } else if command.contains("sobject list") {
            json!({"status":0,"result":objects})
        } else if command.contains("EntityDefinition") || command.contains("CustomField") {
            json!({"status":0,"result":{"records":if changed {vec![json!({"QualifiedApiName":"Account"})]} else {vec![]}}})
        } else if command.contains("composite") {
            // Each requested reference appears in the JSON argument following --body.
            let body = args
                .iter()
                .find_map(|arg| serde_json::from_str::<Value>(arg).ok())
                .expect("composite body JSON");
            json!({"compositeResponse":body["compositeRequest"].as_array().unwrap().iter().map(|req| {
                let name = req["url"].as_str().unwrap().split('/').rev().nth(1).unwrap();
                json!({"httpStatusCode":200,"referenceId":req["referenceId"],"body":{
                    "name":name,"label":name,"labelPlural":name,"fields":[],"childRelationships":[]}})
            }).collect::<Vec<_>>()})
        } else {
            panic!("unexpected synthetic command: {command}");
        };
        Ok(RawOutput {
            status: 0,
            stdout: value.to_string(),
            stderr: String::new(),
        })
    })))
}

#[tokio::test]
async fn delta_deletes_sources_and_replaces_inner_types() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("delta-provenance-{unique}"));
    let seed = runner(
        vec![
            class("Keeper", &["RetainedInner"]),
            class("Changed", &["StaleInner"]),
            class("Deleted", &["DeletedInner"]),
        ],
        vec![],
        vec!["Account", "Gone__c"],
        false,
    );
    index_org(
        &seed,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    let delta = runner(
        vec![class("Changed", &["NewInner"])],
        vec!["Keeper", "Changed"],
        vec!["Account"],
        false,
    );
    let (outcome, ost) = sync_org(
        &delta,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    for name in ["Deleted", "DeletedInner", "StaleInner", "Gone__c"] {
        assert!(
            !ost.org_types.iter().any(|ty| ty.name == name),
            "deleted source content remains: {name}"
        );
    }
    for name in ["Keeper", "RetainedInner", "Changed", "NewInner", "Account"] {
        assert!(
            ost.org_types.iter().any(|ty| ty.name == name),
            "retained source content missing: {name}"
        );
    }
    assert_eq!(
        outcome,
        SyncOutcome {
            added: 0,
            updated: 1,
            removed: 2
        }
    );
    let (persisted, manifest) = apex_lang::load_snapshot(&root, "SyntheticDelta", "60.0").unwrap();
    assert_eq!(persisted.org_types.len(), ost.org_types.len());
    assert_eq!((manifest.classes, manifest.sobjects), (2, 1));
    std::fs::remove_dir_all(root).unwrap();
}

pub(super) async fn seeded(label: &str, classes: Vec<Value>) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("delta-{label}-{unique}"));
    index_org(
        &runner(classes, vec![], vec!["Account", "Gone__c"], false),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    root
}

fn fingerprint(root: &std::path::Path) -> String {
    let conn =
        apex_lang::db::open_apex(&sf_schema::sqlite::db_path(root, "SyntheticDelta")).unwrap();
    format!(
        "{:?}|{:?}|{}|{}",
        apex_lang::db::read_meta(&conn).unwrap(),
        sf_schema::sqlite::read_all_objects(&conn).unwrap(),
        conn.query_row::<String, _, _>("SELECT body FROM apex_sources WHERE id=1", [], |r| r
            .get(0))
            .unwrap_or_default(),
        serde_json::to_string(
            &apex_lang::load_snapshot(root, "SyntheticDelta", "60.0").map(|s| s.0)
        )
        .unwrap()
    )
}

#[tokio::test]
async fn either_empty_list_suppresses_both_deletions_but_applies_changes() {
    for empty_classes in [true, false] {
        let root = seeded(
            "empty",
            vec![class("Keeper", &["Inner"]), class("Gone", &[])],
        )
        .await;
        let inv = runner(
            vec![class("Keeper", &["Replacement"]), class("Added", &[])],
            if empty_classes {
                vec![]
            } else {
                vec!["Keeper", "Added"]
            },
            if empty_classes {
                vec!["Account"]
            } else {
                vec![]
            },
            true,
        );
        let (outcome, ost) = sync_org(
            &inv,
            root.clone(),
            "SyntheticDelta",
            "60.0",
            &NamespacePolicy::All,
        )
        .await
        .unwrap();
        for name in [
            "Keeper",
            "Gone",
            "Added",
            "Replacement",
            "Account",
            "Gone__c",
        ] {
            assert!(
                ost.org_types.iter().any(|t| t.name == name),
                "guard lost {name}"
            );
        }
        assert!(
            !ost.org_types.iter().any(|t| t.name == "Inner"),
            "changed source must still replace its inner classes"
        );
        assert_eq!(
            outcome,
            SyncOutcome {
                added: 1,
                updated: 2,
                removed: 0
            }
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn recomputation_removes_inherited_members_from_deleted_parent() {
    let mut parent = class("Parent", &[]);
    parent["SymbolTable"]["methods"] =
        json!([{"name":"obsolete","returnType":"void","parameters":[]}]);
    let mut child = class("Child", &["ReferencedInner"]);
    child["SymbolTable"]["parentClass"] = json!("Parent");
    let root = seeded("inherit", vec![parent, child]).await;
    let before = apex_lang::load_snapshot(&root, "SyntheticDelta", "60.0")
        .unwrap()
        .0;
    assert!(before
        .org_types
        .iter()
        .find(|t| t.name == "Child")
        .unwrap()
        .methods
        .iter()
        .any(|m| m.name == "obsolete"));
    let (_, ost) = sync_org(
        &runner(vec![], vec!["Child"], vec!["Account", "Gone__c"], false),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    let child = ost.org_types.iter().find(|t| t.name == "Child").unwrap();
    assert_eq!(child.parent_class.as_deref(), Some("Parent"));
    assert!(!child.methods.iter().any(|m| m.name == "obsolete"));
    assert!(ost.org_types.iter().any(|t| t.name == "ReferencedInner"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn namespace_and_object_collisions_keep_independent_sources() {
    let mut a = class("Shared", &["AInner"]);
    a["NamespacePrefix"] = json!("alpha");
    let mut b = class("Shared", &["BInner"]);
    b["NamespacePrefix"] = json!("beta");
    let root = seeded("identity", vec![a, b, class("Account", &["ClassInner"])]).await;
    let inv = runner_names(
        vec![],
        vec![
            json!({"Name":"Shared","NamespacePrefix":"beta"}),
            json!({"Name":"Account","NamespacePrefix":null}),
        ],
        vec!["Gone__c"],
        false,
    );
    let (outcome, ost) = sync_org(
        &inv,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        SyncOutcome {
            added: 0,
            updated: 0,
            removed: 2
        }
    );
    assert!(!ost.org_types.iter().any(|t| t.name == "AInner"));
    for name in ["Shared", "BInner", "Account", "ClassInner", "Gone__c"] {
        assert!(ost.org_types.iter().any(|t| t.name == name));
    }
    let snapshot = apex_lang::snapshot::load_sync_snapshot(&root, "SyntheticDelta", "60.0")
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.sources.len(), 2);
    assert_eq!(snapshot.schemas.len(), 1);
    assert!(snapshot
        .sources
        .iter()
        .any(|r| r["NamespacePrefix"] == "beta"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn raw_cache_poison_does_not_replace_generation_sources() {
    let root = seeded("poison", vec![class("Keeper", &["Inner"])]).await;
    let conn =
        apex_lang::db::open_apex(&sf_schema::sqlite::db_path(&root, "SyntheticDelta")).unwrap();
    assert!(
        apex_lang::db::read_raw(&conn, "60.0", "org_types")
            .unwrap()
            .is_none(),
        "no duplicate source blob"
    );
    apex_lang::db::write_raw(&conn, "60.0", "org_types", r#"[{"Name":"Poison"}]"#).unwrap();
    let (outcome, ost) = sync_org(
        &runner(vec![], vec!["Keeper"], vec!["Account", "Gone__c"], false),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(outcome, SyncOutcome::default());
    assert!(ost.org_types.iter().any(|t| t.name == "Inner"));
    assert!(!ost.org_types.iter().any(|t| t.name == "Poison"));
    assert!(apex_lang::db::read_raw(&conn, "60.0", "org_types")
        .unwrap()
        .is_none());
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn invalid_provenance_requires_reindex_without_remote_calls() {
    for mutation in ["UPDATE meta SET schema_version=4", "DELETE FROM apex_sources", "UPDATE apex_sources SET body='bad'",
        "UPDATE apex_sources SET body='[{\"Name\":\"Keeper\",\"SymbolTable\":false}]'",
        "UPDATE apex_sources SET body='[{\"Name\":\"Keeper\",\"SymbolTable\":{\"name\":\"Wrong\"}}]'"
    ] {
        let root=seeded("invalid",vec![class("Keeper",&[])]).await;
        let conn=apex_lang::db::open_apex(&sf_schema::sqlite::db_path(&root,"SyntheticDelta")).unwrap();
        conn.execute_batch(mutation).unwrap();
        let before=fingerprint(&root);
        let inv=SfInvoker::new(Arc::new(MockRunner::new(|_,_|panic!("invalid provenance must not contact remote"))));
        assert!(sync_org(&inv,root.clone(),"SyntheticDelta","60.0",&NamespacePolicy::All).await.is_err());
        assert_eq!(fingerprint(&root),before);
        drop(conn); std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn failed_enumeration_or_corrupt_delta_retains_generation() {
    for failure in [
        "class-list",
        "object-list",
        "corrupt-delta",
        "incomplete-list",
        "missing-proof",
        "missing-namespace",
    ] {
        let root = seeded("failure", vec![class("Keeper", &[])]).await;
        let before = fingerprint(&root);
        let inv = SfInvoker::new(Arc::new(MockRunner::new(move |_, args: &[String]| {
            let command = args.join(" ");
            if (failure == "class-list" && command.contains("NamespacePrefix FROM"))
                || (failure == "object-list" && command.contains("sobject list"))
            {
                return Err(SfError::Spawn(std::io::Error::other(
                    "synthetic enumeration failure",
                )));
            }
            let value = if command.contains("NamespacePrefix FROM") && failure == "missing-proof" {
                json!({"status":0,"result":{"records":[{"Name":"Keeper","NamespacePrefix":null}]}})
            } else if command.contains("NamespacePrefix FROM") && failure == "missing-namespace" {
                json!({"status":0,"result":{"records":[{"Name":"Keeper"}],"done":true,"totalSize":1}})
            } else if command.contains("NamespacePrefix FROM") {
                json!({"status":0,"result":{"records":[{"Name":"Keeper","NamespacePrefix":null}],"done":failure!="incomplete-list","totalSize":if failure=="incomplete-list" {2}else{1}}})
            } else if command.contains("ApexClass") && failure == "corrupt-delta" {
                json!({"status":0,"result":{"records":[{"Name":"Keeper","SymbolTable":false}]}})
            } else {
                json!({"status":0,"result":{"records":[]}})
            };
            Ok(RawOutput {
                status: 0,
                stdout: value.to_string(),
                stderr: String::new(),
            })
        })));
        assert!(sync_org(
            &inv,
            root.clone(),
            "SyntheticDelta",
            "60.0",
            &NamespacePolicy::All
        )
        .await
        .is_err());
        assert_eq!(fingerprint(&root), before);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn publication_failure_rolls_back_sources_schema_fts_watermark_and_cache() {
    let root = seeded(
        "rollback",
        vec![class("Keeper", &["OldInner"]), class("Gone", &[])],
    )
    .await;
    let conn =
        apex_lang::db::open_apex(&sf_schema::sqlite::db_path(&root, "SyntheticDelta")).unwrap();
    apex_lang::db::write_raw(&conn, "60.0", "org_types", "legacy-marker").unwrap();
    conn.execute_batch("CREATE TRIGGER reject_delta BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").unwrap();
    let before = fingerprint(&root);
    let inv = runner(
        vec![class("Keeper", &["NewInner"])],
        vec!["Keeper"],
        vec!["Account"],
        true,
    );
    assert!(sync_org(
        &inv,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All
    )
    .await
    .is_err());
    assert_eq!(fingerprint(&root), before);
    assert_eq!(
        apex_lang::db::read_raw(&conn, "60.0", "org_types")
            .unwrap()
            .as_deref(),
        Some("legacy-marker")
    );
    let old =
        sf_schema::sqlite::open_readonly(&sf_schema::sqlite::db_path(&root, "SyntheticDelta"))
            .unwrap();
    old.execute_batch("BEGIN").unwrap();
    let old_meta = apex_lang::db::read_meta(&old).unwrap();
    conn.execute_batch("DROP TRIGGER reject_delta").unwrap();
    sync_org(
        &inv,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(apex_lang::db::read_meta(&old).unwrap(), old_meta);
    assert!(sf_schema::sqlite::read_object(&old, "Gone__c")
        .unwrap()
        .is_some());
    assert!(apex_lang::snapshot::read_apex_type(&old, "OldInner")
        .unwrap()
        .is_some());
    assert!(sf_schema::sqlite::read_object(&conn, "Gone__c")
        .unwrap()
        .is_none());
    assert!(apex_lang::snapshot::read_apex_type(&conn, "OldInner")
        .unwrap()
        .is_none());
    assert!(sf_schema::sqlite::search_objects(&conn, "Gone*", 25)
        .unwrap()
        .is_empty());
    assert!(apex_lang::db::read_raw(&conn, "60.0", "org_types")
        .unwrap()
        .is_none());
    drop(old);
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn added_updated_removed_counts_are_source_records_and_object_records() {
    let root = seeded(
        "counts",
        vec![class("Keeper", &["Old"]), class("Gone", &["GoneInner"])],
    )
    .await;
    let inv = runner(
        vec![
            class("Keeper", &["New", "Other"]),
            class("Added", &["AddedInner"]),
        ],
        vec!["Keeper", "Added"],
        vec!["Account"],
        true,
    );
    let (counts, _) = sync_org(
        &inv,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        counts,
        SyncOutcome {
            added: 1,
            updated: 2,
            removed: 2
        }
    );
    let (counts, _) = sync_org(
        &inv,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        counts,
        SyncOutcome {
            added: 0,
            updated: 3,
            removed: 0
        }
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn source_deletion_then_recreation_drops_old_derived_content() {
    let root = seeded(
        "recreate",
        vec![class("Keeper", &["OldInner"]), class("Sentinel", &[])],
    )
    .await;
    let (counts, _) = sync_org(
        &runner(vec![], vec!["Sentinel"], vec!["Account", "Gone__c"], false),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(counts.removed, 1);
    let (counts, ost) = sync_org(
        &runner(
            vec![class("Keeper", &["NewInner"])],
            vec!["Keeper", "Sentinel"],
            vec!["Account", "Gone__c"],
            false,
        ),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        counts,
        SyncOutcome {
            added: 1,
            updated: 0,
            removed: 0
        }
    );
    assert!(ost.org_types.iter().any(|t| t.name == "NewInner"));
    assert!(!ost.org_types.iter().any(|t| t.name == "OldInner"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_new_object_is_counted_separately_from_a_new_class() {
    let root = seeded("new-object", vec![class("Keeper", &[])]).await;
    let conn =
        apex_lang::db::open_apex(&sf_schema::sqlite::db_path(&root, "SyntheticDelta")).unwrap();
    // Seed a real full generation whose sole object is Gone__c.
    index_org(
        &runner(vec![class("Keeper", &[])], vec![], vec!["Gone__c"], false),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    let (counts, ost) = sync_org(
        &runner(
            vec![class("Added", &["Inner"])],
            vec!["Keeper", "Added"],
            vec!["Account", "Gone__c"],
            true,
        ),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        counts,
        SyncOutcome {
            added: 2,
            updated: 0,
            removed: 0
        }
    );
    assert!(sf_schema::sqlite::read_object(&conn, "Account")
        .unwrap()
        .is_some());
    assert!(ost.org_types.iter().any(|t| t.name == "Account"));
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn incomplete_full_source_query_cannot_replace_generation() {
    let root = seeded("partial-full", vec![class("Keeper", &[])]).await;
    let before = fingerprint(&root);
    let inv = SfInvoker::new(Arc::new(MockRunner::new(|_, args: &[String]| {
        assert!(args.join(" ").contains("ApexClass"));
        Ok(RawOutput {
            status: 0,
            stdout: json!({"status":0,"result":{"records":[],"done":false,"totalSize":5}})
                .to_string(),
            stderr: String::new(),
        })
    })));
    assert!(index_org(
        &inv,
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
        &mut |_| {}
    )
    .await
    .is_err());
    assert_eq!(fingerprint(&root), before);
    std::fs::remove_dir_all(root).unwrap();
}
