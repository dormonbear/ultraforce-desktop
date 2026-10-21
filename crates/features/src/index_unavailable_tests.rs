use super::deletion_tests::{class, runner, seeded};
use super::{sync_org, NamespacePolicy, SyncOutcome};
use serde_json::json;

#[test]
fn parser_preserves_provider_name_fallback_without_fabricated_members() {
    let records = vec![
        json!({"NamespacePrefix":null,"Name":"Unavailable","SymbolTable":null}),
        json!({"NamespacePrefix":null,"Name":"Empty","SymbolTable":{}}),
        json!({"NamespacePrefix":null,"Name":"Missing"}),
        json!({"NamespacePrefix":null,"Name":"Fallback","SymbolTable":{"methods":[{"name":"known","returnType":"void","parameters":[]}]}}),
        json!({"NamespacePrefix":null,"Name":"NullName","SymbolTable":{"name":null}}),
    ];
    let types = apex_lang::acquire::parse_org_types(&records);
    assert_eq!(types.len(), 4);
    for name in ["Unavailable", "Empty", "NullName"] {
        let ty = types.iter().find(|t| t.name == name).unwrap();
        assert!(ty.methods.is_empty() && ty.properties.is_empty());
    }
    assert!(types
        .iter()
        .find(|t| t.name == "Fallback")
        .unwrap()
        .methods
        .iter()
        .any(|m| m.name == "known"));
    assert!(!types.iter().any(|t| t.name == "Missing"));
    super::delta::validate_sources(
        &records
            .into_iter()
            .filter(|r| r.get("SymbolTable").is_some())
            .collect::<Vec<_>>(),
    )
    .unwrap();
}

#[tokio::test]
async fn mixed_available_unavailable_full_index_then_sync_preserves_ownership() {
    let root = seeded(
        "null-source",
        vec![
            class("Available", &["Inner"]),
            json!({"NamespacePrefix":null,"Name":"Unavailable","SymbolTable":null}),
            json!({"NamespacePrefix":null,"Name":"Empty","SymbolTable":{}}),
        ],
    )
    .await;
    let (ost, manifest) = apex_lang::load_snapshot(&root, "SyntheticDelta", "60.0").unwrap();
    assert_eq!(manifest.classes, 3);
    for name in ["Available", "Inner", "Unavailable", "Empty", "Account"] {
        assert!(ost.org_types.iter().any(|t| t.name == name));
    }
    let inv = runner(
        vec![json!({"NamespacePrefix":null,"Name":"Available","SymbolTable":null})],
        vec!["Available", "Unavailable", "Empty"],
        vec!["Account"],
        false,
    );
    let (counts, ost) = sync_org(
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
            updated: 1,
            removed: 1
        }
    );
    assert!(!ost.org_types.iter().any(|t| t.name == "Inner"));
    for name in ["Available", "Unavailable", "Empty"] {
        let ty = ost.org_types.iter().find(|t| t.name == name).unwrap();
        assert!(ty.methods.is_empty() && ty.properties.is_empty());
    }
    let snapshot = apex_lang::snapshot::load_sync_snapshot(&root, "SyntheticDelta", "60.0")
        .unwrap()
        .unwrap();
    assert_eq!(
        snapshot
            .sources
            .iter()
            .filter(|r| r["SymbolTable"].is_null())
            .count(),
        2
    );
    assert_eq!(snapshot.manifest.classes, 3);
    // An unavailable source is still owned and can be truly deleted later.
    let (counts, _) = sync_org(
        &runner(vec![], vec!["Available", "Empty"], vec!["Account"], false),
        root.clone(),
        "SyntheticDelta",
        "60.0",
        &NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(counts.removed, 1);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn null_parent_removes_old_inherited_members_and_retains_known_child_members() {
    let mut parent = class("Parent", &["OldInner"]);
    parent["SymbolTable"]["methods"] = json!([{"name":"old","returnType":"void","parameters":[]}]);
    let mut child = class("Child", &[]);
    child["SymbolTable"]["parentClass"] = json!("Parent");
    child["SymbolTable"]["methods"] = json!([{"name":"own","returnType":"void","parameters":[]}]);
    let root = seeded("null-parent", vec![parent, child]).await;
    let (_, ost) = sync_org(
        &runner(
            vec![json!({"Name":"Parent","NamespacePrefix":null,"SymbolTable":null})],
            vec!["Parent", "Child"],
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
    let child = ost.org_types.iter().find(|t| t.name == "Child").unwrap();
    assert!(child.methods.iter().any(|m| m.name == "own"));
    assert!(!child.methods.iter().any(|m| m.name == "old"));
    assert!(!ost.org_types.iter().any(|t| t.name == "OldInner"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn malformed_changed_sources_are_distinct_from_supported_null() {
    let root = seeded("bad-source", vec![class("Keeper", &["Inner"])]).await;
    let before = apex_lang::snapshot::load_sync_snapshot(&root, "SyntheticDelta", "60.0")
        .unwrap()
        .unwrap();
    for record in [
        json!({"Name":"Keeper","NamespacePrefix":null}),
        json!({"Name":"Keeper","NamespacePrefix":null,"SymbolTable":false}),
        json!({"Name":"Keeper","NamespacePrefix":null,"SymbolTable":[]}),
        json!({"Name":"Keeper","NamespacePrefix":null,"SymbolTable":{"name":"Wrong"}}),
        json!({"Name":"Keeper","SymbolTable":null}),
        json!({"Name":"Keeper","NamespacePrefix":null,"SymbolTable":{"innerClasses":[{}]}}),
    ] {
        assert!(sync_org(
            &runner(
                vec![record],
                vec!["Keeper"],
                vec!["Account", "Gone__c"],
                false
            ),
            root.clone(),
            "SyntheticDelta",
            "60.0",
            &NamespacePolicy::All
        )
        .await
        .is_err());
        let after = apex_lang::snapshot::load_sync_snapshot(&root, "SyntheticDelta", "60.0")
            .unwrap()
            .unwrap();
        assert_eq!(after.manifest, before.manifest);
        assert_eq!(after.sources, before.sources);
        assert_eq!(after.source_status, before.source_status);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn stale_prepared_writer_cannot_restore_available_status_over_null_winner() {
    let root = seeded("availability-cas", vec![class("Keeper", &["OldInner"])]).await;
    let prepared = apex_lang::snapshot::load_sync_snapshot(&root, "SyntheticDelta", "60.0")
        .unwrap()
        .unwrap();
    let mut bad_manifest = prepared.manifest.clone();
    bad_manifest.classes += 1;
    assert!(apex_lang::snapshot::save_generation(
        &root,
        &prepared.ost,
        &bad_manifest,
        &prepared.schemas,
        true,
        Some(&prepared.sources),
        &prepared.token
    )
    .is_err());
    sync_org(
        &runner(
            vec![json!({"Name":"Keeper","NamespacePrefix":null,"SymbolTable":null})],
            vec!["Keeper"],
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
    assert!(apex_lang::snapshot::save_generation(
        &root,
        &prepared.ost,
        &prepared.manifest,
        &prepared.schemas,
        true,
        Some(&prepared.sources),
        &prepared.token
    )
    .is_err());
    let winner = apex_lang::snapshot::load_sync_snapshot(&root, "SyntheticDelta", "60.0")
        .unwrap()
        .unwrap();
    assert!(!winner.source_status[0].available);
    assert!(winner.sources[0]["SymbolTable"].is_null());
    assert!(!winner.ost.org_types.iter().any(|t| t.name == "OldInner"));
    std::fs::remove_dir_all(root).unwrap();
}
