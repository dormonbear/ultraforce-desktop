//! Debug-config, opt-in telemetry, and Configure-Logging (trace flags / debug
//! levels) DTOs, plus the diff input DTOs the frontend sends back.

use features::debug_config::{CategoryLevels, DebugConfig, LogLevel};
use features::debug_traces::{
    DebugLevelDraft, DebugLevelInfo, DebugLevelMod, EntityOption, LoggingConfig, LoggingDiff,
    RecordResult, SaveOutcome, TraceFlagDraft, TraceFlagInfo, TraceFlagMod,
};

/// Eleven category levels as sf strings, camelCase for the React side.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryLevelsDto {
    pub apex_code: String,
    pub apex_profiling: String,
    pub callout: String,
    pub data_access: String,
    pub database: String,
    pub nba: String,
    pub system: String,
    pub validation: String,
    pub visualforce: String,
    pub wave: String,
    pub workflow: String,
}

impl From<&CategoryLevels> for CategoryLevelsDto {
    fn from(c: &CategoryLevels) -> Self {
        CategoryLevelsDto {
            apex_code: c.apex_code.as_sf().into(),
            apex_profiling: c.apex_profiling.as_sf().into(),
            callout: c.callout.as_sf().into(),
            data_access: c.data_access.as_sf().into(),
            database: c.database.as_sf().into(),
            nba: c.nba.as_sf().into(),
            system: c.system.as_sf().into(),
            validation: c.validation.as_sf().into(),
            visualforce: c.visualforce.as_sf().into(),
            wave: c.wave.as_sf().into(),
            workflow: c.workflow.as_sf().into(),
        }
    }
}

