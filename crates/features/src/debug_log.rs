use sf_core::{ApexLogRef, SfError, SfInvoker};

use log_parser::header::LogHeader;
use log_parser::exceptions::{exceptions, ApexException};
use log_parser::limits::{extract_limits, LimitRollup};
use log_parser::parse::ParsedLog;
use log_parser::statements::{statements, Statement};
use log_parser::tree::{build_tree, ExecNode};

/// List recent debug logs via `sf apex list log`.
pub async fn list_logs(
    invoker: &SfInvoker,
    target_org: Option<&str>,
) -> Result<Vec<ApexLogRef>, SfError> {
    let mut args = vec!["apex", "list", "log"];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    invoker.run_json(&args).await
}

/// Fetch one debug log's raw body by Id via `sf apex get log -i <id>`.
///
/// Deliberately NOT `--json`: the sf CLI crashes (`RangeError: Maximum call
/// stack size exceeded`) trying to JSON-serialise very large logs (10 MB+),
/// returning empty stdout. The plain command streams the raw body directly, but
/// colourises it with ANSI escapes, which we strip.
pub async fn get_log_body(
    invoker: &SfInvoker,
    id: &str,
    target_org: Option<&str>,
) -> Result<String, SfError> {
    let mut args = vec!["apex", "get", "log", "-i", id];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    let out = invoker.run_raw(&args).await?;
    if out.status != 0 {
        let msg = out.stderr.trim();
        return Err(SfError::Command {
            status: out.status,
            name: "apex get log".to_string(),
            message: if msg.is_empty() {
                "empty `apex get log` result".to_string()
            } else {
                msg.to_string()
            },
        });
    }
    Ok(strip_ansi(&out.stdout))
}

/// Remove ANSI CSI escape sequences (`ESC [ … <final>`) the sf CLI adds when it
/// colourises non-JSON log output. Fast-paths clean text.
fn strip_ansi(s: &str) -> String {
    if !s.contains('\u{1b}') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Skip "[ <params> <final>" where final is 0x40..=0x7E.
            if chars.clone().next() == Some('[') {
                chars.next();
                for p in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&p) {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

/// One execution unit's derived views.
#[derive(Debug, Clone)]
pub struct UnitView {
    pub tree: Vec<ExecNode>,
    pub statements: Vec<Statement>,
    pub limits: Vec<LimitRollup>,
    pub exceptions: Vec<ApexException>,
}

/// A parsed debug log ready for display: header plus per-unit tree + limits.
#[derive(Debug, Clone)]
pub struct DebugLogView {
    pub header: Option<LogHeader>,
    pub units: Vec<UnitView>,
}

impl DebugLogView {
    /// Pure pipeline: raw log text → view model.
    pub fn from_log(text: &str) -> DebugLogView {
        let parsed = ParsedLog::parse(text);
        let units = parsed
            .units
            .iter()
            .map(|u| UnitView {
                tree: build_tree(u),
                statements: statements(u),
                limits: extract_limits(u),
                exceptions: exceptions(u),
            })
            .collect();
        DebugLogView {
            header: parsed.header,
            units,
        }
    }
}

/// Fetch a log body by Id and parse it into a `DebugLogView`.
pub async fn fetch_and_parse(
    invoker: &SfInvoker,
    id: &str,
    target_org: Option<&str>,
) -> Result<DebugLogView, SfError> {
    let body = get_log_body(invoker, id, target_org).await?;
    Ok(DebugLogView::from_log(&body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use sf_core::SfInvoker;
    use std::sync::Arc;

    #[tokio::test]
    async fn list_logs_parses_records() {
        let json = r#"{"status":0,"result":[
            {"Id":"07L1","Operation":"/services/data","Status":"Success","StartTime":"2026-06-18T00:00:00.000+0000","LogLength":10,"DurationMilliseconds":5,"Application":"Unknown"},
            {"Id":"07L2","Operation":"Api","Status":"Success","StartTime":"2026-06-18T00:00:01.000+0000","LogLength":20,"DurationMilliseconds":7,"Application":"Unknown"}
        ]}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let logs = list_logs(&invoker, None).await.unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].id, "07L1");
        assert_eq!(logs[1].operation, "Api");
    }

    #[tokio::test]
    async fn get_log_body_returns_raw_and_strips_ansi() {
        // Non-JSON `apex get log` streams the raw body, colourised with ANSI.
        let colored = "\x1b[1m67.0 APEX_CODE,DEBUG\x1b[22m\n\x1b[94m16\x1b[39m:00:00.0 (1)|EXECUTION_STARTED";
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(colored)));
        let body = get_log_body(&invoker, "07L1", None).await.unwrap();
        assert!(body.contains("EXECUTION_STARTED"));
        assert!(!body.contains('\x1b'), "ANSI codes not stripped: {body:?}");
        assert!(body.starts_with("67.0 APEX_CODE"), "got: {body:?}");
    }

    #[tokio::test]
    async fn get_log_body_errors_on_nonzero_status() {
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(|_, _| {
            Ok(sf_core::runner::RawOutput {
                status: 1,
                stdout: String::new(),
                stderr: "No log found for id x".to_string(),
            })
        })));
        let err = get_log_body(&invoker, "x", None).await.unwrap_err();
        assert!(
            matches!(err, sf_core::SfError::Command { .. }),
            "got: {err:?}"
        );
    }

    const SAMPLE: &str = "67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO\n\
16:00:00.0 (10)|EXECUTION_STARTED\n\
16:00:00.0 (20)|CODE_UNIT_STARTED|x\n\
16:00:00.0 (30)|LIMIT_USAGE_FOR_NS|(default)|\n\
\x20\x20Number of SOQL queries: 2 out of 100\n\
16:00:00.0 (40)|CODE_UNIT_FINISHED|x\n\
16:00:00.0 (50)|EXECUTION_FINISHED\n";

    #[test]
    fn from_log_builds_view() {
        let v = DebugLogView::from_log(SAMPLE);
        assert_eq!(v.header.as_ref().unwrap().api_version, "67.0");
        assert_eq!(v.units.len(), 1);
        assert_eq!(v.units[0].tree.len(), 1); // single EXECUTION root
        assert_eq!(v.units[0].limits[0].entries[0].used, 2);
    }

    #[tokio::test]
    async fn fetch_and_parse_wires_get_and_parse() {
        // Raw (non-JSON) body streamed straight back.
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(SAMPLE)));
        let v = fetch_and_parse(&invoker, "07L1", None).await.unwrap();
        assert_eq!(v.units.len(), 1);
        assert_eq!(v.header.unwrap().api_version, "67.0");
    }
}
