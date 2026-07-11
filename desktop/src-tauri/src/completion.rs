//! Editor language services: Apex/SOQL completion over the cached per-org
//! sObject-name list, SOQL and Apex diagnostics, plus result-column label
//! lookup for the API-name ↔ label display toggle.

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

pub(crate) async fn apex_signature_help(
    src: String,
    offset: usize,
    state: &AppState,
) -> Result<Option<dto::SignatureHelpDto>, CommandError> {
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
    let help = state
        .apex
        .signature_help(&state.invoker, &org, &src, offset)
        .await
        .map_err(CommandError::from)?;
    Ok(help.as_ref().map(dto::SignatureHelpDto::from))
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

/// Schema labels for a query's result columns (best-effort — unresolvable
/// columns are omitted and the UI falls back to API names).
pub(crate) async fn soql_column_labels(
    query: String,
    columns: Vec<String>,
    child_columns: std::collections::HashMap<String, Vec<String>>,
    state: &AppState,
) -> Result<dto::ColumnLabelsDto, CommandError> {
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
    let labels = features::soql_labels::column_labels(
        &state.invoker,
        sf_schema::SchemaStore::default_root(),
        &org,
        &query,
        &columns,
        &child_columns,
    )
    .await;
    Ok(dto::map_column_labels(labels))
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
