//! Cheap per-org cache warmers that sit outside the index lifecycle: the Apex
//! OST prewarm and the manual schema-cache refresh. The org index lifecycle
//! (first-index / delta-sync / reindex / status) now lives in
//! [`crate::index_coordinator`].

use std::sync::Arc;
use std::time::Instant;

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
