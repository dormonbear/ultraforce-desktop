//! SOQL execution orchestration: the per-query cancel registry, the per-org
//! REST-credential cache, and the transparent expired-session retry around
//! `features::soql::run_query_rest`.

use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use crate::dto::{self, SoqlProgress, SoqlResultDto};
use crate::error::CommandError;
use crate::state::{current_org, AppState};

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

pub(crate) async fn run_soql(
    query: String,
    use_tooling_api: Option<bool>,
    all_rows: Option<bool>,
    query_id: String,
    app: AppHandle,
    state: &AppState,
) -> Result<SoqlResultDto, CommandError> {
    let start = Instant::now();
    tracing::info!("run_soql start");
    let org = current_org(state);

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
        state,
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
pub(crate) fn cancel_soql(query_id: &str, state: &AppState) {
    if let Some(flag) = state.query_cancels.lock().unwrap().get(query_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Pre-flight row count for a query that has no row cap. `Ok(None)` when a count
/// doesn't apply (already `LIMIT`ed, aggregated, or `GROUP BY`); otherwise the
/// total from `SELECT COUNT() …`, so the UI can warn before fetching a huge set.
pub(crate) async fn count_soql(
    query: String,
    use_tooling_api: Option<bool>,
    query_id: String,
    state: &AppState,
) -> Result<Option<u64>, CommandError> {
    let Some(count_q) = soql_lang::count_query(&query) else {
        return Ok(None);
    };
    let org = current_org(state);

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
        state,
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
