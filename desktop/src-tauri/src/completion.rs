//! Editor language services: Apex/SOQL completion over the cached per-org
//! sObject-name list, plus SOQL and Apex diagnostics.

use std::time::Instant;

use crate::dto;
use crate::error::CommandError;
use crate::state::{current_org, AppState};

pub(crate) async fn apex_complete(
    src: String,
    offset: usize,
    state: &AppState,
) -> Result<Vec<dto::CandidateDto>, CommandError> {
    let start = Instant::now();
    tracing::info!("apex_complete start");
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
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

pub(crate) async fn soql_complete(
    query: String,
    offset: usize,
    state: &AppState,
) -> Result<Vec<dto::CompletionDto>, CommandError> {
    let start = Instant::now();
    tracing::info!("soql_complete start");
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
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

pub(crate) async fn soql_diagnostics(
    query: String,
    state: &AppState,
) -> Vec<features::soql::SoqlDiagnostic> {
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
    // Intentional: diagnostic errors are swallowed inside `diagnose` (editor
    // hot path) — no diagnostics is an acceptable degraded result.
    features::soql::diagnose(
        &state.invoker,
        sf_schema::SchemaStore::default_root(),
        &org,
        &query,
    )
    .await
}

pub(crate) async fn apex_soql_diagnostics(
    src: String,
    state: &AppState,
) -> Vec<features::soql::SoqlDiagnostic> {
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
    features::soql::diagnose_apex_soql(
        &state.invoker,
        sf_schema::SchemaStore::default_root(),
        &org,
        &src,
    )
    .await
}

pub(crate) fn apex_diagnostics(
    src: String,
    state: &AppState,
) -> Vec<features::apex_complete::ApexDiagnostic> {
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
    state.apex.diagnostics(&org, &src)
}
