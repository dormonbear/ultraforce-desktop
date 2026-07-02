use std::sync::Arc;
use std::time::Instant;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::{AppHandle, Emitter, State};
use tracing_subscriber::EnvFilter;

mod dto;
mod error;
use dto::{map_units, UnitDto};
use error::CommandError;

/// Shared application state: one `SfInvoker` over the real `sf` CLI process runner.
pub struct AppState {
    invoker: SfInvoker,
    selected_org: std::sync::Mutex<Option<String>>,
    apex: features::apex_complete::ApexCompleter,
    /// Cached sObject-name list per org, for FROM completion. Populated by
    /// `warm_schema`/`refresh_schema_cache` so keystroke completion never blocks
    /// on a live (multi-second) `sf sobject list`.
    sobjects: std::sync::Mutex<std::collections::HashMap<String, Arc<Vec<String>>>>,
    /// In-flight SOQL runs, keyed by the frontend's query id, so `cancel_soql`
    /// can signal the paginating loop to stop.
    query_cancels:
        std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    /// Cached REST credentials per org (key: org or "" for default). Avoids a
    /// ~1-2s `sf org display` on every query — refreshed on a 401.
    auth_cache: std::sync::Mutex<std::collections::HashMap<String, sf_core::AuthInfo>>,
    /// Last parsed log (keyed by a hash of its raw body), shared by the viewer
    /// and the step-debugger so the same body is parsed exactly once.
    log_cache: std::sync::Mutex<Option<LogCacheEntry>>,
}

/// Single-entry cache for the most recently used log body: the base
/// `ParsedLog` (step-debugger) plus the `DebugLogView` derived from it
/// lazily on the first viewer call.
struct LogCacheEntry {
    key: u64,
    parsed: Arc<log_parser::parse::ParsedLog>,
    view: Option<Arc<features::debug_log::DebugLogView>>,
}

fn body_key(body: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    body.hash(&mut hasher);
    hasher.finish()
}

/// REST credentials for `org`, cached so only the first query per org pays the
/// `sf org display` cost. Subsequent queries (and cancellation) are instant.
async fn cached_auth(
    state: &AppState,
    org: Option<&str>,
) -> Result<sf_core::AuthInfo, sf_core::SfError> {
    let key = org.unwrap_or("").to_string();
    if let Some(a) = state.auth_cache.lock().unwrap().get(&key) {
        return Ok(a.clone());
    }
    let auth = sf_core::OrgRegistry::auth_info(&state.invoker, org).await?;
    state.auth_cache.lock().unwrap().insert(key, auth.clone());
    Ok(auth)
}

/// A stale/expired access token: re-fetch and retry once.
fn session_expired(e: &sf_core::SfError) -> bool {
    matches!(
        e,
        sf_core::SfError::Command { status, name, .. }
            if *status == 401 || name.eq_ignore_ascii_case("INVALID_SESSION_ID")
    )
}

