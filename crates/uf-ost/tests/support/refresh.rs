//! Synthetic refreshes through real stdio and child processes. / 通过真实标准流与子进程执行合成刷新。

use super::*;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

struct Fixture {
    root: PathBuf,
    bin: PathBuf,
}

impl Fixture {
    async fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("uf-refresh-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let python = std::process::Command::new("python3")
            .args(["-c", "import sys; print(sys.executable)"])
            .output()
            .unwrap();
        assert!(python.status.success());
        let python = String::from_utf8(python.stdout).unwrap();
        let script = format!("#!{}\n{}", python.trim(), include_str!("refresh_sf.py"));
        std::fs::write(bin.join("sf"), script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(bin.join("sf"), std::fs::Permissions::from_mode(0o755)).unwrap();
        seed_index(&root, "SyntheticA").await;
        seed_index(&root, "SyntheticB").await;
        Self { root, bin }
    }

    fn command(&self, exe: &Path) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new(exe);
        cmd.env("PATH", &self.bin)
            .env("UF_REFRESH_FIXTURE", &self.root);
        cmd
    }

    async fn entered(&self) {
        let start = Instant::now();
        while !self.root.join("entered").exists() {
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "child startup timeout / 子进程启动超时"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    fn release(&self) {
        std::fs::write(self.root.join("release"), b"").unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.release();
        std::thread::sleep(Duration::from_millis(200));
        // Clean known synthetic processes even when an assertion fails. / 断言失败时也清理已知合成进程。
        if let Ok(log) = std::fs::read_to_string(self.root.join("pids")) {
            for line in log.lines() {
                for pid in line.split_whitespace() {
                    // PID reuse must not target unrelated processes. / PID 复用不得误伤无关进程。
                    let owned = std::process::Command::new("/bin/ps")
                        .args(["-p", pid, "-o", "command="])
                        .output()
                        .is_ok_and(|output| {
                            output.status.success()
                                && String::from_utf8_lossy(&output.stdout)
                                    .contains(self.root.to_str().unwrap())
                        });
                    if !owned {
                        continue;
                    }
                    let _ = std::process::Command::new("/bin/kill")
                        .args(["-KILL", pid])
                        .output();
                }
            }
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

type Client = rmcp::service::RunningService<rmcp::RoleClient, ()>;

async fn server(f: &Fixture, exe: &Path) -> Client {
    let mut cmd = f.command(exe);
    cmd.arg("serve").arg("--root").arg(&f.root);
    ().serve(TokioChildProcess::new(cmd).unwrap())
        .await
        .unwrap()
}

async fn running(client: &Client, org: &str) -> bool {
    call(client, "ost_status", json!({"org":org})).await["orgs"][0]["reindexInProgress"]
        .as_bool()
        .unwrap()
}

async fn idle(client: &Client) {
    let start = Instant::now();
    while running(client, "SyntheticA").await {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "refresh cleanup timeout / 刷新清理超时"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn reservation_is_immediate_global_and_survives_launcher_exit() {
    let f = Fixture::new("reservation").await;
    let exe = Path::new(env!("CARGO_BIN_EXE_uf-ost"));
    let first = server(&f, exe).await;
    let second = server(&f, exe).await;
    let start = Instant::now();
    let reply = call(&first, "ost_reindex", json!({"org":"SyntheticA"})).await;
    assert_eq!(reply["status"], "started");
    assert_eq!(reply["org"], "SyntheticA");
    assert!(reply["age"].is_string());
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "startup must not await CLI / 启动不得等待 CLI"
    );
    assert!(
        running(&second, "SyntheticA").await,
        "reservation visible immediately / 预留立即可见"
    );
    for org in ["SyntheticA", "SyntheticB"] {
        assert_eq!(
            call(&second, "ost_reindex", json!({"org":org})).await["status"],
            "already_running"
        );
    }
    f.entered().await;
    first.cancel().await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        running(&second, "SyntheticA").await,
        "worker retains lease / 工作进程保留租约"
    );
    assert_eq!(
        call(&second, "ost_reindex", json!({"org":"SyntheticB"})).await["status"],
        "already_running"
    );
    let mut direct = f.command(exe);
    let output = direct
        .args(["index", "--org", "SyntheticB", "--root"])
        .arg(&f.root)
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        std::fs::read_to_string(f.root.join("entered"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    f.release();
    idle(&second).await;
    assert_eq!(
        call(&second, "ost_reindex", json!({"org":"SyntheticB"})).await["status"],
        "started"
    );
    // Wait for the restarted detached worker too. / 同时等待重新启动的分离工作进程。
    tokio::time::sleep(Duration::from_millis(100)).await;
    let start = Instant::now();
    while running(&second, "SyntheticB").await {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "retry cleanup timeout / 重试清理超时"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    second.cancel().await.unwrap();
}

#[tokio::test]
async fn direct_child_crash_stale_files_and_independent_roots() {
    let f = Fixture::new("crash").await;
    let independent = Fixture::new("independent").await;
    let exe = Path::new(env!("CARGO_BIN_EXE_uf-ost"));
    let client = server(&f, exe).await;
    // Retained stale coordination and legacy files must not block recovery. / 遗留协调及旧版锁文件不得阻止恢复。
    std::fs::write(
        f.root.join("reindex.lock"),
        "stale synthetic owner / 过期合成所有者",
    )
    .unwrap();
    std::fs::create_dir_all(f.root.join("SyntheticA")).unwrap();
    std::fs::write(f.root.join("SyntheticA/reindex.lock"), b"").unwrap();
    let mut command = f.command(exe);
    let mut child = command
        .args(["index", "--org", "SyntheticA", "--root"])
        .arg(&f.root)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    f.entered().await;
    assert!(running(&client, "SyntheticA").await);
    assert_eq!(
        call(&client, "ost_reindex", json!({"org":"SyntheticB"})).await["status"],
        "already_running"
    );
    let other = server(&independent, exe).await;
    assert_eq!(
        call(&other, "ost_reindex", json!({"org":"SyntheticA"})).await["status"],
        "started"
    );
    independent.entered().await;
    assert!(running(&other, "SyntheticA").await);
    child.kill().await.unwrap();
    child.wait().await.unwrap();
    idle(&client).await;
    assert_eq!(
        call(&client, "ost_reindex", json!({"org":"SyntheticB"})).await["status"],
        "started"
    );
    f.release();
    independent.release();
    let start = Instant::now();
    while running(&client, "SyntheticB").await || running(&other, "SyntheticA").await {
        assert!(start.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    client.cancel().await.unwrap();
    other.cancel().await.unwrap();
}

#[tokio::test]
async fn simultaneous_servers_and_startup_failure_allow_retry() {
    let f = Fixture::new("failure").await;
    let exe = Path::new(env!("CARGO_BIN_EXE_uf-ost"));
    std::fs::write(f.root.join("fail"), b"").unwrap();
    let first = server(&f, exe).await;
    let second = server(&f, exe).await;
    let (a, b, c) = tokio::join!(
        call(&first, "ost_reindex", json!({"org":"SyntheticA"})),
        call(&second, "ost_reindex", json!({"org":"SyntheticB"})),
        call(&first, "ost_reindex", json!({"org":"SyntheticA"})),
    );
    assert_eq!(
        [&a, &b, &c]
            .iter()
            .filter(|v| v["status"] == "started")
            .count(),
        1
    );
    f.entered().await;
    f.release();
    let start = Instant::now();
    while running(&first, "SyntheticA").await || running(&first, "SyntheticB").await {
        assert!(start.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    std::fs::remove_file(f.root.join("fail")).unwrap();
    assert_eq!(
        call(&second, "ost_reindex", json!({"org":"SyntheticA"})).await["status"],
        "started"
    );
    idle(&second).await;
    let status = call(&first, "ost_status", json!({"org":"SyntheticA"})).await;
    assert_eq!(status["orgs"][0]["unavailableClasses"], 1);
    first.cancel().await.unwrap();
    second.cancel().await.unwrap();
}

#[tokio::test]
async fn spawn_failure_releases_reservation_at_real_stdio_boundary() {
    let f = Fixture::new("spawn").await;
    let copied = f.bin.join("copied-uf-ost");
    std::fs::copy(env!("CARGO_BIN_EXE_uf-ost"), &copied).unwrap();
    let client = server(&f, &copied).await;
    std::fs::remove_file(&copied).unwrap();
    let reply = client
        .call_tool(mk_param("ost_reindex", json!({"org":"SyntheticA"})))
        .await;
    assert!(
        reply.is_err(),
        "missing executable errors instead of started / 缺失程序返回错误而非 started"
    );
    assert!(!running(&client, "SyntheticA").await);
    let fresh = server(&f, Path::new(env!("CARGO_BIN_EXE_uf-ost"))).await;
    assert_eq!(
        call(&fresh, "ost_reindex", json!({"org":"SyntheticA"})).await["status"],
        "started"
    );
    f.entered().await;
    f.release();
    idle(&fresh).await;
    client.cancel().await.unwrap();
    fresh.cancel().await.unwrap();
}

#[tokio::test]
async fn sync_waits_for_cli_and_returns_stamped_delta() {
    let f = Fixture::new("sync").await;
    let client = server(&f, Path::new(env!("CARGO_BIN_EXE_uf-ost"))).await;
    let reply = {
        let request = call(&client, "ost_sync", json!({"org":"SyntheticA"}));
        tokio::pin!(request);
        assert!(
            tokio::time::timeout(Duration::from_millis(250), &mut request)
                .await
                .is_err(),
            "sync must wait for CLI / 增量同步必须等待 CLI"
        );
        f.entered().await;
        assert!(!running(&client, "SyntheticA").await);
        f.release();
        request.await
    };
    assert_eq!(reply["stamp"]["org"], "SyntheticA");
    assert!(reply["stamp"]["age"].is_string());
    for name in ["added", "updated", "removed"] {
        assert!(reply[name].is_number());
    }
    client.cancel().await.unwrap();
}
