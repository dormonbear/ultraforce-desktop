use crate::error::SfError;
use async_trait::async_trait;
use std::time::Duration;

fn cli_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    // Keep the same cancellation and privacy policy for standalone and npm CLI processes. / 独立版与 npm CLI 进程使用相同的取消及隐私策略。
    command
        .kill_on_drop(true)
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .env("SF_AUTOUPDATE_DISABLE", "true")
        .env("SFDX_AUTOUPDATE_DISABLE", "true")
        .env("SF_DISABLE_TELEMETRY", "true")
        .env("SFDX_DISABLE_TELEMETRY", "true")
        .env("SF_DISABLE_LOG_FILE", "true")
        .env("SFDX_DISABLE_LOG_FILE", "true");
    command
}

/// Captured result of a finished subprocess.
#[derive(Debug, Clone)]
pub struct RawOutput {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Abstraction over process execution so tests can inject canned output.
#[async_trait]
pub trait CommandRunner: Send + Sync {
    async fn run(
        &self,
        program: &str,
        args: &[String],
        timeout: Duration,
    ) -> Result<RawOutput, SfError>;
}

/// Real runner: spawns the process via tokio and bounds it with a timeout.
pub struct ProcessRunner;

#[async_trait]
impl CommandRunner for ProcessRunner {
    async fn run(
        &self,
        program: &str,
        args: &[String],
        timeout: Duration,
    ) -> Result<RawOutput, SfError> {
        let fut = async {
            let output = cli_command(program).args(args).output().await;
            #[cfg(windows)]
            if program == "sf"
                && output
                    .as_ref()
                    .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            {
                // Rust does not append .cmd; invoke npm's Node entry point directly with literal argv. / Rust 不补充 .cmd，直接以原始参数调用 npm 的 Node 入口。
                if let Some((node, script)) =
                    std::env::var_os("PATH").and_then(|path| crate::windows_cli::npm_command(&path))
                {
                    return cli_command(node).arg(script).args(args).output().await;
                }
            }
            output
        };
        let out = match tokio::time::timeout(timeout, fut).await {
            Err(_) => return Err(SfError::Timeout(timeout)),
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(SfError::NotFound)
            }
            Ok(Err(e)) => return Err(SfError::Spawn(e)),
            Ok(Ok(o)) => o,
        };
        Ok(RawOutput {
            status: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
}

/// Test double. Available to downstream crates via the `test-util` feature.
#[cfg(any(test, feature = "test-util"))]
pub struct MockRunner {
    #[allow(clippy::type_complexity)]
    handler: Box<dyn Fn(&str, &[String]) -> Result<RawOutput, SfError> + Send + Sync>,
}

#[cfg(any(test, feature = "test-util"))]
impl MockRunner {
    pub fn new(
        handler: impl Fn(&str, &[String]) -> Result<RawOutput, SfError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            handler: Box::new(handler),
        }
    }

    /// Convenience: always return `stdout` with exit status 0.
    pub fn ok_json(stdout: impl Into<String>) -> Self {
        let s = stdout.into();
        Self::new(move |_, _| {
            Ok(RawOutput {
                status: 0,
                stdout: s.clone(),
                stderr: String::new(),
            })
        })
    }
}

#[cfg(any(test, feature = "test-util"))]
#[async_trait]
impl CommandRunner for MockRunner {
    async fn run(
        &self,
        program: &str,
        args: &[String],
        _timeout: Duration,
    ) -> Result<RawOutput, SfError> {
        (self.handler)(program, args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn process_runner_captures_echo_output() {
        let out = ProcessRunner
            .run("echo", &["hello".to_string()], Duration::from_secs(5))
            .await
            .expect("echo should run");
        assert_eq!(out.status, 0);
        assert!(out.stdout.contains("hello"), "got: {:?}", out.stdout);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn child_process_disables_cli_collection_and_file_logging() {
        // Print only the four policy flags, never the full environment.
        for flag in [
            "SF_DISABLE_TELEMETRY",
            "SFDX_DISABLE_TELEMETRY",
            "SF_DISABLE_LOG_FILE",
            "SFDX_DISABLE_LOG_FILE",
        ] {
            let out = ProcessRunner
                .run("printenv", &[flag.into()], Duration::from_secs(5))
                .await
                .unwrap();
            assert_eq!(out.status, 0);
            assert_eq!(out.stdout.trim(), "true", "{flag}");
        }
    }

    #[tokio::test]
    async fn process_runner_maps_missing_binary_to_not_found() {
        let err = ProcessRunner
            .run(
                "definitely-not-a-real-binary-xyz",
                &[],
                Duration::from_secs(5),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, SfError::NotFound), "got: {err:?}");
    }

    #[tokio::test]
    async fn mock_runner_returns_canned_json() {
        let runner = MockRunner::ok_json(r#"{"status":0}"#);
        let out = runner.run("sf", &[], Duration::from_secs(1)).await.unwrap();
        assert_eq!(out.status, 0);
        assert_eq!(out.stdout, r#"{"status":0}"#);
    }
}
