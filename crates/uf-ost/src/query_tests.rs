use super::*;
use sf_core::{runner::MockRunner, SfInvoker};
use std::sync::Arc;

#[test]
fn snapshot_pins_metadata_and_search_across_wal_commit() {
    let root = std::env::temp_dir().join(format!("uf-ost-pinned-{}", std::process::id()));
    let path = sqlite::db_path(&root, "Synthetic");
    let mut writer = db::open_apex(&path).unwrap();
    writer.execute("INSERT INTO meta VALUES (1, ?1, 'Synthetic', 'id', '60.0', '2020-01-01T00:00:00Z', 1, 0, 0, 1, NULL)", [db::SCHEMA_VERSION]).unwrap();
    sqlite::write_objects(
        &mut writer,
        &[sf_schema::model::SObjectSchema {
            name: "Old__c".into(),
            label: "Before".into(),
            ..Default::default()
        }],
    )
    .unwrap();
    let snap = open_org(&root, "Synthetic").unwrap();
    {
        let tx = writer.transaction().unwrap();
        sqlite::delete_object(&tx, "Old__c").unwrap();
        sqlite::upsert_object(
            &tx,
            &sf_schema::model::SObjectSchema {
                name: "New__c".into(),
                label: "After".into(),
                ..Default::default()
            },
        )
        .unwrap();
        tx.execute(
            "UPDATE meta SET generation=2, indexed_at='2026-10-21T00:00:00Z'",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let old = search(&snap, "Before", 25).unwrap();
    assert_eq!(old.stamp.generation, 1);
    assert_eq!(old.objects, ["Old__c"]);
    assert!(search(&snap, "After", 25).unwrap().objects.is_empty());
    let next = open_org(&root, "Synthetic").unwrap();
    let new = search(&next, "After", 25).unwrap();
    assert_eq!(new.stamp.generation, 2);
    assert_eq!(new.objects, ["New__c"]);
    drop(snap);
    drop(next);
    drop(writer);
    std::fs::remove_dir_all(root).unwrap();
}

// Round-trip check for the RFC3339 parse against features' formatter.
#[test]
fn iso_parse_matches_known_instants() {
    assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(parse_iso("2021-01-01T00:00:00Z"), Some(1_609_459_200));
    assert_eq!(parse_iso("garbage"), None);
}

#[test]
fn fts_expr_prefixes_tokens_and_drops_operators() {
    assert_eq!(fts_expr("Bill City"), "\"Bill\"* \"City\"*");
    assert_eq!(fts_expr("  a-b  "), "\"a\"* \"b\"*");
    assert_eq!(fts_expr("***"), "");
}

// Build a real index.db, then exercise the read layer end to end.
#[tokio::test]
async fn reads_object_picklist_apex_search_and_drift() {
    let root = std::env::temp_dir().join(format!("uf-ost-q-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);

    // Full index one org (Account with a picklist + an Apex class).
    let runner = MockRunner::new(|_p, args: &[String]| {
        let a = args.join(" ");
        let ok = |s: &str| {
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: s.to_string(),
                stderr: String::new(),
            })
        };
        if a.contains("org display") {
            ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
        } else if a.contains("completions") {
            ok(
                r#"{"publicDeclarations":{"System":{"Math":{"methods":[],"properties":[],"constructors":[]}}}}"#,
            )
        } else if a.contains("ApexClass") {
            ok(
                r#"{"status":0,"result":{"records":[{"Name":"Foo","NamespacePrefix":null,"SymbolTable":{"name":"Foo","tableDeclaration":{"name":"Foo"},"methods":[{"name":"bar","returnType":"String","parameters":[{"type":"Integer"}]}],"properties":[],"innerClasses":[],"interfaces":[]}}]}}"#,
            )
        } else if a.contains("sobject list") {
            ok(r#"{"status":0,"result":["Account"]}"#)
        } else if a.contains("composite") {
            ok(
                r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","label":"Account","fields":[{"name":"Industry","label":"Industry","type":"picklist","referenceTo":[],"picklistValues":[{"label":"Tech","value":"Tech","active":true,"defaultValue":true},{"label":"Old","value":"Old","active":false,"defaultValue":false}]}],"childRelationships":[]}}]}"#,
            )
        } else {
            ok(
                r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#,
            )
        }
    });
    let inv = SfInvoker::new(Arc::new(runner));
    features::index::index_org(
        &inv,
        root.clone(),
        "MyOrg",
        "60.0",
        &features::index::NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();

    let snap = open_org(&root, "MyOrg").unwrap();

    // Object: compact text, header-stamped, carrying the picklist field.
    let obj = object(&snap, "account", None).unwrap();
    assert!(obj.contains("Account (Account)"), "{obj}");
    assert!(obj.contains("org=MyOrg"), "{obj}");
    assert!(obj.contains("Industry"), "{obj}");
    // Filter narrows and reports the shown count.
    let filtered = object(&snap, "account", Some("indus")).unwrap();
    assert!(filtered.contains("shown=1"), "{filtered}");

    // SOQL validation: clean query OK, typo flagged + suggested, bad object.
    let ok = crate::soql::soql_check(&snap, "SELECT Industry FROM Account").unwrap();
    assert!(ok.contains("OK"), "{ok}");
    let bad = crate::soql::soql_check(&snap, "SELECT Industri FROM Account").unwrap();
    assert!(
        bad.contains("Unknown field 'Industri'") && bad.contains("did you mean 'Industry'"),
        "{bad}"
    );
    let obj = crate::soql::soql_check(&snap, "SELECT Id FROM Bogus").unwrap();
    assert!(obj.contains("Unknown object 'Bogus'"), "{obj}");

    // Picklist keeps active-only.
    let pl = picklist(&snap, "Account", "Industry").unwrap();
    let vals: Vec<_> = pl.values.iter().map(|v| v.value.as_str()).collect();
    assert_eq!(vals, vec!["Tech"], "inactive value dropped");
    assert!(pl.values[0].default);

    // Apex signature.
    let ax = apex(&snap, "Foo").unwrap();
    assert_eq!(ax.kind, "class");
    assert_eq!(ax.methods[0].signature, "String bar(Integer)");

    // Search hits both indexes.
    let s = search(&snap, "Indus", 10).unwrap();
    assert!(s.fields.iter().any(|f| f == "Account.Industry"));
    let sa = search(&snap, "Foo", 10).unwrap();
    assert!(sa.apex.iter().any(|t| t == "Foo"));

    // Drift: single org, field present.
    let drift = field_drift(&root, "Industry", None).unwrap();
    assert_eq!(drift.hits.len(), 1);
    assert_eq!(drift.hits[0].org, "MyOrg");
    assert_eq!(drift.hits[0].object, "Account");

    // NotIndexed for an unknown org.
    assert!(matches!(
        open_org(&root, "Nope"),
        Err(QueryError::NotIndexed(_))
    ));

    // Schema-version guard: a mismatched meta is StaleIndex, not a crash.
    drop(snap);
    let rw = sqlite::open(&sqlite::db_path(&root, "MyOrg")).unwrap();
    rw.execute("UPDATE meta SET schema_version = 9999", []).unwrap();
    drop(rw);
    assert!(matches!(
        open_org(&root, "MyOrg"),
        Err(QueryError::StaleIndex(_))
    ));

    let _ = std::fs::remove_dir_all(&root);
}
