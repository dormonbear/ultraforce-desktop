use super::*;
use serde_json::{json, Value};

fn records() -> Vec<Value> {
    vec![
        json!({"Name":"Foo","NamespacePrefix":null,"SymbolTable":{"name":"Foo","methods":[{"name":"old","returnType":"void","parameters":[]}],"innerClasses":[{"name":"OldInner"}]}}),
        json!({"Name":"Unavailable","NamespacePrefix":null,"SymbolTable":null}),
        json!({"Name":"Empty","NamespacePrefix":null,"SymbolTable":{}}),
        json!({"Name":"Shared","NamespacePrefix":"alpha","SymbolTable":null}),
        json!({"Name":"Shared","NamespacePrefix":"beta","SymbolTable":{}}),
    ]
}

fn invoker(changed: bool) -> SfInvoker {
    SfInvoker::new(Arc::new(MockRunner::new(move |_, args: &[String]| {
        let command = args.join(" ");
        let value = if command.contains("completions") {
            json!({"publicDeclarations":{"System":{"String":{"methods":[],"properties":[]}}}})
        } else if command.contains("NamespacePrefix FROM ApexClass") {
            json!({"status":0,"result":{"done":true,"totalSize":5,"records":records().into_iter().map(|r|json!({"Name":r["Name"],"NamespacePrefix":r["NamespacePrefix"]})).collect::<Vec<_>>()}})
        } else if command.contains("ApexClass") {
            json!({"status":0,"result":{"records":if changed {vec![json!({"Name":"Foo","NamespacePrefix":null,"SymbolTable":null})]} else {records()},"done":true,"totalSize":if changed {1}else{5}}})
        } else if command.contains("sobject list") {
            json!({"status":0,"result":["Account"]})
        } else if command.contains("EntityDefinition") || command.contains("CustomField") {
            json!({"status":0,"result":{"records":[],"done":true,"totalSize":0}})
        } else if command.contains("composite") {
            json!({"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}}]})
        } else {
            panic!("unexpected synthetic command {command}");
        };
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: value.to_string(),
            stderr: String::new(),
        })
    })))
}

#[tokio::test]
async fn unavailable_sources_are_explicit_in_actual_mcp_json_and_atomic_publication() {
    let root = std::env::temp_dir().join(format!("uf-availability-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    index_fixture(
        &invoker(false),
        root.clone(),
        "Synthetic",
        "60.0",
        &features::index::NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_uf-ost"));
    cmd.arg("serve").arg("--root").arg(&root).env("PATH", "");
    let client = ().serve(TokioChildProcess::new(cmd).unwrap()).await.unwrap();
    let status = call(&client, "ost_status", json!({"org":"Synthetic"})).await;
    assert_eq!(status["orgs"][0]["classes"], 5);
    assert_eq!(status["orgs"][0]["unavailableClasses"], 2);
    for (name, available) in [
        ("Foo", json!(true)),
        ("Unavailable", json!(false)),
        ("Empty", json!(true)),
        ("Shared", json!(false)),
        ("OldInner", Value::Null),
        ("Account", Value::Null),
    ] {
        let ty = call(&client, "ost_apex", json!({"org":"Synthetic","name":name})).await;
        assert_eq!(ty["symbolTableAvailable"], available, "{name}");
        if name == "Unavailable" {
            assert_eq!(ty["methods"], json!([]));
        }
    }
    let db = fixture_db_path(&root, "Synthetic");
    let conn = apex_lang::db::open_apex(&db).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_availability BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT,'synthetic'); END").unwrap();
    assert!(sync_fixture(
        &invoker(true),
        root.clone(),
        "Synthetic",
        "60.0",
        &features::index::NamespacePolicy::All
    )
    .await
    .is_err());
    assert_eq!(
        call(&client, "ost_status", json!({"org":"Synthetic"})).await["orgs"][0]
            ["unavailableClasses"],
        2
    );
    assert_eq!(
        call(&client, "ost_apex", json!({"org":"Synthetic","name":"Foo"})).await
            ["symbolTableAvailable"],
        true
    );
    conn.execute_batch("DROP TRIGGER reject_availability")
        .unwrap();
    let pinned = sf_schema::sqlite::open_readonly(&db).unwrap();
    pinned.execute_batch("BEGIN").unwrap();
    assert_eq!(
        apex_lang::source_status::unavailable_count(&pinned, 5).unwrap(),
        Some(2)
    );
    sync_fixture(
        &invoker(true),
        root.clone(),
        "Synthetic",
        "60.0",
        &features::index::NamespacePolicy::All,
    )
    .await
    .unwrap();
    assert_eq!(
        apex_lang::source_status::unavailable_count(&pinned, 5).unwrap(),
        Some(2)
    );
    assert_eq!(
        call(&client, "ost_status", json!({"org":"Synthetic"})).await["orgs"][0]
            ["unavailableClasses"],
        3
    );
    let foo = call(&client, "ost_apex", json!({"org":"Synthetic","name":"Foo"})).await;
    assert_eq!(foo["symbolTableAvailable"], false);
    assert_eq!(foo["methods"], json!([]));
    assert!(apex_lang::snapshot::read_apex_type(&conn, "OldInner")
        .unwrap()
        .is_none());
    conn.execute("DELETE FROM apex_source_status WHERE name='foo'", [])
        .unwrap();
    assert!(
        call(&client, "ost_status", json!({"org":"Synthetic"})).await["orgs"][0]
            ["unavailableClasses"]
            .is_null()
    );
    assert!(
        call(&client, "ost_apex", json!({"org":"Synthetic","name":"Foo"})).await
            ["symbolTableAvailable"]
            .is_null()
    );
    assert!(sync_fixture(
        &invoker(true),
        root.clone(),
        "Synthetic",
        "60.0",
        &features::index::NamespacePolicy::All
    )
    .await
    .is_err());
    client.cancel().await.ok();
    drop(pinned);
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
