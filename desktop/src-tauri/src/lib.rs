use std::sync::Arc;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::State;

mod dto;
use dto::{map_units, UnitDto};

/// Shared application state: one `SfInvoker` over the real `sf` CLI process runner.
pub struct AppState {
    invoker: SfInvoker,
    selected_org: std::sync::Mutex<Option<String>>,
}

/// Read the currently selected target org as an owned value (guard not held across `.await`).
fn current_org(state: &AppState) -> Option<String> {
    state.selected_org.lock().unwrap().clone()
}

/// A SOQL query result: flat table projection plus the raw record tree.
#[derive(serde::Serialize)]
struct SoqlResultDto {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    total_size: u64,
    done: bool,
    tree: Vec<dto::RecordDto>,
}

#[tauri::command]
async fn run_soql(query: String, state: State<'_, AppState>) -> Result<SoqlResultDto, String> {
    let org = current_org(&state);
    let result = features::soql::run_query(&state.invoker, &query, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    let table = result.to_table();
    Ok(SoqlResultDto {
        columns: table.columns,
        rows: table.rows,
        total_size: result.total_size,
        done: result.done,
        tree: result.records.iter().map(dto::map_record).collect(),
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
    let org = current_org(&state);
    let outcome = features::anon_apex::run_anon(&state.invoker, &src, org.as_deref())
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
    let org = current_org(&state);
    let logs = features::debug_log::list_logs(&state.invoker, org.as_deref())
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
    let org = current_org(&state);
    let body = features::debug_log::get_log_body(&state.invoker, &id, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    let view = features::debug_log::DebugLogView::from_log(&body);
    Ok(LogViewDto {
        api_version: view.header.as_ref().map(|h| h.api_version.clone()),
        units: map_units(&view),
        raw: body,
    })
}

/// List the available Salesforce orgs via `sf org list`.
#[tauri::command]
async fn list_orgs(state: State<'_, AppState>) -> Result<Vec<dto::OrgDto>, String> {
    let orgs = sf_core::OrgRegistry::list(&state.invoker)
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(orgs.iter().map(dto::OrgDto::from).collect())
}

/// Set (or clear) the target org used by all subsequent `sf` calls.
#[tauri::command]
fn set_target_org(username: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    *state.selected_org.lock().unwrap() = username;
    Ok(())
}

#[tauri::command]
async fn get_debug_config(state: State<'_, AppState>) -> Result<dto::DebugConfigDto, String> {
    let org = current_org(&state);
    let cfg = features::debug_config::get_debug_config(&state.invoker, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

#[tauri::command]
async fn set_debug_config(
    levels: dto::CategoryLevelsDto,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, String> {
    let org = current_org(&state);
    let core = features::debug_config::CategoryLevels::from(&levels);
    let cfg = features::debug_config::set_debug_config(&state.invoker, &core, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        invoker: SfInvoker::new(Arc::new(ProcessRunner)),
        selected_org: std::sync::Mutex::new(None),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            run_soql,
            run_apex,
            list_logs,
            get_log,
            list_orgs,
            set_target_org,
            get_debug_config,
            set_debug_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