impl From<&CategoryLevelsDto> for CategoryLevels {
    fn from(d: &CategoryLevelsDto) -> Self {
        CategoryLevels {
            apex_code: LogLevel::from_sf(&d.apex_code),
            apex_profiling: LogLevel::from_sf(&d.apex_profiling),
            callout: LogLevel::from_sf(&d.callout),
            data_access: LogLevel::from_sf(&d.data_access),
            database: LogLevel::from_sf(&d.database),
            nba: LogLevel::from_sf(&d.nba),
            system: LogLevel::from_sf(&d.system),
            validation: LogLevel::from_sf(&d.validation),
            visualforce: LogLevel::from_sf(&d.visualforce),
            wave: LogLevel::from_sf(&d.wave),
            workflow: LogLevel::from_sf(&d.workflow),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugConfigDto {
    pub trace_flag_id: Option<String>,
    pub levels: CategoryLevelsDto,
    pub expiration_date: Option<String>,
}

impl From<&DebugConfig> for DebugConfigDto {
    fn from(c: &DebugConfig) -> Self {
        DebugConfigDto {
            trace_flag_id: c.trace_flag_id.clone(),
            levels: CategoryLevelsDto::from(&c.levels),
            expiration_date: c.expiration_date.clone(),
        }
    }
}

// ---- Opt-in telemetry config ----

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryConfigDto {
    pub local_enabled: bool,
    pub remote_enabled: bool,
}

impl From<&features::telemetry_config::TelemetryConfig> for TelemetryConfigDto {
    fn from(c: &features::telemetry_config::TelemetryConfig) -> Self {
        TelemetryConfigDto {
            local_enabled: c.local_enabled,
            remote_enabled: c.remote_enabled,
        }
    }
}

impl From<&TelemetryConfigDto> for features::telemetry_config::TelemetryConfig {
    fn from(d: &TelemetryConfigDto) -> Self {
        features::telemetry_config::TelemetryConfig {
            local_enabled: d.local_enabled,
            remote_enabled: d.remote_enabled,
        }
    }
}

// ---- Debug Traces management (Configure Logging dialog) ----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityDto {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub keywords: Vec<String>,
}
impl From<&EntityOption> for EntityDto {
    fn from(e: &EntityOption) -> Self {
        EntityDto {
            id: e.id.clone(),
            name: e.name.clone(),
            kind: e.kind.as_str().into(),
            keywords: e.keywords.clone(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceFlagDto {
    pub id: String,
    pub log_type: String,
    pub traced_entity_id: String,
    pub traced_entity_name: String,
    pub traced_entity_kind: String,
    pub debug_level_id: String,
    pub debug_level_name: String,
    pub start_date: Option<String>,
    pub expiration_date: Option<String>,
    pub creator_name: String,
}
impl From<&TraceFlagInfo> for TraceFlagDto {
    fn from(t: &TraceFlagInfo) -> Self {
        TraceFlagDto {
            id: t.id.clone(),
            log_type: t.log_type.clone(),
            traced_entity_id: t.traced_entity_id.clone(),
            traced_entity_name: t.traced_entity_name.clone(),
            traced_entity_kind: t.traced_entity_kind.as_str().into(),
            debug_level_id: t.debug_level_id.clone(),
            debug_level_name: t.debug_level_name.clone(),
            start_date: t.start_date.clone(),
            expiration_date: t.expiration_date.clone(),
            creator_name: t.creator_name.clone(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLevelDto {
    pub id: String,
    pub developer_name: String,
    pub levels: CategoryLevelsDto,
}
impl From<&DebugLevelInfo> for DebugLevelDto {
    fn from(d: &DebugLevelInfo) -> Self {
        DebugLevelDto {
            id: d.id.clone(),
            developer_name: d.developer_name.clone(),
            levels: CategoryLevelsDto::from(&d.levels),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggingConfigDto {
    pub trace_flags: Vec<TraceFlagDto>,
    pub debug_levels: Vec<DebugLevelDto>,
    pub entities: Vec<EntityDto>,
}
impl From<&LoggingConfig> for LoggingConfigDto {
    fn from(c: &LoggingConfig) -> Self {
        LoggingConfigDto {
            trace_flags: c.trace_flags.iter().map(TraceFlagDto::from).collect(),
            debug_levels: c.debug_levels.iter().map(DebugLevelDto::from).collect(),
            entities: c.entities.iter().map(EntityDto::from).collect(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordResultDto {
    pub sobject: String,
    pub op: String,
    pub id: Option<String>,
    pub ok: bool,
    pub error: Option<String>,
}
impl From<&RecordResult> for RecordResultDto {
    fn from(r: &RecordResult) -> Self {
        RecordResultDto {
            sobject: r.sobject.clone(),
            op: r.op.clone(),
            id: r.id.clone(),
            ok: r.ok,
            error: r.error.clone(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcomeDto {
    pub results: Vec<RecordResultDto>,
}
impl From<&SaveOutcome> for SaveOutcomeDto {
    fn from(o: &SaveOutcome) -> Self {
        SaveOutcomeDto {
            results: o.results.iter().map(RecordResultDto::from).collect(),
        }
    }
}

// ---- diff input (frontend -> domain) ----

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLevelDraftDto {
    pub local_key: String,
    pub developer_name: String,
    pub levels: CategoryLevelsDto,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLevelModDto {
    pub id: String,
    pub levels: CategoryLevelsDto,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceFlagDraftDto {
    pub log_type: String,
    pub traced_entity_id: String,
    pub debug_level_ref: String,
    pub start_date: Option<String>,
    pub expiration_date: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceFlagModDto {
    pub id: String,
    pub debug_level_id: String,
    pub start_date: Option<String>,
    pub expiration_date: Option<String>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LoggingDiffDto {
    pub debug_levels_added: Vec<DebugLevelDraftDto>,
    pub debug_levels_modified: Vec<DebugLevelModDto>,
    pub debug_levels_removed: Vec<String>,
    pub trace_flags_added: Vec<TraceFlagDraftDto>,
    pub trace_flags_modified: Vec<TraceFlagModDto>,
    pub trace_flags_removed: Vec<String>,
}
impl From<&LoggingDiffDto> for LoggingDiff {
    fn from(d: &LoggingDiffDto) -> Self {
        LoggingDiff {
            debug_levels_added: d
                .debug_levels_added
                .iter()
                .map(|x| DebugLevelDraft {
                    local_key: x.local_key.clone(),
                    developer_name: x.developer_name.clone(),
                    levels: CategoryLevels::from(&x.levels),
                })
                .collect(),
            debug_levels_modified: d
                .debug_levels_modified
                .iter()
                .map(|x| DebugLevelMod {
                    id: x.id.clone(),
                    levels: CategoryLevels::from(&x.levels),
                })
                .collect(),
            debug_levels_removed: d.debug_levels_removed.clone(),
            trace_flags_added: d
                .trace_flags_added
                .iter()
                .map(|x| TraceFlagDraft {
                    log_type: x.log_type.clone(),
                    traced_entity_id: x.traced_entity_id.clone(),
                    debug_level_ref: x.debug_level_ref.clone(),
                    start_date: x.start_date.clone(),
                    expiration_date: x.expiration_date.clone(),
                })
                .collect(),
            trace_flags_modified: d
                .trace_flags_modified
                .iter()
                .map(|x| TraceFlagMod {
                    id: x.id.clone(),
                    debug_level_id: x.debug_level_id.clone(),
                    start_date: x.start_date.clone(),
                    expiration_date: x.expiration_date.clone(),
                })
                .collect(),
            trace_flags_removed: d.trace_flags_removed.clone(),
        }
    }
}
