//! Phase 2 seam: drive the real `uf-ost serve` binary over MCP stdio with an
//! rmcp client and assert the tool contract — all 11 `ost_*` tools listed, the
//! org + snapshot-age stamp on every response, and the reindex error path.

use std::sync::Arc;

use rmcp::model::CallToolRequestParams;
use rmcp::transport::TokioChildProcess;
use rmcp::ServiceExt;
use sf_core::{runner::MockRunner, SfInvoker};

#[path = "support/identity.rs"]
mod fixtures;
use fixtures::*;

#[path = "support/availability.rs"]
mod availability;

#[cfg(unix)]
#[path = "support/refresh.rs"]
mod refresh;

/// Full-index a tiny org (Account with a picklist + an Apex class) into `root`.
async fn seed_index(root: &std::path::Path, org: &str) {
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
                r#"{"status":0,"result":{"records":[{"NamespacePrefix":null,"Name":"Foo","SymbolTable":{"name":"Foo","tableDeclaration":{"name":"Foo"},"methods":[{"name":"bar","returnType":"String","parameters":[{"type":"Integer"}]}],"properties":[],"innerClasses":[],"interfaces":[]}}],"done":true,"totalSize":1}}"#,
            )
        } else if a.contains("sobject list") {
            ok(r#"{"status":0,"result":["Account"]}"#)
        } else if a.contains("composite") {
            ok(
                r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","label":"Account","fields":[{"name":"Industry","label":"Industry","type":"picklist","referenceTo":[],"picklistValues":[{"label":"Tech","value":"Tech","active":true,"defaultValue":true}]}],"childRelationships":[]}}]}"#,
            )
        } else {
            ok(r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#)
        }
    });
    let inv = SfInvoker::new(Arc::new(runner));
    index_fixture(
        &inv,
        root.to_path_buf(),
        org,
        "60.0",
        &features::index::NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn mcp_stdio_contract() {
    let root = std::env::temp_dir().join(format!("uf-ost-mcp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    seed_index(&root, "TestOrg").await;

    // Spawn the actual built binary as an MCP server over stdio.
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_uf-ost"));
    cmd.arg("serve").arg("--root").arg(&root);
    let client =
        ().serve(TokioChildProcess::new(cmd).expect("spawn uf-ost serve"))
            .await
            .expect("client handshake");

    // 1. All 11 ost_* tools are advertised.
    let tools = client.list_tools(Default::default()).await.unwrap();
    let names: Vec<&str> = tools.tools.iter().map(|t| t.name.as_ref()).collect();
    for expected in [
        "ost_object",
        "ost_soql",
        "ost_fields",
        "ost_recordtype",
        "ost_field",
        "ost_picklist",
        "ost_apex",
        "ost_search",
        "ost_status",
        "ost_sync",
        "ost_reindex",
    ] {
        assert!(
            names.contains(&expected),
            "missing tool {expected}; got {names:?}"
        );
    }

    // 2. ost_object returns a compact text table, header-stamped with org + age
    //    and carrying the field.
    let obj = call_text(
        &client,
        "ost_object",
        serde_json::json!({"org":"TestOrg","object":"Account"}),
    )
    .await;
    assert!(obj.contains("org=TestOrg"), "org stamp in header: {obj}");
    assert!(obj.contains("age="), "age stamp in header: {obj}");
    assert!(obj.contains("Industry"), "Industry field present: {obj}");

    // 2b. filter narrows the table and reports the shown count.
    let filtered = call_text(
        &client,
        "ost_object",
        serde_json::json!({"org":"TestOrg","object":"Account","filter":"indus"}),
    )
    .await;
    assert!(
        filtered.contains("shown=1"),
        "filter counts shown: {filtered}"
    );
    assert!(
        filtered.contains("Industry"),
        "filter keeps match: {filtered}"
    );

    // 2c. ost_soql validates offline and suggests the nearest field name.
    let soql = call_text(
        &client,
        "ost_soql",
        serde_json::json!({"org":"TestOrg","query":"SELECT Industri FROM Account"}),
    )
    .await;
    assert!(
        soql.contains("Unknown field 'Industri'") && soql.contains("did you mean 'Industry'"),
        "ost_soql suggests: {soql}"
    );

    // 2d. ost_fields expands a specific field; ost_recordtype lists RTs.
    let fd = call_text(
        &client,
        "ost_fields",
        serde_json::json!({"org":"TestOrg","object":"Account","fields":["Industry"]}),
    )
    .await;
    assert!(fd.contains("Industry"), "ost_fields detail: {fd}");
    let rt = call_text(
        &client,
        "ost_recordtype",
        serde_json::json!({"org":"TestOrg","object":"Account"}),
    )
    .await;
    assert!(rt.contains("recordTypes="), "ost_recordtype header: {rt}");

    // 3. ost_apex returns the offline signature (no live SymbolTable query).
    let ax = call(
        &client,
        "ost_apex",
        serde_json::json!({"org":"TestOrg","name":"Foo"}),
    )
    .await;
    assert_eq!(ax["stamp"]["org"], "TestOrg");
    assert_eq!(ax["methods"][0]["signature"], "String bar(Integer)");

    // 4. ost_status lists the org with a freshness stamp.
    let status = call(&client, "ost_status", serde_json::json!({})).await;
    assert!(
        status["orgs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["org"] == "TestOrg" && s["age"].is_string()),
        "status stamped: {status}"
    );

    let missing = call(
        &client,
        "ost_field",
        serde_json::json!({"org":"TestOrg","field":"Missing__c"}),
    )
    .await;
    assert_eq!(missing["snapshots"][0]["org"], "TestOrg");
    assert!(missing["snapshots"][0]["age"].is_string());
    let labels = call(
        &client,
        "ost_search",
        serde_json::json!({"org":"TestOrg","query":"Account"}),
    )
    .await;
    assert_eq!(labels["objects"][0], "Account");
    let all = call(
        &client,
        "ost_search",
        serde_json::json!({"query":"Industry"}),
    )
    .await;
    assert_eq!(all["orgs"][0]["stamp"]["org"], "TestOrg");
    assert_eq!(all["orgs"][0]["fields"][0], "Account.Industry");

    // 5. Unknown org is a clean error, not a panic.
    let err = client
        .call_tool(mk_param(
            "ost_object",
            serde_json::json!({"org":"Nope","object":"Account"}),
        ))
        .await;
    assert!(err.is_err(), "unknown org errors");

    client.cancel().await.ok();
    let _ = std::fs::remove_dir_all(&root);
}

/// Exercise the published acceptance surface through the actual compiled server,
/// with distinct synthetic orgs and no Salesforce process/network access.
#[tokio::test]
async fn offline_six_tools_include_empty_and_partial_snapshot_provenance() {
    let root = std::env::temp_dir().join(format!("uf-ost-six-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    seed_index(&root, "SyntheticA").await;
    seed_index(&root, "SyntheticB").await;
    seed_index(&root, "Stale").await;
    seed_index(&root, "QueryBroken").await;
    seed_index(&root, "Mismatched").await;
    {
        let conn = sf_schema::sqlite::open(&fixture_db_path(&root, "SyntheticB")).unwrap();
        conn.execute("UPDATE fields SET type='string' WHERE name='Industry'", [])
            .unwrap();
        let empty = sf_schema::model::SObjectSchema {
            name: "Empty__c".into(),
            label: "Customer Ledger".into(),
            label_plural: "Client Books".into(),
            ..Default::default()
        };
        sf_schema::sqlite::write_objects(&mut { conn }, &[empty]).unwrap();
        let conn = sf_schema::sqlite::open(&fixture_db_path(&root, "Stale")).unwrap();
        conn.execute("UPDATE meta SET schema_version=3", [])
            .unwrap();
    }
    {
        let conn = sf_schema::sqlite::open(&fixture_db_path(&root, "QueryBroken")).unwrap();
        conn.execute_batch("DROP TABLE fields; DROP TABLE objects_fts;")
            .unwrap();
        let conn = sf_schema::sqlite::open(&fixture_db_path(&root, "Mismatched")).unwrap();
        conn.execute("UPDATE meta SET alias='SyntheticA'", [])
            .unwrap();
    }
    // A static offline cache in DELETE journal mode must remain byte-for-byte
    // unchanged. WAL readers legitimately create shared-memory coordination files.
    for org in [
        "SyntheticA",
        "SyntheticB",
        "Stale",
        "QueryBroken",
        "Mismatched",
    ] {
        let conn = rusqlite::Connection::open(fixture_db_path(&root, org)).unwrap();
        conn.pragma_update(None, "journal_mode", "DELETE").unwrap();
    }
    let broken = fixture_db_path(&root, "Broken");
    std::fs::create_dir_all(broken.parent().unwrap()).unwrap();
    std::fs::write(broken, b"synthetic unreadable index").unwrap();
    // Close all writer connections before fingerprinting the complete file set.
    let before = inventory(&root);
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_uf-ost"));
    cmd.arg("serve").arg("--root").arg(&root).env("PATH", "");
    let client = ().serve(TokioChildProcess::new(cmd).unwrap()).await.unwrap();
    let tools = client.list_tools(Default::default()).await.unwrap();
    let schema = &tools
        .tools
        .iter()
        .find(|t| t.name == "ost_search")
        .unwrap()
        .input_schema;
    let output = tools
        .tools
        .iter()
        .find(|t| t.name == "ost_search")
        .unwrap()
        .output_schema
        .as_ref()
        .unwrap();
    assert_eq!(output.get("type").unwrap(), "object");
    assert_eq!(
        output.get("required").unwrap(),
        &serde_json::json!(["skipped"])
    );
    assert!(output.get("properties").unwrap().get("orgs").is_some());
    let required = schema.get("required").and_then(|x| x.as_array()).unwrap();
    assert!(!required.iter().any(|v| v == "org"));
    let drift = call(
        &client,
        "ost_field",
        serde_json::json!({"field":"Industry"}),
    )
    .await;
    assert_eq!(drift["hits"].as_array().unwrap().len(), 2);
    assert_ne!(drift["hits"][0]["type"], drift["hits"][1]["type"]);
    assert_eq!(drift["snapshots"].as_array().unwrap().len(), 2);
    assert_eq!(drift["skipped"].as_array().unwrap().len(), 4);
    for org in [None, Some("SyntheticA")] {
        let empty = call(
            &client,
            "ost_field",
            serde_json::json!({"field":"Missing__c", "org":org}),
        )
        .await;
        assert!(empty["hits"].as_array().unwrap().is_empty());
        assert_eq!(
            empty["snapshots"].as_array().unwrap().len(),
            if org.is_some() { 1 } else { 2 }
        );
        assert!(empty["snapshots"][0]["age"].is_string());
    }
    for query in ["Empty__c", "Customer Ledger", "Client Books"] {
        let found = call(
            &client,
            "ost_search",
            serde_json::json!({"query":query,"org":"SyntheticB"}),
        )
        .await;
        assert_eq!(found["objects"], serde_json::json!(["Empty__c"]));
        assert_eq!(found["stamp"]["org"], "SyntheticB");
    }
    for query in ["MissingUnmatched", "***", "", "\" OR * ()"] {
        let empty = call(&client, "ost_search", serde_json::json!({"query":query})).await;
        assert_eq!(empty["orgs"].as_array().unwrap().len(), 2);
        assert_eq!(empty["skipped"].as_array().unwrap().len(), 4);
        for org in empty["orgs"].as_array().unwrap() {
            for category in ["objects", "fields", "apex"] {
                assert!(org[category].as_array().unwrap().is_empty(), "{empty}");
            }
            assert!(org["stamp"]["age"].is_string());
        }
    }
    let found = call(&client, "ost_search", serde_json::json!({"query":"Foo"})).await;
    assert!(found["orgs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|o| o["apex"] == serde_json::json!(["Foo"])));
    let status = call(&client, "ost_status", serde_json::json!({})).await;
    assert_eq!(status["orgs"].as_array().unwrap().len(), 2);
    assert_eq!(status["skipped"].as_array().unwrap().len(), 4);
    let pick = call(
        &client,
        "ost_picklist",
        serde_json::json!({"org":"SyntheticA","object":"Account","field":"Industry"}),
    )
    .await;
    assert_eq!(pick["values"][0]["value"], "Tech");
    let apex = call(
        &client,
        "ost_apex",
        serde_json::json!({"org":"SyntheticA","name":"Foo"}),
    )
    .await;
    assert_eq!(apex["methods"][0]["signature"], "String bar(Integer)");
    let object = call_text(
        &client,
        "ost_object",
        serde_json::json!({"org":"SyntheticB","object":"Empty__c"}),
    )
    .await;
    assert!(
        object.contains("fields=0") && object.contains("org=SyntheticB") && object.contains("age=")
    );
    for (tool, args) in [
        (
            "ost_object",
            serde_json::json!({"org":"SyntheticA","object":"Missing"}),
        ),
        (
            "ost_picklist",
            serde_json::json!({"org":"SyntheticA","object":"Account","field":"Missing"}),
        ),
        (
            "ost_apex",
            serde_json::json!({"org":"SyntheticA","name":"Missing"}),
        ),
    ] {
        let err = client
            .call_tool(mk_param(tool, args))
            .await
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("org=SyntheticA") && err.contains("age="),
            "{err}"
        );
    }
    for org in ["Missing", "Stale", "Mismatched"] {
        let err = client
            .call_tool(mk_param(
                "ost_field",
                serde_json::json!({"org":org,"field":"Industry"}),
            ))
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("reindex"), "{err}");
    }
    client.cancel().await.ok();
    let after = inventory(&root);
    assert_eq!(
        after.keys().collect::<Vec<_>>(),
        before.keys().collect::<Vec<_>>(),
        "offline query file set changed"
    );
    for (path, bytes) in before {
        assert!(
            after[&path] == bytes,
            "offline query modified {}",
            path.display()
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn sanitized_alias_collision_cannot_return_another_org_snapshot() {
    let root = std::env::temp_dir().join(format!("uf-ost-alias-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    seed_index(&root, "Synthetic/A").await;
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_uf-ost"));
    cmd.arg("serve").arg("--root").arg(&root);
    let client = ().serve(TokioChildProcess::new(cmd).unwrap()).await.unwrap();
    let right = call(
        &client,
        "ost_search",
        serde_json::json!({"org":"Synthetic/A", "query":"Industry"}),
    )
    .await;
    assert_eq!(right["stamp"]["org"], "Synthetic/A");
    let all = call(
        &client,
        "ost_search",
        serde_json::json!({"query":"Industry"}),
    )
    .await;
    assert_eq!(all["orgs"][0]["stamp"]["org"], "Synthetic/A");
    assert_eq!(all["skipped"], serde_json::json!([]));
    let error = client
        .call_tool(mk_param(
            "ost_search",
            serde_json::json!({"org":"Synthetic_A", "query":"Industry"}),
        ))
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("not indexed"), "{error}");
    client.cancel().await.ok();
    std::fs::remove_dir_all(root).unwrap();
}

#[path = "support/publication.rs"]
mod publication;

fn inventory(root: &std::path::Path) -> std::collections::BTreeMap<std::path::PathBuf, Vec<u8>> {
    fn visit(
        dir: &std::path::Path,
        out: &mut std::collections::BTreeMap<std::path::PathBuf, Vec<u8>>,
    ) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, out);
            } else {
                out.insert(path.clone(), std::fs::read(path).unwrap());
            }
        }
    }
    let mut out = Default::default();
    visit(root, &mut out);
    out
}

/// Legacy opt-in files must never reactivate collection in the real binary.
#[tokio::test]
async fn legacy_collection_config_is_ignored_end_to_end() {
    let root = std::env::temp_dir().join(format!("uf-ost-tel-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();

    drive_ost_status(&root).await;
    assert!(!root.join("telemetry.db").exists());

    std::fs::write(
        root.join("telemetry.json"),
        r#"{"localEnabled":true,"remoteEnabled":false}"#,
    )
    .unwrap();
    drive_ost_status(&root).await;
    assert!(
        !root.join("telemetry.db").exists(),
        "legacy opt-in must not create a usage database"
    );

    // Both flags enabled and an existing legacy DB must also be ignored. These
    // are synthetic files under our temporary root, never real user data.
    let config = br#"{"localEnabled":true,"remoteEnabled":true}"#;
    let legacy = b"synthetic legacy database must remain untouched";
    std::fs::write(root.join("telemetry.json"), config).unwrap();
    std::fs::write(root.join("telemetry.db"), legacy).unwrap();
    drive_ost_status(&root).await;
    assert_eq!(std::fs::read(root.join("telemetry.json")).unwrap(), config);
    assert_eq!(std::fs::read(root.join("telemetry.db")).unwrap(), legacy);
    let mut names: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    names.sort();
    assert_eq!(names, ["telemetry.db", "telemetry.json"]);

    let _ = std::fs::remove_dir_all(&root);
}

/// Spawn the real binary over stdio, call `ost_status` (org: null — no index
/// needed), then shut it down.
async fn drive_ost_status(root: &std::path::Path) {
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_uf-ost"));
    cmd.arg("serve").arg("--root").arg(root);
    let client =
        ().serve(TokioChildProcess::new(cmd).expect("spawn uf-ost serve"))
            .await
            .expect("client handshake");
    let _ = call(&client, "ost_status", serde_json::json!({})).await;
    let search = call(
        &client,
        "ost_search",
        serde_json::json!({"query":"anything"}),
    )
    .await;
    assert_eq!(search["orgs"], serde_json::json!([]));
    // Error paths can contain private text too. Invalid offline queries must
    // return the error to the caller without keeping a copy on disk.
    let result = client
        .call_tool(mk_param(
            "ost_soql",
            serde_json::json!({
                "org": "synthetic-unknown", "query": "SELECT Private__c FROM Synthetic__c"
            }),
        ))
        .await;
    assert!(result.is_err() || result.unwrap().is_error == Some(true));
    client.cancel().await.ok();
}

/// `CallToolRequestParams` is `#[non_exhaustive]`; build it via serde.
fn mk_param(name: &str, args: serde_json::Value) -> CallToolRequestParams {
    serde_json::from_value(serde_json::json!({ "name": name, "arguments": args }))
        .expect("valid call param")
}

/// Call a tool and return its structured JSON payload.
async fn call<S>(
    client: &rmcp::service::RunningService<rmcp::RoleClient, S>,
    name: &'static str,
    args: serde_json::Value,
) -> serde_json::Value
where
    S: rmcp::Service<rmcp::RoleClient>,
{
    let res = client
        .call_tool(mk_param(name, args))
        .await
        .unwrap_or_else(|e| panic!("{name} call failed: {e}"));
    res.structured_content
        .unwrap_or_else(|| panic!("{name} returned no structured content"))
}

/// Call a tool and return its first text content block (for text-shaped tools).
async fn call_text<S>(
    client: &rmcp::service::RunningService<rmcp::RoleClient, S>,
    name: &'static str,
    args: serde_json::Value,
) -> String
where
    S: rmcp::Service<rmcp::RoleClient>,
{
    let res = client
        .call_tool(mk_param(name, args))
        .await
        .unwrap_or_else(|e| panic!("{name} call failed: {e}"));
    res.content
        .into_iter()
        .find_map(|c| c.as_text().map(|t| t.text.clone()))
        .unwrap_or_else(|| panic!("{name} returned no text content"))
}
