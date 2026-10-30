use serde::{Deserialize, Deserializer};

use std::io::Write;

use sf_core::{SfError, SfInvoker};

use crate::debug_log::DebugLogView;

/// Result of one `sf apex run`. Lenient parsing: `sf` returns `line`/`column` as
/// JSON strings on compile failure and numbers/null otherwise, and empty
/// problem/message strings must map to `None`.
#[derive(Debug, Clone, Deserialize)]
pub struct ApexRunResult {
    pub compiled: bool,
    pub success: bool,
    #[serde(rename = "compileProblem", default, deserialize_with = "empty_to_none")]
    pub compile_problem: Option<String>,
    #[serde(
        rename = "exceptionMessage",
        default,
        deserialize_with = "empty_to_none"
    )]
    pub exception_message: Option<String>,
    #[serde(
        rename = "exceptionStackTrace",
        default,
        deserialize_with = "empty_to_none"
    )]
    pub exception_stack_trace: Option<String>,
    #[serde(default, deserialize_with = "lenient_opt_i64")]
    pub line: Option<i64>,
    #[serde(default, deserialize_with = "lenient_opt_i64")]
    pub column: Option<i64>,
    #[serde(default)]
    pub logs: String,
}

/// Map `""` to `None`, any non-empty string to `Some`.
fn empty_to_none<'de, D>(de: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<String>::deserialize(de)?;
    Ok(opt.filter(|s| !s.is_empty()))
}

/// Accept JSON string, number, or null → `Option<i64>`; blank string → `None`.
fn lenient_opt_i64<'de, D>(de: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    use serde_json::Value;
    match Value::deserialize(de)? {
        Value::Null => Ok(None),
        Value::Number(n) => Ok(n.as_i64()),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                Ok(None)
            } else {
                t.parse::<i64>().map(Some).map_err(D::Error::custom)
            }
        }
        other => Err(D::Error::custom(format!("expected i64-ish, got {other}"))),
    }
}

/// A finished anonymous-Apex run: the typed result plus the parsed debug log
/// (when `sf` returned any log text).
#[derive(Debug, Clone)]
pub struct AnonApexOutcome {
    pub result: ApexRunResult,
    pub log_view: Option<DebugLogView>,
}

/// Derived, display-ready error location for the UI.
#[derive(Debug, Clone)]
pub enum ApexError {
    Compile {
        message: String,
        line: Option<i64>,
        column: Option<i64>,
    },
    Runtime {
        message: String,
        stack_trace: Option<String>,
    },
}

impl ApexRunResult {
    /// `Compile` when it did not compile, else `Runtime` when it compiled but
    /// failed, else `None`.
    pub fn error(&self) -> Option<ApexError> {
        if !self.compiled {
            Some(ApexError::Compile {
                message: self.compile_problem.clone().unwrap_or_default(),
                line: self.line,
                column: self.column,
            })
        } else if !self.success {
            Some(ApexError::Runtime {
                message: self.exception_message.clone().unwrap_or_default(),
                stack_trace: self.exception_stack_trace.clone(),
            })
        } else {
            None
        }
    }
}

/// Execute anonymous Apex from `apex_src`. / 执行 `apex_src` 中的匿名 Apex。
///
/// Write the source to a temporary file (owner-only on Unix), run
/// `sf apex run -f <file> --json`, and attempt cleanup on completion or cancellation.
/// 将源码写入临时文件（Unix 下仅所有者可访问），执行
/// `sf apex run -f <file> --json`，并在完成或取消时尝试清理。
pub async fn run_anon(
    invoker: &SfInvoker,
    apex_src: &str,
    target_org: Option<&str>,
) -> Result<AnonApexOutcome, SfError> {
    let mut file = tempfile::Builder::new()
        .prefix("ultraforce-anon-")
        .suffix(".apex")
        .tempfile()
        .map_err(SfError::Spawn)?;
    file.write_all(apex_src.as_bytes())
        .map_err(SfError::Spawn)?;
    let path = file.into_temp_path();

    let path_str = path.to_string_lossy().into_owned();
    let mut args = vec!["apex", "run", "-f", &path_str, "--json"];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    let raw = invoker.run_raw(&args).await;

    drop(path);

    let raw = raw?;
    let result = parse_run_envelope(&raw.stdout)?;
    let log_view = (!result.logs.is_empty()).then(|| DebugLogView::from_log(&result.logs));
    Ok(AnonApexOutcome { result, log_view })
}

