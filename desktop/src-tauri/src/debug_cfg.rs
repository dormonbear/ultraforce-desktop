//! Debug-logging configuration orchestration: the ULTRAFORCE_DEBUG trace flag
//! plus the Configure Logging dialog's trace-flag / debug-level management.

use crate::dto;
use crate::error::CommandError;
use crate::state::{current_org, AppState};

pub(crate) async fn get_debug_config(state: &AppState) -> Result<dto::DebugConfigDto, CommandError> {
    let org = current_org(state);
    let cfg = features::debug_config::get_debug_config(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

pub(crate) async fn set_debug_config(
    levels: dto::CategoryLevelsDto,
    state: &AppState,
) -> Result<dto::DebugConfigDto, CommandError> {
    let org = current_org(state);
    let core = features::debug_config::CategoryLevels::from(&levels);
    let cfg =
        features::debug_config::set_debug_config(&state.invoker, &core, org.as_deref(), 24 * 60)
            .await
            .map_err(CommandError::from)?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

/// One-click: trace the running user for `minutes` (default 30) at a full-debug
/// level. Reuses set_debug_config (upserts the ULTRAFORCE_DEBUG level + TraceFlag).
pub(crate) async fn quick_self_trace(
    minutes: Option<u32>,
    state: &AppState,
) -> Result<dto::DebugConfigDto, CommandError> {
    let org = current_org(state);
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
pub(crate) async fn load_logging_config(
    state: &AppState,
) -> Result<dto::LoggingConfigDto, CommandError> {
    let org = current_org(state);
    let cfg = features::debug_traces::load_logging_config(&state.invoker, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::LoggingConfigDto::from(&cfg))
}

/// Commit a batch of trace-flag / debug-level changes; returns per-record results.
pub(crate) async fn save_logging_config(
    diff: dto::LoggingDiffDto,
    state: &AppState,
) -> Result<dto::SaveOutcomeDto, CommandError> {
    let org = current_org(state);
    let domain = features::debug_traces::LoggingDiff::from(&diff);
    let out = features::debug_traces::save_logging_config(&state.invoker, &domain, org.as_deref())
        .await
        .map_err(CommandError::from)?;
    Ok(dto::SaveOutcomeDto::from(&out))
}
