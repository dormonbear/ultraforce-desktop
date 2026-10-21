use rmcp::{model::CallToolRequestParams, transport::TokioChildProcess, ServiceExt};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const ALIAS: &str = "moving / 合成;&";
const USER: &str = "first@example.invalid";
const OTHER_USER: &str = "second@example.invalid";
const FOREIGN_USER: &str = "foreign@example.invalid";

struct Fixture {
    root: PathBuf,
    bin: PathBuf,
    cache: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "uf identity {} {}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bin = root.join("bin");
        let cache = root.join("cache");
        let payload = bin.join("node_modules/@salesforce/cli/bin/run.js");
        std::fs::create_dir_all(payload.parent().unwrap()).unwrap();
        let node = std::process::Command::new("node")
            .env("NODE_OPTIONS", "")
            .args(["-p", "process.execPath"])
            .output()
            .expect("Node required / 需要 Node");
        assert!(node.status.success());
        let node = String::from_utf8(node.stdout).unwrap().trim().to_owned();
        std::fs::write(&payload, include_str!("support/identity_sf.cjs")).unwrap();
        #[cfg(windows)]
        {
            std::fs::copy(&node, bin.join("node.exe")).unwrap();
            std::fs::write(bin.join("sf.cmd"), "@exit /b 91\r\n").unwrap();
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let quote = |value: &str| format!("'{}'", value.replace('\'', "'\\''"));
            let script = format!(
                "#!/bin/sh\nexec {} {} \"$@\"\n",
                quote(&node),
                quote(payload.to_str().unwrap())
            );
            std::fs::write(bin.join("sf"), script).unwrap();
            std::fs::set_permissions(bin.join("sf"), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        let first = json!({"id":"00D000000000001","username":USER,"apiVersion":"60.0","service":"FirstService","label":"First Ledger"});
        let other = json!({"id":"00D000000000001","username":OTHER_USER,"apiVersion":"60.0","service":"SecondService","label":"Second Ledger"});
        let foreign = json!({"id":"00D000000000002","username":FOREIGN_USER,"apiVersion":"60.0","service":"ForeignService","label":"Foreign Ledger"});
        std::fs::write(
            root.join("orgs.json"),
            json!({ALIAS:first, USER:first, OTHER_USER:other, FOREIGN_USER:foreign}).to_string(),
        )
        .unwrap();
        Self { root, bin, cache }
    }

    fn command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_uf-ost"));
        command
            .env("PATH", &self.bin)
            .env("UF_IDENTITY_FIXTURE", &self.root)
            .env("NODE_OPTIONS", "")
            .env("SF_CONFIG_DIR", self.root.join("sf-profile"))
            .env("SFDX_CONFIG_DIR", self.root.join("sfdx-profile"));
        for flag in [
            "SF_DISABLE_TELEMETRY",
            "SFDX_DISABLE_TELEMETRY",
            "SF_DISABLE_LOG_FILE",
            "SFDX_DISABLE_LOG_FILE",
        ] {
            command.env(flag, "false");
        }
        command
    }

    async fn index(&self, target: &str, sync: bool) -> std::process::Output {
        let mut command = self.command();
        command
            .args(["index", "--org", target, "--root"])
            .arg(&self.cache);
        if sync {
            command.arg("--sync");
        }
        command.output().await.unwrap()
    }

    fn binding(&self, target: &str) -> sf_schema::identity::CacheBinding {
        sf_schema::identity::lookup(&self.cache, target)
            .unwrap()
            .unwrap()
    }

    fn generation(&self, target: &str) -> i64 {
        let path = sf_schema::sqlite::db_path(&self.cache, self.binding(target).cache_key());
        let conn = sf_schema::sqlite::open_readonly(&path).unwrap();
        apex_lang::db::read_meta(&conn).unwrap().unwrap().generation
    }

    async fn server(&self, offline: bool) -> rmcp::service::RunningService<rmcp::RoleClient, ()> {
        let mut command = self.command();
        command.arg("serve").arg("--root").arg(&self.cache);
        if offline {
            command.env("PATH", "");
        }
        ().serve(TokioChildProcess::new(command).unwrap())
            .await
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn call(
    client: &rmcp::service::RunningService<rmcp::RoleClient, ()>,
    tool: &str,
    args: Value,
) -> Value {
    let mut params = CallToolRequestParams::new(tool.to_owned());
    params.arguments = args.as_object().cloned();
    let result = client.call_tool(params).await.unwrap();
    assert!(!result.is_error.unwrap_or(false));
    result.structured_content.unwrap_or_else(|| {
        let text = result
            .content
            .iter()
            .filter_map(|content| content.as_text())
            .map(|text| text.text.as_str())
            .collect::<Vec<_>>()
            .join("");
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    })
}

fn inventory(root: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.extend(inventory(&path));
        } else {
            out.insert(path.clone(), std::fs::read(path).unwrap());
        }
    }
    out
}

