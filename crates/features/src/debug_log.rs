use serde::Deserialize;
use sf_core::{ApexLogRef, SfError, SfInvoker};

use log_parser::header::LogHeader;
use log_parser::limits::{extract_limits, LimitRollup};
use log_parser::parse::ParsedLog;
use log_parser::tree::{build_tree, ExecNode};

/// List recent debug logs via `sf apex list log`.
pub async fn list_logs(invoker: &SfInvoker) -> Result<Vec<ApexLogRef>, SfError> {
    invoker.run_json(&["apex", "list", "log"]).await
}

#[derive(Deserialize)]
struct LogBody {
    log: String,
}

/// Fetch one debug log's raw body by Id via `sf apex get log -i <id>`.
pub async fn get_log_body(invoker: &SfInvoker, id: &str) -> Result<String, SfError> {
    let bodies: Vec<LogBody> = invoker.run_json(&["apex", "get", "log", "-i", id]).await?;
    bodies
        .into_iter()
        .next()
        .map(|b| b.log)
        .ok_or_else(|| SfError::Unexpected("empty `apex get log` result".to_string()))
}

/// One execution unit's derived views.
#[derive(Debug, Clone)]
pub struct UnitView {
    pub tree: Vec<ExecNode>,
    pub limits: Vec<LimitRollup>,
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
                limits: extract_limits(u),
            })
            .collect();
        DebugLogView {
            header: parsed.header,
            units,
        }
    }
}

/// Fetch a log body by Id and parse it into a `DebugLogView`.
pub async fn fetch_and_parse(invoker: &SfInvoker, id: &str) -> Result<DebugLogView, SfError> {
    let body = get_log_body(invoker, id).await?;
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
        let logs = list_logs(&invoker).await.unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].id, "07L1");
        assert_eq!(logs[1].operation, "Api");
    }

    #[tokio::test]
    async fn get_log_body_extracts_log_field() {
        let json = r#"{"status":0,"result":[{"log":"67.0 APEX_CODE,DEBUG\n16:00:00.0 (1)|EXECUTION_STARTED"}]}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let body = get_log_body(&invoker, "07L1").await.unwrap();
        assert!(body.contains("EXECUTION_STARTED"));
    }

    #[tokio::test]
    async fn get_log_body_errors_on_empty_result() {
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":0,"result":[]}"#)));
        let err = get_log_body(&invoker, "x").await.unwrap_err();
        assert!(
            matches!(err, sf_core::SfError::Unexpected(_)),
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
        let log_json = serde_json::to_string(SAMPLE).unwrap();
        let json = format!(r#"{{"status":0,"result":[{{"log":{log_json}}}]}}"#);
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let v = fetch_and_parse(&invoker, "07L1").await.unwrap();
        assert_eq!(v.units.len(), 1);
        assert_eq!(v.header.unwrap().api_version, "67.0");
    }
}
