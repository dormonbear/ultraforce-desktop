//! Anonymous-Apex execution and org Apex-source retrieval.

use std::time::Instant;

use crate::dto::{ApexOutcomeDto, ApexSourceDto};
use crate::error::CommandError;
use crate::state::AppState;

#[derive(serde::Deserialize)]
struct ApexBodyRow {
    #[serde(rename = "Body")]
    body: Option<String>,
}
#[derive(serde::Deserialize)]
struct ApexBodyResult {
    records: Vec<ApexBodyRow>,
}

/// Fetch an Apex class or trigger's source from the org via the Tooling API, so
/// a log finding can show the offending code. Tries ApexClass, then ApexTrigger.
pub(crate) async fn fetch_apex_source(
    name: String,
    org: Option<String>,
    state: &AppState,
) -> Result<ApexSourceDto, CommandError> {
    let escaped = name.replace('\'', "\\'");
    for (kind, sobject) in [("class", "ApexClass"), ("trigger", "ApexTrigger")] {
        let soql = format!("SELECT Body FROM {sobject} WHERE Name = '{escaped}' LIMIT 1");
        let mut args = vec!["data", "query", "--use-tooling-api", "-q", &soql];
        if let Some(o) = org.as_deref() {
            args.push("--target-org");
            args.push(o);
        }
        if let Ok(result) = state.invoker.run_json::<ApexBodyResult>(&args).await {
            if let Some(body) = result.records.into_iter().next().and_then(|r| r.body) {
                return Ok(ApexSourceDto {
                    name,
                    kind: kind.to_string(),
                    body,
                });
            }
        }
    }
    Err(CommandError::new(
        "not_found",
        format!("No Apex class or trigger named '{name}' found in this org"),
    ))
}

pub(crate) async fn run_apex(
    src: String,
    org: Option<String>,
    state: &AppState,
) -> Result<ApexOutcomeDto, CommandError> {
    let start = Instant::now();
    tracing::info!("run_apex start");
    let outcome = features::anon_apex::run_anon(&state.invoker, &src, org.as_deref())
        .await
        .map_err(|e| {
            tracing::warn!(
                elapsed_ms = start.elapsed().as_millis(),
                outcome = "err",
                "run_apex complete"
            );
            CommandError::from(e)
        })?;
    let r = outcome.result;
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        "run_apex complete"
    );
    Ok(ApexOutcomeDto {
        compiled: r.compiled,
        success: r.success,
        compile_problem: r.compile_problem,
        exception_message: r.exception_message,
        exception_stack_trace: r.exception_stack_trace,
        line: r.line,
        column: r.column,
        logs: r.logs,
    })
}
