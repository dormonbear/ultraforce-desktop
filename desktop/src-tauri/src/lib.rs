use std::sync::Arc;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::{AppHandle, State};

mod apex_exec;
mod completion;
mod debug_cfg;
mod dto;
mod error;
mod index_coordinator;
mod indexing;
mod org_config;
mod schema_browse;
mod setup;
mod sf_cli;
mod soql_exec;
mod state;
mod telemetry;
mod telemetry_cfg;

use error::CommandError;
use state::{cached_log_view, parsed_log, AppState};

#[tauri::command]
async fn run_soql(
    query: String,
    use_tooling_api: Option<bool>,
    all_rows: Option<bool>,
    query_id: String,
    org: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dto::SoqlResultDto, CommandError> {
    telemetry::track("run_soql", async { soql_exec::run_soql(query, use_tooling_api, all_rows, query_id, org, app, &state).await }).await
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
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<u64>, CommandError> {
    soql_exec::count_soql(query, use_tooling_api, query_id, org, &state).await
}

#[tauri::command]
async fn fetch_apex_source(
    name: String,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::ApexSourceDto, CommandError> {
    apex_exec::fetch_apex_source(name, org, &state).await
}

/// Pretty-print a SOQL query (one top-level clause per line). Pure, no IO.
#[tauri::command]
fn format_soql(query: String) -> String {
    soql_lang::format_soql(&query)
}

/// Inner subquery `(SELECT … )` ranges (UTF-16 offsets) for editor highlighting.
/// Pure, no IO; infallible like `format_soql`.
#[tauri::command]
fn soql_subquery_spans(query: String) -> Vec<dto::SubquerySpanDto> {
    dto::subquery_spans(&query)
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
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::QueryPlanDto, CommandError> {
    let plan = features::query_plan::query_plan(&state.invoker, &query, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::QueryPlanDto::from(plan))
}

#[tauri::command]
async fn run_apex(
    src: String,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::ApexOutcomeDto, CommandError> {
    telemetry::track("run_apex", async { apex_exec::run_apex(src, org, &state).await }).await
}

#[tauri::command]
async fn list_logs(
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::LogRefDto>, CommandError> {
    let logs = features::debug_log::list_logs(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(logs.into_iter().map(dto::map_log_ref).collect())
}

#[tauri::command]
async fn get_log(
    id: String,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::LogViewDto, CommandError> {
    telemetry::track("get_log", async {
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
    })
    .await
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
    telemetry::track("login_org", async { sf_cli::login_org(instance_url, alias, set_default, &state).await }).await
}

/// Set (or clear) the target org used by all subsequent `sf` calls. Also applies
/// the org's per-org config (API-version override + request timeout) so every
/// downstream call reflects it. Re-invoked by the frontend after a config save to
/// refresh those bounds.
#[tauri::command]
fn set_target_org(
    username: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    *state.selected_org.lock().unwrap() = username.clone();
    match username {
        Some(u) => org_config::apply_org_config(&app, &state, &u),
        None => org_config::reset_to_default(&state),
    }
    Ok(())
}

/// The org's *detected* (dynamic) API version via `sf org display`, ignoring any
/// override — the baseline shown as the config edit-panel placeholder and the
/// per-org fallback for the switcher list.
#[tauri::command]
async fn org_api_version(
    org: String,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    Ok(features::api_version::detected_api_version_for(&state.invoker, &org).await)
}

#[tauri::command]
async fn get_debug_config(
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    debug_cfg::get_debug_config(org, &state).await
}

#[tauri::command]
async fn set_debug_config(
    levels: dto::CategoryLevelsDto,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    debug_cfg::set_debug_config(levels, org, &state).await
}

#[tauri::command]
async fn get_telemetry_config() -> Result<dto::TelemetryConfigDto, CommandError> {
    telemetry_cfg::get_telemetry_config()
}

/// Whether this launch switched telemetry on by itself (dev builds seed it).
/// The settings panel discloses it; the frontend can't infer it, since Vite's
/// DEV flag and Rust's `debug_assertions` disagree under `tauri build --debug`.
#[tauri::command]
fn telemetry_dev_seeded() -> bool {
    telemetry::dev_seeded()
}

#[tauri::command]
async fn set_telemetry_config(config: dto::TelemetryConfigDto) -> Result<(), CommandError> {
    telemetry_cfg::set_telemetry_config(config)
}

#[tauri::command]
async fn quick_self_trace(
    minutes: Option<u32>,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    debug_cfg::quick_self_trace(minutes, org, &state).await
}

#[tauri::command]
async fn load_logging_config(
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::LoggingConfigDto, CommandError> {
    debug_cfg::load_logging_config(org, &state).await
}

#[tauri::command]
async fn save_logging_config(
    diff: dto::LoggingDiffDto,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::SaveOutcomeDto, CommandError> {
    debug_cfg::save_logging_config(diff, org, &state).await
}

#[tauri::command]
async fn apex_complete(
    src: String,
    offset: usize,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CandidateDto>, CommandError> {
    completion::apex_complete(src, offset, org, &state).await
}

#[tauri::command]
async fn apex_signature_help(
    src: String,
    offset: usize,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<dto::SignatureHelpDto>, CommandError> {
    completion::apex_signature_help(src, offset, org, &state).await
}

#[tauri::command]
async fn warm_apex(org: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    indexing::warm_apex(org, &state).await
}

#[tauri::command]
async fn soql_complete(
    query: String,
    offset: usize,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CompletionDto>, CommandError> {
    completion::soql_complete(query, offset, org, &state).await
}

#[tauri::command]
async fn refresh_schema_cache(org: String, state: State<'_, AppState>) -> Result<usize, CommandError> {
    telemetry::track("refresh_schema_cache", async { indexing::refresh_schema_cache(org, &state).await }).await
}

/// Idempotently make `org`'s index usable (single-flight; no-op when fresh).
/// Replaces the former parallel `warm_schema` + `index_org` calls.
#[tauri::command]
async fn ensure_ready(
    org: String,
    namespaces: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    index_coordinator::ensure_ready(&app, &state, org, namespaces).await
}

/// Force a full rebuild of `org`'s cached schema index (queued behind any run).
#[tauri::command]
async fn reindex_org(
    org: String,
    namespaces: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    telemetry::track("reindex_org", async { index_coordinator::reindex(&app, &state, org, namespaces).await }).await
}

/// Queryable index-lifecycle snapshot for `org` (state / progress / last-indexed).
#[tauri::command]
fn index_status(org: String, state: State<'_, AppState>) -> dto::IndexStatusDto {
    state.index.status(&org)
}

#[tauri::command]
async fn schema_list_objects(
    org: String,
    state: State<'_, AppState>,
) -> Result<Vec<dto::SchemaObjectDto>, CommandError> {
    schema_browse::list_objects(&org, &state)
}

#[tauri::command]
async fn schema_object_detail(
    org: String,
    object: String,
    state: State<'_, AppState>,
) -> Result<dto::SchemaObjectDetailDto, CommandError> {
    schema_browse::object_detail(org, object, &state).await
}

#[tauri::command]
async fn schema_search(
    org: String,
    query: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::SchemaSearchHitDto>, CommandError> {
    schema_browse::search(&org, &query, limit, &state)
}

#[tauri::command]
async fn schema_field_dependencies(
    org: String,
    object: String,
    field: String,
    refresh: bool,
    state: State<'_, AppState>,
) -> Result<dto::FieldDependenciesDto, CommandError> {
    schema_browse::field_dependencies(org, object, field, refresh, &state).await
}

#[tauri::command]
async fn soql_column_labels(
    query: String,
    columns: Vec<String>,
    child_columns: std::collections::HashMap<String, Vec<String>>,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<dto::ColumnLabelsDto, CommandError> {
    completion::soql_column_labels(query, columns, child_columns, org, &state).await
}

#[tauri::command]
async fn soql_diagnostics(
    query: String,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::SoqlDiagnosticDto>, CommandError> {
    Ok(completion::soql_diagnostics(query, org, &state).await)
}

#[tauri::command]
async fn apex_soql_diagnostics(
    src: String,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::SoqlDiagnosticDto>, CommandError> {
    Ok(completion::apex_soql_diagnostics(src, org, &state).await)
}

#[tauri::command]
async fn apex_diagnostics(
    src: String,
    org: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<dto::ApexDiagnosticDto>, CommandError> {
    Ok(completion::apex_diagnostics(src, org, &state))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _guard = setup::init_tracing();
    #[cfg(target_os = "macos")]
    setup::inherit_login_path();
    #[cfg(target_os = "macos")]
    setup::use_file_keystore();
    telemetry::seed_dev_default(
        &features::apex_complete::default_index_root(),
        cfg!(debug_assertions),
    );
    let state = AppState {
        invoker: SfInvoker::new(Arc::new(ProcessRunner)),
        selected_org: std::sync::Mutex::new(None),
        index: index_coordinator::IndexCoordinator::new(),
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
            org_api_version,
            get_debug_config,
            set_debug_config,
            get_telemetry_config,
            telemetry_dev_seeded,
            set_telemetry_config,
            quick_self_trace,
            load_logging_config,
            save_logging_config,
            apex_complete,
            apex_signature_help,
            soql_complete,
            warm_apex,
            refresh_schema_cache,
            ensure_ready,
            reindex_org,
            index_status,
            schema_list_objects,
            schema_object_detail,
            schema_search,
            schema_field_dependencies,
            soql_column_labels,
            soql_diagnostics,
            apex_soql_diagnostics,
            apex_diagnostics,
            query_plan,
            format_soql,
            soql_subquery_spans,
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
