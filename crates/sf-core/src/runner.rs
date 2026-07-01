use crate::error::SfError;
use async_trait::async_trait;
use std::time::Duration;

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
        // NO_COLOR/FORCE_COLOR=0 stop the CLI emitting ANSI escapes that would
        // otherwise show as garbled control codes in our UI. AUTOUPDATE_DISABLE
        // silences the "update available" banner on stderr.
        let fut = tokio::process::Command::new(program)
            .args(args)
            .env("NO_COLOR", "1")
            .env("FORCE_COLOR", "0")
            .env("SF_AUTOUPDATE_DISABLE", "true")
            .env("SFDX_AUTOUPDATE_DISABLE", "true")
            .output();
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
