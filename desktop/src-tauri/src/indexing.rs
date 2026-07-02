//! Org index orchestration: first-index / snapshot + delta-sync (`index_org`),
//! full reindex, and the OST / sObject-name cache warmers.

use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use crate::dto::{IndexProgressDto, SyncResultDto};
use crate::error::CommandError;
use crate::state::AppState;

/// Pre-warm the Apex OST (one-time stdlib fetch) for an org so the first
/// interactive completion is instant. Fire-and-forget from the frontend.
pub(crate) async fn warm_apex(org: String, state: &AppState) -> Result<(), CommandError> {
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

/// Populate the in-memory sObject-name cache for `org` (one `sf sobject list`).
/// Fire-and-forget from the frontend on org select, so FROM completion is ready
/// without ever blocking a keystroke.
pub(crate) async fn warm_schema(org: String, state: &AppState) -> Result<usize, CommandError> {
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

pub(crate) async fn refresh_schema_cache(
    org: String,
    state: &AppState,
) -> Result<usize, CommandError> {
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

pub(crate) async fn index_org(
    org: String,
    namespaces: Option<String>,
    app: &AppHandle,
    state: &AppState,
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

pub(crate) async fn reindex_org(
    org: String,
    namespaces: Option<String>,
    app: &AppHandle,
    state: &AppState,
) -> Result<(), CommandError> {
    let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
    let _ = store.clear();
    index_org(org, namespaces, app, state).await
}
