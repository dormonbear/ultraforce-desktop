use std::sync::Arc;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::State;

mod dto;
use dto::{map_units, UnitDto};

/// Shared application state: one `SfInvoker` over the real `sf` CLI process runner.
pub struct AppState {
    invoker: SfInvoker,
}

/// Flat, table-shaped query result handed to the frontend.
#[derive(serde::Serialize)]
struct TableDto {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    total_size: u64,
}

#[tauri::command]
async fn run_soql(query: String, state: State<'_, AppState>) -> Result<TableDto, String> {
    let table = features::soql::run_query_table(&state.invoker, &query, None)
        .await
        .map_err(|e| format!("{e:?}"))?;
    let total_size = table.rows.len() as u64;
    Ok(TableDto {
        columns: table.columns,
        rows: table.rows,
        total_size,
    })
}

/// Result of one anonymous-Apex run, flattened for the frontend.
#[derive(serde::Serialize)]
struct ApexOutcomeDto {
    compiled: bool,
    success: bool,
    compile_problem: Option<String>,
    exception_message: Option<String>,
    exception_stack_trace: Option<String>,
    line: Option<i64>,
    column: Option<i64>,
    logs: String,
}

#[tauri::command]
async fn run_apex(src: String, state: State<'_, AppState>) -> Result<ApexOutcomeDto, String> {
    let outcome = features::anon_apex::run_anon(&state.invoker, &src, None)
        .await
        .map_err(|e| format!("{e:?}"))?;
    let r = outcome.result;
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

/// One debug-log list entry handed to the frontend.
#[derive(serde::Serialize)]
struct LogRefDto {
    id: String,
    operation: String,
    status: String,
    start_time: String,
    application: String,
}

#[tauri::command]
async fn list_logs(state: State<'_, AppState>) -> Result<Vec<LogRefDto>, String> {
    let logs = features::debug_log::list_logs(&state.invoker, None)
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(logs
        .into_iter()
        .map(|l| LogRefDto {
            id: l.id,
            operation: l.operation,
            status: l.status,
            start_time: l.start_time,
            application: l.application,
        })
        .collect())
}

/// A fetched debug log's raw body plus its parsed execution tree + limits.
#[derive(serde::Serialize)]
struct LogViewDto {
    raw: String,
    api_version: Option<String>,
    units: Vec<UnitDto>,
}

#[tauri::command]
async fn get_log(id: String, state: State<'_, AppState>) -> Result<LogViewDto, String> {
    let body = features::debug_log::get_log_body(&state.invoker, &id, None)
        .await
        .map_err(|e| format!("{e:?}"))?;
    let view = features::debug_log::DebugLogView::from_log(&body);
    Ok(LogViewDto {
        api_version: view.header.as_ref().map(|h| h.api_version.clone()),
        units: map_units(&view),
        raw: body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        invoker: SfInvoker::new(Arc::new(ProcessRunner)),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            run_soql, run_apex, list_logs, get_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
