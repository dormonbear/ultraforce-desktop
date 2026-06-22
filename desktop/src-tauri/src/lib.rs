use std::sync::Arc;
use std::time::Instant;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::{AppHandle, Emitter, State};
use tracing_subscriber::EnvFilter;

mod dto;
use dto::{map_units, UnitDto};

/// Shared application state: one `SfInvoker` over the real `sf` CLI process runner.
pub struct AppState {
    invoker: SfInvoker,
    selected_org: std::sync::Mutex<Option<String>>,
    apex: features::apex_complete::ApexCompleter,
    /// Cached sObject-name list per org, for FROM completion. Populated by
    /// `warm_schema`/`refresh_schema_cache` so keystroke completion never blocks
    /// on a live (multi-second) `sf sobject list`.
    sobjects: std::sync::Mutex<std::collections::HashMap<String, Arc<Vec<String>>>>,
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

#[tauri::command]
async fn run_soql(
    query: String,
    use_tooling_api: Option<bool>,
    all_rows: Option<bool>,
    state: State<'_, AppState>,
) -> Result<SoqlResultDto, String> {
    let start = Instant::now();
    tracing::info!("run_soql start");
    let org = current_org(&state);
    let result = features::soql::run_query(
        &state.invoker,
        &query,
        org.as_deref(),
        features::soql::QueryOptions {
            use_tooling_api: use_tooling_api.unwrap_or(false),
            all_rows: all_rows.unwrap_or(false),
        },
    )
    .await
    .map_err(|e| {
        tracing::warn!(
            elapsed_ms = start.elapsed().as_millis(),
            outcome = "err",
            "run_soql complete"
        );
        format!("{e:?}")
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

/// Pretty-print a SOQL query (one top-level clause per line). Pure, no IO.
#[tauri::command]
fn format_soql(query: String) -> String {
    soql_lang::format_soql(&query)
}

/// Fetch the SOQL query plan (EXPLAIN): cost / cardinality / leading operation.
#[tauri::command]
async fn query_plan(
    query: String,
    state: State<'_, AppState>,
) -> Result<features::query_plan::QueryPlan, String> {
    let org = current_org(&state);
    features::query_plan::query_plan(&state.invoker, &query, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))
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
            format!("{e:?}")
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

/// Parse a raw debug-log body into the view DTO (execution tree + limits + raw).
fn build_log_view(body: String) -> LogViewDto {
    let view = features::debug_log::DebugLogView::from_log(&body);
    LogViewDto {
        api_version: view.header.as_ref().map(|h| h.api_version.clone()),
        units: map_units(&view),
        raw: body,
    }
}

#[tauri::command]
async fn get_log(id: String, state: State<'_, AppState>) -> Result<LogViewDto, String> {
    let org = current_org(&state);
    let body = features::debug_log::get_log_body(&state.invoker, &id, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(build_log_view(body))
}

/// Parse a raw debug-log body supplied by the caller (e.g. an opened local
/// `.log` file) — same view as `get_log` without the org fetch.
#[tauri::command]
fn parse_log(body: String) -> LogViewDto {
    build_log_view(body)
}

/// List the available Salesforce orgs via `sf org list`.
#[tauri::command]
async fn list_orgs(state: State<'_, AppState>) -> Result<Vec<dto::OrgDto>, String> {
    // Display (not Debug) so the actionable `SfError` message reaches the user.
    let orgs = sf_core::OrgRegistry::list(&state.invoker)
        .await
        .map_err(|e| e.to_string())?;
    Ok(orgs.iter().map(dto::OrgDto::from).collect())
}

/// Whether the `sf` CLI is reachable, plus its version. Lets the setup page tell
/// "CLI not installed" apart from "installed but no org authed".
#[derive(serde::Serialize)]
struct SfStatusDto {
    installed: bool,
    version: Option<String>,
}

#[tauri::command]
async fn sf_status(state: State<'_, AppState>) -> Result<SfStatusDto, String> {
    match state.invoker.run_raw(&["--version"]).await {
        Ok(out) => {
            let v = out.stdout.trim().to_string();
            Ok(SfStatusDto {
                installed: true,
                version: (!v.is_empty()).then_some(v),
            })
        }
        Err(sf_core::SfError::NotFound) => Ok(SfStatusDto {
            installed: false,
            version: None,
        }),
        Err(e) => Err(e.to_string()),
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
) -> Result<(), String> {
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
        .map_err(|e| e.to_string())?;
    if out.status != 0 {
        let msg = out.stderr.trim();
        return Err(if msg.is_empty() {
            format!("`sf org login web` failed (status {})", out.status)
        } else {
            msg.to_string()
        });
    }
    Ok(())
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

/// Load all trace flags, debug levels, and traceable entities (Configure Logging dialog).
#[tauri::command]
async fn load_logging_config(
    state: State<'_, AppState>,
) -> Result<dto::LoggingConfigDto, String> {
    let org = current_org(&state);
    let cfg = features::debug_traces::load_logging_config(&state.invoker, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(dto::LoggingConfigDto::from(&cfg))
}

/// Commit a batch of trace-flag / debug-level changes; returns per-record results.
#[tauri::command]
async fn save_logging_config(
    diff: dto::LoggingDiffDto,
    state: State<'_, AppState>,
) -> Result<dto::SaveOutcomeDto, String> {
    let org = current_org(&state);
    let domain = features::debug_traces::LoggingDiff::from(&diff);
    let out = features::debug_traces::save_logging_config(&state.invoker, &domain, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(dto::SaveOutcomeDto::from(&out))
}

#[tauri::command]
async fn apex_complete(
    src: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<dto::CandidateDto>, String> {
    let start = Instant::now();
    tracing::info!("apex_complete start");
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    let cands = state
        .apex
        .complete(&state.invoker, &org, &src, offset)
        .await
        .map_err(|e| {
            tracing::warn!(
                elapsed_ms = start.elapsed().as_millis(),
                outcome = "err",
                "apex_complete complete"
            );
            format!("{e:?}")
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
async fn warm_apex(org: String, state: State<'_, AppState>) -> Result<(), String> {
    let start = Instant::now();
    tracing::info!(org = %org, "warm_apex start");
    let r = state
        .apex
        .warm(&state.invoker, &org)
        .await
        .map_err(|e| format!("{e:?}"));
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
) -> Result<Vec<dto::CompletionDto>, String> {
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
async fn warm_schema(org: String, state: State<'_, AppState>) -> Result<usize, String> {
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
async fn refresh_schema_cache(org: String, state: State<'_, AppState>) -> Result<usize, String> {
    let start = Instant::now();
    tracing::info!(org = %org, "refresh_schema_cache start");
    let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
    if let Err(e) = store.clear() {
        tracing::warn!(
            elapsed_ms = start.elapsed().as_millis(),
            outcome = "err",
            "refresh_schema_cache complete"
        );
        return Err(format!("{e:?}"));
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
) -> Result<(), String> {
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
        .map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
    let _ = store.clear();
    index_org(org, namespaces, app, state).await
}

#[tauri::command]
async fn soql_diagnostics(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<features::soql::SoqlDiagnostic>, String> {
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
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
) -> Result<Vec<features::soql::SoqlDiagnostic>, String> {
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
) -> Result<Vec<features::apex_complete::ApexDiagnostic>, String> {
    let org = current_org(&state).unwrap_or_else(|| "default".to_string());
    Ok(state.apex.diagnostics(&org, &src))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _guard = init_tracing();
    #[cfg(target_os = "macos")]
    inherit_login_path();
    let state = AppState {
        invoker: SfInvoker::new(Arc::new(ProcessRunner)),
        selected_org: std::sync::Mutex::new(None),
        apex: features::apex_complete::ApexCompleter::with_default_root(),
        sobjects: std::sync::Mutex::new(std::collections::HashMap::new()),
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
            set_debug_config,
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
            parse_log,
            sf_status,
            login_org
        ])
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
    use super::build_login_args;

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