/// Resolves once `flag` is set — used to make even the first query's (otherwise
/// blocking) `sf org display` cancellable.
async fn poll_cancel(flag: &std::sync::atomic::AtomicBool) {
    while !flag.load(std::sync::atomic::Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
}

/// An empty, "not done" result — what a cancelled run yields before any rows.
fn cancelled_result() -> features::soql::QueryResult {
    features::soql::QueryResult {
        total_size: 0,
        done: false,
        records: vec![],
    }
}

/// Run a REST SOQL query with the cached token, transparently refreshing the
/// token once if it has expired.
async fn rest_query(
    state: &AppState,
    org: Option<&str>,
    soql: &str,
    opts: features::soql::QueryOptions,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<features::soql::QueryResult, sf_core::SfError> {
    // Race token fetch against cancel so the first query's `sf org display`
    // doesn't block Cancel; pagination cancel (with partial rows) is handled
    // inside `run_query_rest`.
    let auth = tokio::select! {
        a = cached_auth(state, org) => a?,
        _ = poll_cancel(cancel) => return Ok(cancelled_result()),
    };
    match features::soql::run_query_rest(&auth, soql, opts, on_progress, cancel).await {
        Err(e) if session_expired(&e) => {
            state.auth_cache.lock().unwrap().remove(org.unwrap_or(""));
            let auth = cached_auth(state, org).await?;
            features::soql::run_query_rest(&auth, soql, opts, on_progress, cancel).await
        }
        other => other,
    }
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

#[derive(Clone, serde::Serialize)]
struct IndexProgressDto {
    org: String,
    phase: String,
    done: usize,
    total: usize,
}

#[derive(Clone, serde::Serialize)]
struct SyncResultDto {
    org: String,
    added: usize,
    updated: usize,
    removed: usize,
}

/// Incremental progress for a running SOQL query, emitted as `soql-progress`.
#[derive(Clone, serde::Serialize)]
struct SoqlProgress {
    id: String,
    fetched: u64,
    total: u64,
}

#[tauri::command]
async fn run_soql(
    query: String,
    use_tooling_api: Option<bool>,
    all_rows: Option<bool>,
    query_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SoqlResultDto, CommandError> {
    let start = Instant::now();
    tracing::info!("run_soql start");
    let org = current_org(&state);

    // Register a cancel flag the `cancel_soql` command can flip mid-flight.
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state
        .query_cancels
        .lock()
        .unwrap()
        .insert(query_id.clone(), cancel.clone());

    let progress_id = query_id.clone();
    let on_progress = move |fetched: u64, total: u64| {
        let _ = app.emit(
            "soql-progress",
            SoqlProgress {
                id: progress_id.clone(),
                fetched,
                total,
            },
        );
    };

    let result = rest_query(
        &state,
        org.as_deref(),
        &query,
        features::soql::QueryOptions {
            use_tooling_api: use_tooling_api.unwrap_or(false),
            all_rows: all_rows.unwrap_or(false),
        },
        &on_progress,
        &cancel,
    )
    .await;

    state.query_cancels.lock().unwrap().remove(&query_id);

    let result = result.map_err(|e| {
        tracing::warn!(
            elapsed_ms = start.elapsed().as_millis(),
            outcome = "err",
            "run_soql complete"
        );
        CommandError::from(e)
    })?;
    let table = result.to_table();
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        "run_soql complete"
    );
    Ok(SoqlResultDto {
        columns: table.columns,
        rows: table.rows,
        total_size: result.total_size,
        done: result.done,
        tree: result.records.iter().map(dto::map_record).collect(),
    })
}

/// Signal a running [`run_soql`] (by its `query_id`) to stop paginating; it then
/// resolves with the rows gathered so far.
#[tauri::command]
fn cancel_soql(query_id: String, state: State<'_, AppState>) {
    if let Some(flag) = state.query_cancels.lock().unwrap().get(&query_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Pre-flight row count for a query that has no row cap. `Ok(None)` when a count
/// doesn't apply (already `LIMIT`ed, aggregated, or `GROUP BY`); otherwise the
/// total from `SELECT COUNT() …`, so the UI can warn before fetching a huge set.
#[tauri::command]
async fn count_soql(
    query: String,
    use_tooling_api: Option<bool>,
    query_id: String,
    state: State<'_, AppState>,
) -> Result<Option<u64>, CommandError> {
    let Some(count_q) = soql_lang::count_query(&query) else {
        return Ok(None);
    };
    let org = current_org(&state);

    // Share the cancel registry so `cancel_soql` can abort the pre-flight count
    // (a COUNT() on a huge object is itself slow).
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state
        .query_cancels
        .lock()
        .unwrap()
        .insert(query_id.clone(), cancel.clone());

    let noop = |_: u64, _: u64| {};
    let result = rest_query(
        &state,
        org.as_deref(),
        &count_q,
        features::soql::QueryOptions {
            use_tooling_api: use_tooling_api.unwrap_or(false),
            all_rows: false,
        },
        &noop,
        &cancel,
    )
    .await;

    state.query_cancels.lock().unwrap().remove(&query_id);

    let result = result.map_err(CommandError::from)?;
    // Cancelled mid-count → no usable total; tell the UI to skip the warning.
    if !result.done {
        return Ok(None);
    }
    Ok(Some(result.total_size))
}

#[derive(serde::Deserialize)]
struct ApexBodyRow {
    #[serde(rename = "Body")]
    body: Option<String>,
}
#[derive(serde::Deserialize)]
struct ApexBodyResult {
    records: Vec<ApexBodyRow>,
}

/// Source code (read-only) for an Apex class or trigger, for "jump to source".
#[derive(serde::Serialize)]
struct ApexSourceDto {
    name: String,
    kind: String,
    body: String,
}

/// Fetch an Apex class or trigger's source from the org via the Tooling API, so
/// a log finding can show the offending code. Tries ApexClass, then ApexTrigger.
#[tauri::command]
async fn fetch_apex_source(
    name: String,
    state: State<'_, AppState>,
) -> Result<ApexSourceDto, CommandError> {
    let org = current_org(&state);
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
async fn run_apex(src: String, state: State<'_, AppState>) -> Result<ApexOutcomeDto, CommandError> {
    let start = Instant::now();
    tracing::info!("run_apex start");
    let org = current_org(&state);
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

/// One debug-log list entry handed to the frontend.
#[derive(serde::Serialize)]
struct LogRefDto {
    id: String,
    operation: String,
    status: String,
    start_time: String,
    application: String,
    user: String,
    duration_ms: i64,
    log_length: i64,
}

#[tauri::command]
async fn list_logs(state: State<'_, AppState>) -> Result<Vec<LogRefDto>, CommandError> {
    let org = current_org(&state);
    let logs = features::debug_log::list_logs(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(logs
        .into_iter()
        .map(|l| LogRefDto {
            id: l.id,
            operation: l.operation,
            status: l.status,
            start_time: l.start_time,
            application: l.application,
            user: l.log_user.name,
            duration_ms: l.duration_ms,
            log_length: l.log_length,
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

/// Parsed view WITHOUT the raw body: the caller already holds the body it passed
/// to `parse_log`, so echoing 16MB+ back over IPC (and re-deserializing it) is
/// pure waste. The frontend re-attaches `raw` from the body it owns.
#[derive(serde::Serialize)]
struct ParsedLogDto {
    api_version: Option<String>,
    units: Vec<UnitDto>,
}

/// The full `DebugLogView` for a body, derived from (and cached alongside) the
/// shared `ParsedLog` so `parse_log`, `source_at_line`, and `get_log` over the
/// same log neither re-parse 200k+ lines nor rebuild the view per call.
fn cached_log_view(state: &AppState, body: &str) -> Arc<features::debug_log::DebugLogView> {
    let key = body_key(body);
    let mut cache = state.log_cache.lock().unwrap();
    if let Some(entry) = cache.as_mut() {
        if entry.key == key {
            if let Some(view) = &entry.view {
                return view.clone();
            }
            let view = Arc::new(features::debug_log::DebugLogView::from_parsed(
                &entry.parsed,
                body,
            ));
            entry.view = Some(view.clone());
            return view;
        }
    }
    let parsed = Arc::new(log_parser::parse::ParsedLog::parse(body));
    let view = Arc::new(features::debug_log::DebugLogView::from_parsed(&parsed, body));
    *cache = Some(LogCacheEntry {
        key,
        parsed,
        view: Some(view.clone()),
    });
    view
}

/// The parsed view (execution tree + limits) without the raw body. Per-line source
/// mapping is excluded — loaded lazily via `log_sources` so opening a large log
/// isn't blocked by serializing a line-length array.
fn parsed_dto(view: &features::debug_log::DebugLogView) -> ParsedLogDto {
    ParsedLogDto {
        api_version: view.header.as_ref().map(|h| h.api_version.clone()),
        units: map_units(view),
    }
}

#[tauri::command]
async fn get_log(id: String, state: State<'_, AppState>) -> Result<LogViewDto, CommandError> {
    let org = current_org(&state);
    let body = features::debug_log::get_log_body(&state.invoker, &id, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    let view = cached_log_view(&state, &body);
    let parsed = parsed_dto(&view);
    // The org fetch is the only path where the frontend doesn't already have the
    // body, so this is the one place that returns `raw`.
    Ok(LogViewDto {
        raw: body,
        api_version: parsed.api_version,
        units: parsed.units,
    })
}

/// Parse a raw debug-log body supplied by the caller (a reopened cached log or an
/// opened local `.log` file). Returns no `raw` — the caller re-attaches the body
/// it already holds.
#[tauri::command]
fn parse_log(body: String, state: State<'_, AppState>) -> ParsedLogDto {
    parsed_dto(&cached_log_view(&state, &body))
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

/// Parse a raw log body, reusing the cached parse when the body is unchanged so
/// the step-debugger doesn't re-parse a large log on every step. Shares the
/// viewer's cache entry, so a log opened then debugged is parsed once total.
fn parsed_log(state: &AppState, raw: &str) -> Arc<log_parser::parse::ParsedLog> {
    let key = body_key(raw);
    let mut cache = state.log_cache.lock().unwrap();
    if let Some(entry) = cache.as_ref() {
        if entry.key == key {
            return entry.parsed.clone();
        }
    }
    let parsed = Arc::new(log_parser::parse::ParsedLog::parse(raw));
    *cache = Some(LogCacheEntry {
        key,
        parsed: parsed.clone(),
        view: None,
    });
    parsed
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

/// Classified health of the `sf` CLI, so the UI can give the right guidance:
/// install it, upgrade it, or fix a PATH problem — instead of a bare error.
#[derive(serde::Serialize)]
struct SfStatusDto {
    /// "ok" | "outdated" | "not_found" | "path_issue"
    state: &'static str,
    /// Raw `sf --version` output when the CLI was found.
    version: Option<String>,
    /// Minimum version Ultraforce supports, e.g. "2.0.0".
    min_version: String,
    /// Where a login-shell probe found `sf` when it isn't on the app's PATH.
    found_at: Option<String>,
}

/// Pure state decision. `meets_min` is `Some(true/false)` when `sf --version`
/// ran, `None` when the CLI wasn't on PATH; `probe_found` is whether a login
/// shell located `sf` anyway.
fn cli_state(meets_min: Option<bool>, probe_found: bool) -> &'static str {
    match meets_min {
        Some(true) => "ok",
        Some(false) => "outdated",
        None if probe_found => "path_issue",
        None => "not_found",
    }
}

/// Look for `sf` via the user's login shell (handles zsh/bash/fish rc files and
/// version managers the app's own PATH may miss). Returns its path if found.
/// Bounded by a short timeout so a slow shell rc can't hang the health check.
#[cfg(unix)]
async fn probe_sf_via_login_shell() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let fut = tokio::process::Command::new(shell)
        .args(["-ilc", "command -v sf"])
        .output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(5), fut)
        .await
        .ok()?
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then_some(path)
}

#[cfg(not(unix))]
async fn probe_sf_via_login_shell() -> Option<String> {
    None
}

#[tauri::command]
async fn sf_status(state: State<'_, AppState>) -> Result<SfStatusDto, CommandError> {
    let min_version = sf_core::SfVersion::min_version_str();
    match sf_core::SfVersion::detect(&state.invoker).await {
        Ok(v) => Ok(SfStatusDto {
            state: cli_state(Some(v.meets_minimum()), false),
            version: Some(v.raw),
            min_version,
            found_at: None,
        }),
        // Not on PATH (or unparseable version) → see if it's installed elsewhere.
        Err(_) => {
            let found_at = probe_sf_via_login_shell().await;
            Ok(SfStatusDto {
                state: cli_state(None, found_at.is_some()),
                version: None,
                min_version,
                found_at,
            })
        }
    }
}

/// Build the `sf org login web` argv from the optional knobs. Pure, so the
/// arg mapping is unit-testable without spawning a process.
fn build_login_args(
    instance_url: Option<&str>,
    alias: Option<&str>,
    set_default: bool,
) -> Vec<String> {
    let mut a = vec!["org".to_string(), "login".to_string(), "web".to_string()];
    if let Some(u) = instance_url.filter(|s| !s.trim().is_empty()) {
        a.push("--instance-url".to_string());
        a.push(u.trim().to_string());
    }
    if let Some(al) = alias.filter(|s| !s.trim().is_empty()) {
        a.push("--alias".to_string());
        a.push(al.trim().to_string());
    }
    if set_default {
        a.push("--set-default".to_string());
    }
    a
}

/// Run `sf org login web` (opens the system browser for OAuth). Blocks until the
/// flow finishes, so it gets a generous timeout. `instance_url` selects a
/// sandbox / custom domain; `alias` / `set_default` are optional knobs.
#[tauri::command]
async fn login_org(
    instance_url: Option<String>,
    alias: Option<String>,
    set_default: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let mut args = build_login_args(
        instance_url.as_deref(),
        alias.as_deref(),
        set_default.unwrap_or(true),
    );
    args.push("--json".to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = state
        .invoker
        .run_raw_with_timeout(&arg_refs, std::time::Duration::from_secs(300))
        .await
        .map_err(CommandError::from)?;
    if out.status != 0 {
        let msg = out.stderr.trim();
        return Err(CommandError::new(
            "command",
            if msg.is_empty() {
                format!("`sf org login web` failed (status {})", out.status)
            } else {
                msg.to_string()
            },
        ));
    }
    Ok(())
}

/// Set (or clear) the target org used by all subsequent `sf` calls.
#[tauri::command]
fn set_target_org(username: Option<String>, state: State<'_, AppState>) -> Result<(), CommandError> {
    *state.selected_org.lock().unwrap() = username;
    Ok(())
}

#[tauri::command]
async fn get_debug_config(state: State<'_, AppState>) -> Result<dto::DebugConfigDto, CommandError> {
    let org = current_org(&state);
    let cfg = features::debug_config::get_debug_config(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

#[tauri::command]
async fn set_debug_config(
    levels: dto::CategoryLevelsDto,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    let org = current_org(&state);
    let core = features::debug_config::CategoryLevels::from(&levels);
    let cfg =
        features::debug_config::set_debug_config(&state.invoker, &core, org.as_deref(), 24 * 60)
            .await
            .map_err(CommandError::from)?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

/// One-click: trace the running user for `minutes` (default 30) at a full-debug
/// level. Reuses set_debug_config (upserts the ULTRAFORCE_DEBUG level + TraceFlag).
#[tauri::command]
async fn quick_self_trace(
    minutes: Option<u32>,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, CommandError> {
    let org = current_org(&state);
    let mins = minutes.unwrap_or(30) as u64;
    let levels =
        features::debug_config::preset_levels(features::debug_config::Preset::FullDebugging);
    let cfg =
        features::debug_config::set_debug_config(&state.invoker, &levels, org.as_deref(), mins)
            .await
            .map_err(CommandError::from)?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

/// Load all trace flags, debug levels, and traceable entities (Configure Logging dialog).
#[tauri::command]
async fn load_logging_config(state: State<'_, AppState>) -> Result<dto::LoggingConfigDto, CommandError> {
    let org = current_org(&state);
    let cfg = features::debug_traces::load_logging_config(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::LoggingConfigDto::from(&cfg))
}

/// Commit a batch of trace-flag / debug-level changes; returns per-record results.
#[tauri::command]
async fn save_logging_config(
    diff: dto::LoggingDiffDto,
    state: State<'_, AppState>,
) -> Result<dto::SaveOutcomeDto, CommandError> {
    let org = current_org(&state);
    let domain = features::debug_traces::LoggingDiff::from(&diff);
    let out = features::debug_traces::save_logging_config(&state.invoker, &domain, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::SaveOutcomeDto::from(&out))
}

#[tauri::command]
async fn apex_complete(
    src: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CandidateDto>, CommandError> {
    let start = Instant::now();
    tracing::info!("apex_complete start");
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    // sObject names (cached via warm_schema) so inline-SOQL FROM completion works.
    let objects = state
        .sobjects
        .lock()
        .unwrap()
        .get(&org)
        .cloned()
        .unwrap_or_default();
    let cands = state
        .apex
        .complete(&state.invoker, &org, &src, offset, &objects)
        .await
        .map_err(|e| {
            tracing::warn!(
                elapsed_ms = start.elapsed().as_millis(),
                outcome = "err",
                "apex_complete complete"
            );
            CommandError::from(e)
        })?;
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        "apex_complete complete"
    );
    Ok(cands.iter().map(dto::CandidateDto::from).collect())
}

/// Pre-warm the Apex OST (one-time stdlib fetch) for an org so the first
/// interactive completion is instant. Fire-and-forget from the frontend.
#[tauri::command]
async fn warm_apex(org: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let start = Instant::now();
    tracing::info!(org = %org, "warm_apex start");
    let r = state
        .apex
        .warm(&state.invoker, &org)
        .await
        .map_err(CommandError::from);
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = if r.is_ok() { "ok" } else { "err" },
        "warm_apex complete"
    );
    r
}

#[tauri::command]
async fn soql_complete(
    query: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CompletionDto>, CommandError> {
    let start = Instant::now();
    tracing::info!("soql_complete start");
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    let objects = state
        .sobjects
        .lock()
        .unwrap()
        .get(&org)
        .cloned()
        .unwrap_or_default();
    // Intentional: completion errors are swallowed inside `complete_fields`
    // (editor hot path) — an empty candidate list beats surfacing an error
    // on every keystroke.
    let cands = features::soql::complete_fields(
        &state.invoker,
        sf_schema::SchemaStore::default_root(),
        &org,
        &query,
        offset,
        &objects,
    )
    .await;
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        "soql_complete complete"
    );
    Ok(cands.iter().map(dto::CompletionDto::from).collect())
}

/// Populate the in-memory sObject-name cache for `org` (one `sf sobject list`).
/// Fire-and-forget from the frontend on org select, so FROM completion is ready
/// without ever blocking a keystroke.
#[tauri::command]
async fn warm_schema(org: String, state: State<'_, AppState>) -> Result<usize, CommandError> {
    let start = Instant::now();
    tracing::info!(org = %org, "warm_schema start");
    let names = features::soql::list_sobject_names(&state.invoker, &org).await;
    let count = names.len();
    state.sobjects.lock().unwrap().insert(org, Arc::new(names));
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        count,
        "warm_schema complete"
    );
    Ok(count)
}

#[tauri::command]
async fn refresh_schema_cache(org: String, state: State<'_, AppState>) -> Result<usize, CommandError> {
    let start = Instant::now();
    tracing::info!(org = %org, "refresh_schema_cache start");
    let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
    if let Err(e) = store.clear() {
        tracing::warn!(
            elapsed_ms = start.elapsed().as_millis(),
            outcome = "err",
            "refresh_schema_cache complete"
        );
        return Err(CommandError::from(e));
    }
    // Re-list sObjects so the next FROM completion reflects current metadata.
    let names = features::soql::list_sobject_names(&state.invoker, &org).await;
    let count = names.len();
    state.sobjects.lock().unwrap().insert(org, Arc::new(names));
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        count,
        "refresh_schema_cache complete"
    );
    Ok(count)
}

#[tauri::command]
async fn index_org(
    org: String,
    namespaces: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let root = features::apex_complete::default_index_root();
    let api = features::api_version::api_version_for(&state.invoker, &org).await;
    let policy = features::index::NamespacePolicy::parse(namespaces.as_deref().unwrap_or("all"));

    // Already indexed → install the snapshot instantly (completion ready), then
    // delta-sync in the same command and emit a result if anything changed.
    if let Some((ost, _)) = apex_lang::load_snapshot(&root, &org, &api) {
        state.apex.install_index(&org, ost);
        if let Ok((outcome, patched)) =
            features::index::sync_org(&state.invoker, root, &org, &policy).await
        {
            state.apex.install_index(&org, patched);
            if outcome.changed() {
                let _ = app.emit(
                    "sync-result",
                    SyncResultDto {
                        org: org.clone(),
                        added: outcome.added,
                        updated: outcome.updated,
                        removed: outcome.removed,
                    },
                );
            }
        }
        let names = features::soql::list_sobject_names(&state.invoker, &org).await;
        state
            .sobjects
            .lock()
            .unwrap()
            .insert(org.clone(), Arc::new(names));
        return Ok(());
    }

    // Not indexed → full first index (Phase-1 path).
    let mut on_progress = |p: features::index::IndexProgress| {
        let _ = app.emit(
            "index-progress",
            IndexProgressDto {
                org: org.clone(),
                phase: p.phase.to_string(),
                done: p.done,
                total: p.total,
            },
        );
    };
    let ost = features::index::index_org(&state.invoker, root, &org, &policy, &mut on_progress)
        .await
        .map_err(CommandError::from)?;
    state.apex.install_index(&org, ost);
    let names = features::soql::list_sobject_names(&state.invoker, &org).await;
    state
        .sobjects
        .lock()
        .unwrap()
        .insert(org.clone(), Arc::new(names));
    Ok(())
}

#[tauri::command]
async fn reindex_org(
    org: String,
    namespaces: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
    let _ = store.clear();
    index_org(org, namespaces, app, state).await
}

#[tauri::command]
async fn soql_diagnostics(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::soql::SoqlDiagnostic>, CommandError> {
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    // Intentional: diagnostic errors are swallowed inside `diagnose` (editor
    // hot path) — no diagnostics is an acceptable degraded result.
    Ok(features::soql::diagnose(
        &state.invoker,
        sf_schema::SchemaStore::default_root(),
        &org,
        &query,
    )
    .await)
}

#[tauri::command]
async fn apex_soql_diagnostics(
    src: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::soql::SoqlDiagnostic>, CommandError> {
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    Ok(features::soql::diagnose_apex_soql(
        &state.invoker,
        sf_schema::SchemaStore::default_root(),
        &org,
        &src,
    )
    .await)
}

#[tauri::command]
async fn apex_diagnostics(
    src: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::apex_complete::ApexDiagnostic>, CommandError> {
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    Ok(state.apex.diagnostics(&org, &src))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _guard = init_tracing();
    #[cfg(target_os = "macos")]
    inherit_login_path();
    #[cfg(target_os = "macos")]
    use_file_keystore();
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

/// ponytail: GUI apps launched from Finder/Dock inherit launchd's minimal PATH,
/// not the shell PATH — so `sf` installed via mise/nvm/brew is invisible and
/// every `sf` call fails with `NotFound`. Pull the login shell's PATH once at
/// startup and adopt it. macOS-only; other platforms inherit a usable PATH.
#[cfg(target_os = "macos")]
fn inherit_login_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(out) = std::process::Command::new(&shell)
        .args(["-ilc", "echo $PATH"])
        .output()
    {
        let path = String::from_utf8_lossy(&out.stdout);
        let path = path.trim();
        if !path.is_empty() {
            std::env::set_var("PATH", path);
        }
    }
}

/// The `~/.sfdx/key.json` body `sf` reads when `SF_USE_GENERIC_UNIX_KEYCHAIN` is
/// set. Pure, so the exact shape `@salesforce/core` expects is unit-testable.
/// `key` is a hex string `sf` generated, so no JSON escaping is needed.
fn key_json(key: &str) -> String {
    format!("{{\n  \"account\": \"local\",\n  \"key\": \"{key}\",\n  \"service\": \"sfdx\"\n}}")
}

/// ponytail: a GUI-launched subprocess can't always reach the macOS login
/// keychain (locked, fresh/corporate account, missing keychain) — `sf` then
/// fails OAuth with "A keychain cannot be found to store". Force `sf` to keep
/// its crypto key in a file (`~/.sfdx/key.json`) instead of the OS keychain. To
/// stay compatible with orgs already authed via the OS keychain, seed that file
/// once from the existing keychain key if one is present.
#[cfg(target_os = "macos")]
fn use_file_keystore() {
    use std::os::unix::fs::PermissionsExt;
    std::env::set_var("SF_USE_GENERIC_UNIX_KEYCHAIN", "true");
    let Some(home) = dirs::home_dir() else { return };
    // `sf`'s file keystore lives at `Global.DIR/key.json` = `~/.sfdx/key.json`.
    let key_file = home.join(".sfdx").join("key.json");
    if key_file.exists() {
        return;
    }
    // Migrate the existing key from the OS keychain if there is one; otherwise
    // leave it and `sf` will create `key.json` itself on the first login.
    let Ok(out) = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-a", "local", "-s", "sfdx", "-w"])
        .output()
    else {
        return;
    };
    let key = String::from_utf8_lossy(&out.stdout);
    let key = key.trim();
    if !out.status.success() || key.is_empty() {
        return;
    }
    if std::fs::create_dir_all(key_file.parent().unwrap()).is_ok()
        && std::fs::write(&key_file, key_json(key)).is_ok()
    {
        let _ = std::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600));
    }
}

fn init_tracing() -> tracing_appender::non_blocking::WorkerGuard {
    let log_dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ultraforce")
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let file_appender = tracing_appender::rolling::daily(log_dir, "ultraforce.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let filter = std::env::var("ULTRAFORCE_LOG")
        .ok()
        .and_then(|value| EnvFilter::try_new(value).ok())
        .unwrap_or_else(|| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .init();
    guard
}

#[cfg(test)]
mod tests {
    use super::{build_login_args, cli_state, key_json};

    #[test]
    fn cli_state_classifies_each_case() {
        assert_eq!(cli_state(Some(true), false), "ok");
        assert_eq!(cli_state(Some(false), false), "outdated");
        assert_eq!(cli_state(None, true), "path_issue");
        assert_eq!(cli_state(None, false), "not_found");
        // A found version always wins, even if a probe would also find it.
        assert_eq!(cli_state(Some(true), true), "ok");
    }

    #[test]
    fn key_json_matches_sf_generic_keystore_shape() {
        let v: serde_json::Value = serde_json::from_str(&key_json("deadbeef")).unwrap();
        assert_eq!(v["account"], "local");
        assert_eq!(v["service"], "sfdx");
        assert_eq!(v["key"], "deadbeef");
    }

    #[test]
    fn login_args_default_is_web_login_with_set_default() {
        assert_eq!(
            build_login_args(None, None, true),
            vec!["org", "login", "web", "--set-default"]
        );
    }

    #[test]
    fn login_args_include_instance_url_and_alias_when_present() {
        assert_eq!(
            build_login_args(Some("https://test.salesforce.com"), Some("sandbox"), false),
            vec![
                "org",
                "login",
                "web",
                "--instance-url",
                "https://test.salesforce.com",
                "--alias",
                "sandbox"
            ]
        );
    }

    #[test]
    fn login_args_skip_blank_knobs() {
        assert_eq!(
            build_login_args(Some("  "), Some(""), false),
            vec!["org", "login", "web"]
        );
    }
}