#[tokio::test]
async fn actual_cli_and_mcp_share_alias_generations_but_isolate_users_and_reassignment() {
    let fixture = Fixture::new();
    apex_lang::save_snapshot(
        &fixture.cache,
        &apex_lang::Ost::default(),
        &apex_lang::IndexManifest {
            org_id: USER.into(),
            api_version: "59.0".into(),
            indexed_at: "2026-10-21T00:00:00Z".into(),
            namespaces: 0,
            classes: 0,
            sobjects: 0,
            stdlib_error: None,
        },
    )
    .unwrap();
    let legacy_path = sf_schema::sqlite::db_path(&fixture.cache, USER);
    let legacy = std::fs::read(&legacy_path).unwrap();
    let unverified = fixture
        .command()
        .args(["status", "--org", USER, "--root"])
        .arg(&fixture.cache)
        .output()
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&unverified.stdout).contains("not indexed"));
    assert!(!fixture.cache.join("_identity").exists());
    assert!(!fixture.root.join("commands.jsonl").exists());
    for target in [ALIAS, USER, OTHER_USER] {
        let output = fixture.index(target, false).await;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert_eq!(fixture.binding(ALIAS), fixture.binding(USER));
    assert_ne!(
        fixture.binding(USER).cache_key(),
        fixture.binding(OTHER_USER).cache_key()
    );
    assert_eq!(fixture.generation(USER), 2);
    assert_eq!(fixture.generation(OTHER_USER), 1);
    let client = fixture.server(false).await;
    let before = fixture.generation(USER);
    let synced = call(&client, "ost_sync", json!({"org":ALIAS})).await;
    assert_eq!(synced["stamp"]["org"], ALIAS);
    assert_eq!(synced["stamp"]["generation"], before + 1);
    assert_eq!(fixture.generation(OTHER_USER), 1);
    client.cancel().await.unwrap();

    for (_, binding) in sf_schema::identity::known_contexts(&fixture.cache).unwrap() {
        let conn = rusqlite::Connection::open(sf_schema::sqlite::db_path(
            &fixture.cache,
            binding.cache_key(),
        ))
        .unwrap();
        conn.pragma_update(None, "journal_mode", "DELETE").unwrap();
    }
    std::fs::write(fixture.root.join("fail"), b"").unwrap();
    let before = inventory(&fixture.cache);
    let cli_before = std::fs::read(fixture.root.join("commands.jsonl")).unwrap();
    let client = fixture.server(true).await;
    let object = call(
        &client,
        "ost_object",
        json!({"org":ALIAS,"object":"Account"}),
    )
    .await;
    assert!(object.as_str().unwrap().contains("First Ledger"));
    let picklist = call(
        &client,
        "ost_picklist",
        json!({"org":USER,"object":"Account","field":"Industry"}),
    )
    .await;
    assert!(picklist.to_string().contains("FirstService"));
    let apex = call(
        &client,
        "ost_apex",
        json!({"org":ALIAS,"name":"FirstService"}),
    )
    .await;
    assert_eq!(apex["stamp"]["org"], ALIAS);
    let field = call(&client, "ost_field", json!({"org":USER,"field":"Industry"})).await;
    assert!(field.to_string().contains(USER));
    let search = call(&client, "ost_search", json!({"query":"Ledger"})).await;
    assert_eq!(search["orgs"].as_array().unwrap().len(), 2);
    let status = call(&client, "ost_status", json!({})).await;
    assert_eq!(status["orgs"].as_array().unwrap().len(), 2);
    let other = call(
        &client,
        "ost_object",
        json!({"org":OTHER_USER,"object":"Account"}),
    )
    .await;
    assert!(other.as_str().unwrap().contains("Second Ledger"));
    let mut wrong_user = CallToolRequestParams::new("ost_apex");
    wrong_user.arguments = Some(
        json!({"org":OTHER_USER,"name":"FirstService"})
            .as_object()
            .unwrap()
            .clone(),
    );
    assert!(client.call_tool(wrong_user).await.is_err());
    client.cancel().await.unwrap();
    assert_eq!(inventory(&fixture.cache), before);
    assert_eq!(
        std::fs::read(fixture.root.join("commands.jsonl")).unwrap(),
        cli_before
    );
    std::fs::remove_file(fixture.root.join("fail")).unwrap();

    let config_path = fixture.root.join("orgs.json");
    let mut config: Value = serde_json::from_slice(&std::fs::read(&config_path).unwrap()).unwrap();
    config[ALIAS] = config[FOREIGN_USER].clone();
    std::fs::write(config_path, config.to_string()).unwrap();
    let previous_generation = fixture.generation(USER);
    let refused = fixture.index(ALIAS, true).await;
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("ost_reindex"));
    assert_eq!(fixture.generation(USER), previous_generation);
    let output = fixture.index(ALIAS, false).await;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let client = fixture.server(true).await;
    let moved = call(
        &client,
        "ost_object",
        json!({"org":ALIAS,"object":"Account"}),
    )
    .await;
    let original = call(
        &client,
        "ost_object",
        json!({"org":USER,"object":"Account"}),
    )
    .await;
    assert!(moved.as_str().unwrap().contains("Foreign Ledger"));
    assert!(original.as_str().unwrap().contains("First Ledger"));
    client.cancel().await.unwrap();
    assert_eq!(std::fs::read(legacy_path).unwrap(), legacy);
    assert_eq!(fixture.binding(ALIAS), fixture.binding(FOREIGN_USER));
    assert_ne!(
        fixture.binding(ALIAS).cache_key(),
        fixture.binding(USER).cache_key()
    );
    assert_eq!(fixture.generation(ALIAS), 1);
    assert_eq!(fixture.generation(USER), previous_generation);
    let text = String::from_utf8_lossy(
        &std::fs::read(fixture.cache.join("_identity/bindings.db")).unwrap(),
    )
    .into_owned();
    assert!(!text.contains("SYNTHETIC_SECRET"));
}
