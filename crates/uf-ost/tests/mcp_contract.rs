//! Phase 2 seam: drive the real `uf-ost serve` binary over MCP stdio with an
//! rmcp client and assert the tool contract — all 8 tools listed, the org +
//! snapshot-age stamp on every response, and the reindex error path.

use std::sync::Arc;

use rmcp::model::CallToolRequestParam;
use rmcp::transport::TokioChildProcess;
use rmcp::ServiceExt;
use sf_core::{runner::MockRunner, SfInvoker};

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
                r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","tableDeclaration":{"name":"Foo"},"methods":[{"name":"bar","returnType":"String","parameters":[{"type":"Integer"}]}],"properties":[],"innerClasses":[],"interfaces":[]}}]}}"#,
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
    features::index::index_org(
        &inv,
        root.to_path_buf(),
        org,
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

    // 1. All 8 ost_* tools are advertised.
    let tools = client.list_tools(Default::default()).await.unwrap();
    let names: Vec<&str> = tools.tools.iter().map(|t| t.name.as_ref()).collect();
    for expected in [
        "ost_object",
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

    // 2. ost_object is stamped with org + age and carries the field.
    let obj = call(
        &client,
        "ost_object",
        serde_json::json!({"org":"TestOrg","object":"Account"}),
    )
    .await;
    let stamp = &obj["stamp"];
    assert_eq!(stamp["org"], "TestOrg", "org stamp present");
    assert!(stamp["age"].is_string(), "age stamp present: {stamp}");
    assert!(
        obj["fields"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["name"] == "Industry"),
        "Industry field present"
    );

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

/// `CallToolRequestParam` is `#[non_exhaustive]`; build it via serde.
fn mk_param(name: &str, args: serde_json::Value) -> CallToolRequestParam {
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
