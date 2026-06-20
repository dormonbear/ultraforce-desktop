use serde::{Deserialize, Deserializer};

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Execute anonymous Apex from `apex_src`.
///
/// Writes the source to a unique temp file, runs `sf apex run -f <file> --json`
/// via `run_raw` (so a non-zero compile-failure exit still yields its payload),
/// parses the envelope, and always deletes the temp file.
pub async fn run_anon(
    invoker: &SfInvoker,
    apex_src: &str,
    target_org: Option<&str>,
) -> Result<AnonApexOutcome, SfError> {
    let path = unique_temp_path();
    std::fs::write(&path, apex_src).map_err(SfError::Spawn)?;

    let path_str = path.to_string_lossy().into_owned();
    let mut args = vec!["apex", "run", "-f", &path_str, "--json"];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    let raw = invoker.run_raw(&args).await;

    let _ = std::fs::remove_file(&path); // best-effort cleanup, even on error

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

/// A process-unique temp path under the system temp dir.
fn unique_temp_path() -> std::path::PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "ultraforce-anon-{}-{nanos}-{n}.apex",
        std::process::id()
    ))
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
