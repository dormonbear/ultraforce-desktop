#![cfg(windows)]

use sf_core::{CommandRunner, ProcessRunner, SfError, SfInvoker, SfVersion};
use std::{path::PathBuf, process::Command, sync::Arc, time::Duration};

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn arguments() -> Vec<String> {
    [
        "SELECT Name FROM Synthetic__c WHERE Name = '中文'",
        "a&b|c>d<e^f",
        "\"quoted\"",
        "%PATH%",
        "line one\nline two",
    ]
    .map(String::from)
    .to_vec()
}

#[tokio::test]
async fn npm_cli_uses_literal_argv_and_preserves_standalone_precedence() {
    if let Some(mode) = std::env::var_os("UF_NPM_CLI_CHILD") {
        if mode == "missing" {
            let error = ProcessRunner
                .run("sf", &[], Duration::from_secs(10))
                .await
                .unwrap_err();
            assert!(matches!(error, SfError::NotFound), "{error:?}");
        } else if mode == "standalone" {
            let out = ProcessRunner
                .run("sf", &["--version".into()], Duration::from_secs(10))
                .await
                .unwrap();
            assert_eq!(out.status, 0, "{}", out.stderr);
            assert!(out.stdout.starts_with('v'), "{}", out.stdout);
        } else {
            let invoker = SfInvoker::new(Arc::new(ProcessRunner));
            let version = SfVersion::detect(&invoker).await.unwrap();
            assert!(version.meets_minimum());
            let out = ProcessRunner
                .run("sf", &arguments(), Duration::from_secs(10))
                .await
                .unwrap();
            assert_eq!(out.status, 23, "{}", out.stderr);
            assert_eq!(out.stderr.trim(), "fixture_stderr");
            let value: serde_json::Value = serde_json::from_str(&out.stdout).unwrap();
            assert_eq!(value["args"], serde_json::json!(arguments()));
            assert_eq!(
                value["flags"],
                serde_json::json!(["true", "true", "true", "true"])
            );
        }
        return;
    }

    // Isolate PATH and inherited opt-ins in a child test, never mutate the test runner's environment. / 在子测试隔离 PATH 和继承的收集设置，不修改测试运行器环境。
    let node = Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .expect("Node is required in Windows CI / Windows CI 需要 Node");
    assert!(node.status.success());
    let node = PathBuf::from(String::from_utf8(node.stdout).unwrap().trim());
    let root = std::env::temp_dir().join(format!(
        "uf npm cli {} {}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _cleanup = Fixture(root.clone());
    let bin = root.join("bin");
    let node_bin = root.join("node bin");
    let payload = bin.join("node_modules/@salesforce/cli/bin/run.js");
    std::fs::create_dir_all(payload.parent().unwrap()).unwrap();
    std::fs::create_dir_all(&node_bin).unwrap();
    std::fs::copy(&node, node_bin.join("node.exe")).unwrap();
    // Deliberately unusable: the implementation must never evaluate this batch file. / 故意不可执行，实现绝不能解释此批处理文件。
    std::fs::write(bin.join("sf.cmd"), "@exit /b 91\r\n").unwrap();
    std::fs::write(
        &payload,
        r#"const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('@salesforce/cli/2.127.2 win32-x64 node-v22');
} else {
  const flags = ['SF_DISABLE_TELEMETRY', 'SFDX_DISABLE_TELEMETRY', 'SF_DISABLE_LOG_FILE', 'SFDX_DISABLE_LOG_FILE'].map(k => process.env[k]);
  console.log(JSON.stringify({args, flags}));
  console.error('fixture_stderr');
  process.exit(23);
}
"#,
    )
    .unwrap();
    let script = std::fs::read(&payload).unwrap();
    for mode in [
        "npm_path_node",
        "npm_adjacent_node",
        "missing",
        "standalone",
    ] {
        if mode == "npm_adjacent_node" {
            std::fs::copy(&node, bin.join("node.exe")).unwrap();
        } else if mode == "missing" {
            std::fs::remove_file(&payload).unwrap();
        } else if mode == "standalone" {
            std::fs::write(&payload, &script).unwrap();
            std::fs::copy(&node, bin.join("sf.exe")).unwrap();
        }
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "npm_cli_uses_literal_argv_and_preserves_standalone_precedence",
                "--nocapture",
            ])
            .env("UF_NPM_CLI_CHILD", mode)
            .env("PATH", std::env::join_paths([&bin, &node_bin]).unwrap())
            .env("NODE_OPTIONS", "")
            .env("SF_DISABLE_TELEMETRY", "false")
            .env("SFDX_DISABLE_TELEMETRY", "false")
            .env("SF_DISABLE_LOG_FILE", "false")
            .env("SFDX_DISABLE_LOG_FILE", "false")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Windows CLI fixture failed / Windows CLI 夹具失败 ({mode}):\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