/// Parse the `sf apex run` envelope: `status==0` → `result`; non-zero compile
/// failure carries the same shape in `data`; otherwise a genuine `SfError`.
fn parse_run_envelope(stdout: &str) -> Result<ApexRunResult, SfError> {
    let env: serde_json::Value = serde_json::from_str(stdout).map_err(SfError::Parse)?;
    let status = env.get("status").and_then(|v| v.as_i64()).unwrap_or(0);

    let payload = if status == 0 {
        env.get("result")
    } else {
        // compile failure: payload lives in `data` and carries `compiled`
        env.get("data").filter(|d| d.get("compiled").is_some())
    };

    match payload {
        Some(p) => serde_json::from_value(p.clone()).map_err(SfError::Parse),
        None => Err(SfError::Command {
            status: status as i32,
            name: env
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Error")
                .to_string(),
            message: env
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_runtime_result_number_line() {
        let json = r#"{"compiled":true,"success":false,"compileProblem":"",
            "exceptionMessage":"System.NullPointerException: x",
            "exceptionStackTrace":"AnonymousBlock: line 2, column 1",
            "line":2,"column":1,"logs":"67.0 APEX_CODE,DEBUG\nx"}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(r.compiled && !r.success);
        assert_eq!(r.line, Some(2));
        assert_eq!(r.column, Some(1));
        assert!(r.compile_problem.is_none());
        assert_eq!(
            r.exception_message.as_deref(),
            Some("System.NullPointerException: x")
        );
        match r.error().unwrap() {
            ApexError::Runtime {
                message,
                stack_trace,
            } => {
                assert!(message.contains("NullPointer"));
                assert!(stack_trace.unwrap().contains("line 2"));
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_compile_result_string_line_and_error() {
        let json = r#"{"compiled":false,"success":false,
            "compileProblem":"Unexpected token 'x'.","exceptionMessage":"",
            "exceptionStackTrace":"","line":"1","column":"9","logs":""}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(!r.compiled);
        assert_eq!(r.line, Some(1));
        assert_eq!(r.column, Some(9));
        match r.error().unwrap() {
            ApexError::Compile {
                message,
                line,
                column,
            } => {
                assert_eq!(message, "Unexpected token 'x'.");
                assert_eq!((line, column), (Some(1), Some(9)));
            }
            other => panic!("expected Compile, got {other:?}"),
        }
    }

    #[test]
    fn blank_line_and_empty_strings_become_none() {
        let json = r#"{"compiled":true,"success":true,"compileProblem":"",
            "exceptionMessage":"","exceptionStackTrace":"","line":"","column":null,
            "logs":""}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(r.success);
        assert_eq!(r.line, None);
        assert_eq!(r.column, None);
        assert!(r.compile_problem.is_none());
        assert!(r.exception_message.is_none());
        assert!(r.error().is_none()); // compiled && success → no error
    }

    use sf_core::runner::{MockRunner, RawOutput};
    use std::sync::Arc;

    struct PendingRunner(
        std::sync::Mutex<Option<tokio::sync::oneshot::Sender<std::path::PathBuf>>>,
    );

    #[async_trait::async_trait]
    impl sf_core::runner::CommandRunner for PendingRunner {
        async fn run(
            &self,
            _program: &str,
            args: &[String],
            _timeout: std::time::Duration,
        ) -> Result<RawOutput, SfError> {
            let path = std::path::PathBuf::from(&args[3]);
            self.0.lock().unwrap().take().unwrap().send(path).unwrap();
            std::future::pending().await
        }
    }

    #[tokio::test]
    async fn cancelling_run_removes_temporary_source() {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let invoker = SfInvoker::new(Arc::new(PendingRunner(std::sync::Mutex::new(Some(sender)))));
        let task =
            tokio::spawn(
                async move { run_anon(&invoker, "System.debug('synthetic');", None).await },
            );
        let path = tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "System.debug('synthetic');"
        );

        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let leaked = path.exists();
        if leaked {
            std::fs::remove_file(&path).unwrap();
        }
        assert!(
            !leaked,
            "cancellation left the temporary Apex source behind / 取消后临时 Apex 源码仍然存在"
        );
    }

    #[tokio::test]
    async fn completed_and_failed_runs_remove_temporary_source() {
        for fail in [false, true] {
            let path_seen = Arc::new(std::sync::Mutex::new(None));
            let captured = Arc::clone(&path_seen);
            let runner = MockRunner::new(move |_, args| {
                *captured.lock().unwrap() = Some(std::path::PathBuf::from(&args[3]));
                if fail {
                    return Err(SfError::NotFound);
                }
                Ok(RawOutput {
                    status: 0,
                    stdout: r#"{"status":0,"result":{"compiled":true,"success":true,"logs":""}}"#
                        .into(),
                    stderr: String::new(),
                })
            });
            let result = run_anon(
                &SfInvoker::new(Arc::new(runner)),
                "System.debug('synthetic');",
                None,
            )
            .await;
            assert_eq!(result.is_err(), fail);
            let path = path_seen.lock().unwrap().take().unwrap();
            assert!(
                !path.exists(),
                "finished run left the temporary Apex source behind / 执行结束后临时 Apex 源码仍然存在"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temporary_source_is_not_readable_by_other_users() {
        use std::os::unix::fs::PermissionsExt;
        let mode_seen = Arc::new(std::sync::Mutex::new(None));
        let captured = Arc::clone(&mode_seen);
        let runner = MockRunner::new(move |_, args| {
            let mode = std::fs::metadata(&args[3]).unwrap().permissions().mode();
            *captured.lock().unwrap() = Some(mode);
            Ok(RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"compiled":true,"success":true,"logs":""}}"#
                    .into(),
                stderr: String::new(),
            })
        });
        run_anon(
            &SfInvoker::new(Arc::new(runner)),
            "System.debug('synthetic');",
            None,
        )
        .await
        .unwrap();
        let mode = mode_seen.lock().unwrap().unwrap();
        assert_eq!(
            mode & 0o077,
            0,
            "temporary Apex source is accessible to other users / 其他用户可访问临时 Apex 源码"
        );
    }

    fn invoker_returning(status: i32, stdout: &str) -> SfInvoker {
        let stdout = stdout.to_string();
        SfInvoker::new(Arc::new(MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            assert_eq!(args[0], "apex");
            assert_eq!(args[1], "run");
            assert_eq!(args[2], "-f");
            assert!(args.iter().any(|a| a == "--json"));
            // the temp file must exist while sf "runs"
            assert!(
                std::path::Path::new(&args[3]).exists(),
                "temp file should exist during run"
            );
            Ok(RawOutput {
                status,
                stdout: stdout.clone(),
                stderr: String::new(),
            })
        })))
    }

    #[tokio::test]
    async fn run_anon_success_envelope_parses_result_and_log() {
        let log = "67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO\\n\
16:00:00.0 (10)|EXECUTION_STARTED\\n\
16:00:00.0 (50)|EXECUTION_FINISHED\\n";
        let stdout = format!(
            r#"{{"status":0,"result":{{"compiled":true,"success":true,
            "compileProblem":"","exceptionMessage":"","exceptionStackTrace":"",
            "line":null,"column":null,"logs":"{log}"}}}}"#
        );
        let invoker = invoker_returning(0, &stdout);
        let out = run_anon(&invoker, "System.debug('x');", None)
            .await
            .unwrap();
        assert!(out.result.success && out.result.compiled);
        let view = out.log_view.expect("log_view should be Some");
        assert_eq!(view.header.as_ref().unwrap().api_version, "67.0");
    }

    #[tokio::test]
    async fn run_anon_compile_failure_envelope_uses_data() {
        let stdout = r#"{"status":1,"name":"executeCompileFailure",
            "data":{"compiled":false,"success":false,
            "compileProblem":"Unexpected token 'x'.","exceptionMessage":"",
            "exceptionStackTrace":"","line":"1","column":"9","logs":""}}"#;
        let invoker = invoker_returning(1, stdout);
        let out = run_anon(&invoker, "x", None).await.unwrap();
        assert!(!out.result.compiled);
        assert_eq!(out.result.line, Some(1));
        assert_eq!(out.result.column, Some(9));
        assert!(out.log_view.is_none());
        match out.result.error().unwrap() {
            ApexError::Compile { message, .. } => assert!(message.contains("Unexpected")),
            other => panic!("expected Compile, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn run_anon_genuine_error_envelope_is_sf_error() {
        let stdout = r#"{"status":1,"name":"Error","message":"socket hang up"}"#;
        let invoker = invoker_returning(1, stdout);
        let err = run_anon(&invoker, "x", None).await.unwrap_err();
        match err {
            SfError::Command {
                status,
                name,
                message,
            } => {
                assert_eq!(status, 1);
                assert_eq!(name, "Error");
                assert!(message.contains("socket hang up"));
            }
            other => panic!("expected SfError::Command, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn run_anon_forwards_target_org() {
        use std::sync::Mutex;
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"success":true,"compiled":true,"logs":""}}"#
                    .into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_anon(&invoker, "System.debug(1);", Some("me@x.com"))
            .await
            .unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(
            args.windows(2).any(|w| w == ["--target-org", "me@x.com"]),
            "got: {args:?}"
        );
    }
}
