//! Anonymous Apex over `sf apex run` (via features::anon_apex), prod-gated,
//! with the debug log distilled to USER_DEBUG/EXCEPTION/FATAL lines.

use std::time::Duration;

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::{gate_write, LiveCtx};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApexRunDto {
    pub org: String,
    pub compiled: bool,
    pub success: bool,
    pub compile_problem: Option<String>,
    pub exception_message: Option<String>,
    pub exception_stack_trace: Option<String>,
    pub line: Option<i64>,
    pub column: Option<i64>,
    /// USER_DEBUG / EXCEPTION_THROWN / FATAL_ERROR lines from the debug log.
    pub debug: Vec<String>,
    pub log_truncated: bool,
}

const DEBUG_MARKERS: [&str; 3] = ["|USER_DEBUG|", "|EXCEPTION_THROWN|", "|FATAL_ERROR"];

pub fn extract_debug(logs: &str, cap: usize) -> (Vec<String>, bool) {
    let mut out = Vec::new();
    let mut truncated = false;
    for line in logs.lines() {
        if DEBUG_MARKERS.iter().any(|m| line.contains(m)) {
            if out.len() == cap {
                truncated = true;
                break;
            }
            out.push(line.to_string());
        }
    }
    (out, truncated)
}

pub async fn apex_run(
    live: &LiveCtx,
    org: &str,
    code: &str,
    confirm: bool,
) -> Result<ApexRunDto, ErrorData> {
    // Anonymous Apex can mutate anything — gate on prod like a write.
    gate_write(live.is_prod(org).await, confirm)?;

    let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(sf_core::ProcessRunner))
        .with_timeout(Duration::from_secs(300));
    let outcome = features::anon_apex::run_anon(&invoker, code, Some(org))
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;

    let r = outcome.result;
    let (debug, log_truncated) = extract_debug(&r.logs, 200);
    Ok(ApexRunDto {
        org: org.to_string(),
        compiled: r.compiled,
        success: r.success,
        compile_problem: r.compile_problem,
        exception_message: r.exception_message,
        exception_stack_trace: r.exception_stack_trace,
        line: r.line,
        column: r.column,
        debug,
        log_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_user_debug_and_exception_lines() {
        let log = "\
09:00:00.1 (1)|EXECUTION_STARTED
09:00:00.2 (2)|USER_DEBUG|[1]|DEBUG|hello
09:00:00.3 (3)|SOQL_EXECUTE_BEGIN|[2]|SELECT Id FROM Account
09:00:00.4 (4)|EXCEPTION_THROWN|[3]|System.NullPointerException
09:00:00.5 (5)|FATAL_ERROR|System.NullPointerException: boom
09:00:00.6 (6)|EXECUTION_FINISHED";
        let (lines, truncated) = extract_debug(log, 200);
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("hello"));
        assert!(lines[1].contains("EXCEPTION_THROWN"));
        assert!(lines[2].contains("FATAL_ERROR"));
        assert!(!truncated);
    }

    #[test]
    fn caps_line_count() {
        let log = (0..500)
            .map(|i| format!("t ({i})|USER_DEBUG|[1]|DEBUG|line{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (lines, truncated) = extract_debug(&log, 200);
        assert_eq!(lines.len(), 200);
        assert!(truncated);
    }
}
