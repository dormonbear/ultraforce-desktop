use std::sync::Arc;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::{AppHandle, State};

mod apex_exec;
mod completion;
mod debug_cfg;
mod dto;
mod error;
mod indexing;
mod setup;
mod sf_cli;
mod soql_exec;
mod state;

use error::CommandError;
use state::{cached_log_view, current_org, parsed_log, AppState};

#[tauri::command]
async fn run_soql(
    query: String,
    use_tooling_api: Option<bool>,
    all_rows: Option<bool>,
    query_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dto::SoqlResultDto, CommandError> {
    soql_exec::run_soql(query, use_tooling_api, all_rows, query_id, app, &state).await
}

#[tauri::command]
fn cancel_soql(query_id: String, state: State<'_, AppState>) {
    soql_exec::cancel_soql(&query_id, &state);
}

#[tauri::command]
async fn count_soql(
    query: String,
    use_tooling_api: Option<bool>,
    query_id: String,
    state: State<'_, AppState>,
) -> Result<Option<u64>, CommandError> {
    soql_exec::count_soql(query, use_tooling_api, query_id, &state).await
}

#[tauri::command]
async fn fetch_apex_source(
    name: String,
    state: State<'_, AppState>,
) -> Result<dto::ApexSourceDto, CommandError> {
    apex_exec::fetch_apex_source(name, &state).await
}

/// Pretty-print a SOQL query (one top-level clause per line). Pure, no IO.
#[tauri::command]
fn format_soql(query: String) -> String {
    soql_lang::format_soql(&query)
}

/// Re-indent anonymous Apex by brace depth. Pure, no IO.
#[tauri::command]
fn format_apex(src: String) -> String {
    apex_lang::format_apex(&src)
}

/// Fetch the SOQL query plan (EXPLAIN): cost / cardinality / leading operation.
#[tauri::command]
async fn query_plan(
    query: String,
    state: State<'_, AppState>,
) -> Result<features::query_plan::QueryPlan, CommandError> {
    let org = current_org(&state);
    features::query_plan::query_plan(&state.invoker, &query, org.as_deref())
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
async fn run_apex(
    src: String,
    state: State<'_, AppState>,
) -> Result<dto::ApexOutcomeDto, CommandError> {
    apex_exec::run_apex(src, &state).await
}

#[tauri::command]
async fn list_logs(state: State<'_, AppState>) -> Result<Vec<dto::LogRefDto>, CommandError> {
    let org = current_org(&state);
    let logs = features::debug_log::list_logs(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(logs.into_iter().map(dto::map_log_ref).collect())
}

#[tauri::command]
async fn get_log(id: String, state: State<'_, AppState>) -> Result<dto::LogViewDto, CommandError> {
    let org = current_org(&state);
    let body = features::debug_log::get_log_body(&state.invoker, &id, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    let view = cached_log_view(&state, &body);
    let parsed = dto::parsed_dto(&view);
    // The org fetch is the only path where the frontend doesn't already have the
    // body, so this is the one place that returns `raw`.
    Ok(dto::LogViewDto {
        raw: body,
        api_version: parsed.api_version,
        units: parsed.units,
    })
}

/// Parse a raw debug-log body supplied by the caller (a reopened cached log or an
/// opened local `.log` file). Returns no `raw` — the caller re-attaches the body
/// it already holds.
#[tauri::command]
fn parse_log(body: String, state: State<'_, AppState>) -> dto::ParsedLogDto {
    dto::parsed_dto(&cached_log_view(&state, &body))
}

/// Resolve the Apex source for a single raw log line on demand (click-to-source).
/// `line` is the 0-based index into `raw.split('\n')`. Returns `None` when the
/// line maps to no source. Avoids shipping a line-length source array over IPC.
#[tauri::command]
fn source_at_line(
    body: String,
    line: usize,
    state: State<'_, AppState>,
) -> Option<dto::SourceRefDto> {
    cached_log_view(&state, &body)
        .raw_sources
        .get(line)
        .and_then(|o| o.as_ref())
        .map(dto::map_source)
}

/// Raw line indices (0-based into `raw.split('\n')`) that resolve to Apex source,
/// so the viewer can mark just those lines clickable. Compact: only the resolved
/// indices, not the full per-line array.
#[tauri::command]
fn source_line_indices(body: String, state: State<'_, AppState>) -> Vec<u32> {
    cached_log_view(&state, &body)
        .raw_sources
        .iter()
        .enumerate()
        .filter_map(|(i, o)| o.as_ref().map(|_| i as u32))
        .collect()
}

/// Build the offline step-debugger outline for a raw log body: the ordered stop
/// points across all execution units (lightweight — no per-step call-stack
/// snapshots, so opening over a large log stays cheap). Call stacks + variables
/// are fetched per step via `debug_frames_at`.
#[tauri::command]
fn debug_session(raw: String, state: State<'_, AppState>) -> dto::DebugSessionDto {
    let parsed = parsed_log(&state, &raw);
    dto::map_session(&log_parser::debug_session::build_outline(&parsed.units))
}

/// Reconstruct the call stack (with variables) at one stop point, on demand.
#[tauri::command]
fn debug_frames_at(
    raw: String,
    unit_index: usize,
    entry_index: usize,
    state: State<'_, AppState>,
) -> Vec<dto::FrameDto> {
    let parsed = parsed_log(&state, &raw);
    match parsed.units.get(unit_index) {
        Some(unit) => dto::map_frames(&log_parser::debug_session::frames_at(unit, entry_index)),
        None => Vec::new(),
    }
}

/// Read a log file the user dropped onto the window (arbitrary path, outside the
/// fs plugin's dialog-granted scope).
#[tauri::command]
fn read_log_file(path: String) -> Result<String, CommandError> {
    std::fs::read_to_string(&path).map_err(CommandError::from)
}

/// List the available Salesforce orgs via `sf org list`.
#[tauri::command]
async fn list_orgs(state: State<'_, AppState>) -> Result<Vec<dto::OrgDto>, CommandError> {
    let orgs = sf_core::OrgRegistry::list(&state.invoker)
        .await
        .map_err(CommandError::from)?;
    Ok(orgs.iter().map(dto::OrgDto::from).collect())
}

#[tauri::command]
async fn sf_status(state: State<'_, AppState>) -> Result<dto::SfStatusDto, CommandError> {
    sf_cli::sf_status(&state).await
}

#[tauri::command]
async fn login_org(
    instance_url: Option<String>,
    alias: Option<String>,
    set_default: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    sf_cli::login_org(instance_url, alias, set_default, &state).await
}

/// Set (or clear) the target org used by all subsequent `sf` calls.
#[tauri::command]
fn set_target_org(username: Option<String>, state: State<'_, AppState>) -> Result<(), CommandError> {
    *state.selected_org.lock().unwrap() = username;
    Ok(())
}

#[tauri::command]
async fn get_debug_config(state: State<'_, AppState>) -> Result<dto::DebugConfigDto, CommandError> {
    debug_cfg::get_debug_config(&state).await
}

#[tauri::command]
async fn set_debug_config(
    levels: dto::CategoryLevelsDto,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    debug_cfg::set_debug_config(levels, &state).await
}

#[tauri::command]
async fn quick_self_trace(
    minutes: Option<u32>,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    debug_cfg::quick_self_trace(minutes, &state).await
}

#[tauri::command]
async fn load_logging_config(state: State<'_, AppState>) -> Result<dto::LoggingConfigDto, CommandError> {
    debug_cfg::load_logging_config(&state).await
}

#[tauri::command]
async fn save_logging_config(
    diff: dto::LoggingDiffDto,
    state: State<'_, AppState>,
) -> Result<dto::SaveOutcomeDto, CommandError> {
    debug_cfg::save_logging_config(diff, &state).await
}

#[tauri::command]
async fn apex_complete(
    src: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CandidateDto>, CommandError> {
    completion::apex_complete(src, offset, &state).await
}

#[tauri::command]
async fn apex_signature_help(
    src: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Option<dto::SignatureHelpDto>, CommandError> {
    completion::apex_signature_help(src, offset, &state).await
}

#[tauri::command]
async fn warm_apex(org: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    indexing::warm_apex(org, &state).await
}

#[tauri::command]
async fn soql_complete(
    query: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CompletionDto>, CommandError> {
    completion::soql_complete(query, offset, &state).await
}

#[tauri::command]
async fn warm_schema(org: String, state: State<'_, AppState>) -> Result<usize, CommandError> {
    indexing::warm_schema(org, &state).await
}

#[tauri::command]
async fn refresh_schema_cache(org: String, state: State<'_, AppState>) -> Result<usize, CommandError> {
    indexing::refresh_schema_cache(org, &state).await
}

#[tauri::command]
async fn index_org(
    org: String,
    namespaces: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    indexing::index_org(org, namespaces, &app, &state).await
}

#[tauri::command]
async fn reindex_org(
    org: String,
    namespaces: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    indexing::reindex_org(org, namespaces, &app, &state).await
}

#[tauri::command]
async fn soql_diagnostics(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::soql::SoqlDiagnostic>, CommandError> {
    Ok(completion::soql_diagnostics(query, &state).await)
}

#[tauri::command]
async fn apex_soql_diagnostics(
    src: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::soql::SoqlDiagnostic>, CommandError> {
    Ok(completion::apex_soql_diagnostics(src, &state).await)
}

#[tauri::command]
async fn apex_diagnostics(
    src: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::apex_complete::ApexDiagnostic>, CommandError> {
    Ok(completion::apex_diagnostics(src, &state))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _guard = setup::init_tracing();
    #[cfg(target_os = "macos")]
    setup::inherit_login_path();
    #[cfg(target_os = "macos")]
    setup::use_file_keystore();
    let state = AppState {
        invoker: SfInvoker::new(Arc::new(ProcessRunner)),
        selected_org: std::sync::Mutex::new(None),
        apex: features::apex_complete::ApexCompleter::with_default_root(),
        sobjects: std::sync::Mutex::new(std::collections::HashMap::new()),
        query_cancels: std::sync::Mutex::new(std::collections::HashMap::new()),
        auth_cache: std::sync::Mutex::new(std::collections::HashMap::new()),
        log_cache: std::sync::Mutex::new(None),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            run_soql,
            cancel_soql,
            count_soql,
            fetch_apex_source,
            run_apex,
            list_logs,
            get_log,
            list_orgs,
            set_target_org,
            get_debug_config,
            set_debug_config,
            quick_self_trace,
            load_logging_config,
            save_logging_config,
            apex_complete,
            apex_signature_help,
            soql_complete,
            warm_apex,
            warm_schema,
            refresh_schema_cache,
            index_org,
            reindex_org,
            soql_diagnostics,
            apex_soql_diagnostics,
            apex_diagnostics,
            query_plan,
            format_soql,
            format_apex,
            parse_log,
            source_at_line,
            source_line_indices,
            debug_session,
            debug_frames_at,
            sf_status,
            login_org,
            read_log_file
        ])
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
