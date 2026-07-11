//! Serde-serializable DTOs for the parsed debug-log view, plus mappers from the
//! `log_parser` / `features` model types (which are not serde-aware).

use apex_lang::candidate::{Candidate as ApexCandidate, CandidateKind as ApexCandidateKind};
use features::debug_config::{CategoryLevels, DebugConfig, LogLevel};
use features::debug_log::{DebugLogView, UnitView};
use features::debug_traces::{
    DebugLevelDraft, DebugLevelInfo, DebugLevelMod, EntityOption, LoggingConfig, LoggingDiff,
    RecordResult, SaveOutcome, TraceFlagDraft, TraceFlagInfo, TraceFlagMod,
};
use log_parser::debug_session::{DebugSession, Frame, Step, VarValue};
use log_parser::event::LogEvent;
use log_parser::source::SourceRef;
use log_parser::limits::{LimitEntry, LimitRollup};
use log_parser::tree::ExecNode;
use sf_core::OrgRef;

/// One Salesforce org entry handed to the frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgDto {
    pub username: String,
    pub alias: Option<String>,
    pub instance_url: Option<String>,
    pub is_default: bool,
}

impl From<&OrgRef> for OrgDto {
    fn from(o: &OrgRef) -> Self {
        OrgDto {
            username: o.username.clone(),
            alias: o.alias.clone(),
            instance_url: o.instance_url.clone(),
            is_default: o.is_default,
        }
    }
}

/// One completion candidate for the React/Monaco side.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDto {
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
    pub params: Option<Vec<String>>,
}

fn candidate_kind_str(k: &ApexCandidateKind) -> &'static str {
    match k {
        ApexCandidateKind::Type => "type",
        ApexCandidateKind::Constructor => "constructor",
        ApexCandidateKind::Keyword => "keyword",
        ApexCandidateKind::LocalVar => "localVar",
        ApexCandidateKind::Method => "method",
        ApexCandidateKind::Property => "property",
    }
}

impl From<&ApexCandidate> for CandidateDto {
    fn from(c: &ApexCandidate) -> Self {
        CandidateDto {
            label: c.label.clone(),
            kind: candidate_kind_str(&c.kind).to_string(),
            detail: c.detail.clone(),
            params: c.params.clone(),
        }
    }
}

/// One SOQL completion candidate for the React/Monaco side.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDto {
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
}

fn soql_candidate_kind_str(k: &soql_lang::CandidateKind) -> &'static str {
    match k {
        soql_lang::CandidateKind::Field => "field",
        soql_lang::CandidateKind::Object => "object",
        soql_lang::CandidateKind::Keyword => "keyword",
        soql_lang::CandidateKind::Function => "function",
        soql_lang::CandidateKind::Relationship => "relationship",
    }
}

impl From<&soql_lang::Candidate> for CompletionDto {
    fn from(c: &soql_lang::Candidate) -> Self {
        CompletionDto {
            label: c.label.clone(),
            kind: soql_candidate_kind_str(&c.kind).to_string(),
            detail: c.detail.clone(),
        }
    }
}

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
}
impl From<&EntityOption> for EntityDto {
    fn from(e: &EntityOption) -> Self {
        EntityDto {
            id: e.id.clone(),
            name: e.name.clone(),
            kind: e.kind.as_str().into(),
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

/// Max length of a node's joined `detail` string before truncation.
const MAX_DETAIL_LEN: usize = 300;

/// A class + (optional) line a log line maps to in Apex source.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRefDto {
    pub class_name: String,
    pub line: Option<u32>,
}

/// Map a parser `SourceRef` into its DTO.
pub fn map_source(s: &SourceRef) -> SourceRefDto {
    SourceRefDto {
        class_name: s.class_name.clone(),
        line: s.line,
    }
}

// ---- Step debugger (offline log replay) ----

/// One variable visible in a frame at a step.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VarDto {
    pub name: String,
    pub type_name: Option<String>,
    pub value: String,
}

/// One call-stack frame at a step.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDto {
    pub class_name: String,
    pub line: Option<u32>,
    pub signature: String,
    pub variables: Vec<VarDto>,
}

/// One stop point in the replay (lightweight). Its full call stack + variables
/// are fetched on demand via `debug_frames_at(unit_index, entry_index)`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepDto {
    pub unit_index: usize,
    pub entry_index: usize,
    pub source: SourceRefDto,
    pub depth: usize,
    pub is_frame_start: bool,
}

/// The replay outline for a whole log: ordered stop points plus whether the log
/// carries any variable data (so the UI can prompt for FINEST when it doesn't).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionDto {
    pub steps: Vec<StepDto>,
    pub has_variables: bool,
}

fn map_var(v: &VarValue) -> VarDto {
    VarDto {
        name: v.name.clone(),
        type_name: v.type_name.clone(),
        value: v.value.clone(),
    }
}

fn map_frame(f: &Frame) -> FrameDto {
    FrameDto {
        class_name: f.class_name.clone(),
        line: f.line,
        signature: f.signature.clone(),
        variables: f.variables.iter().map(map_var).collect(),
    }
}

fn map_step(s: &Step) -> StepDto {
    StepDto {
        unit_index: s.unit_index,
        entry_index: s.entry_index,
        source: map_source(&s.source),
        depth: s.depth,
        is_frame_start: s.is_frame_start,
    }
}

/// Map a parser `DebugSession` outline into its serializable DTO.
pub fn map_session(s: &DebugSession) -> DebugSessionDto {
    DebugSessionDto {
        steps: s.steps.iter().map(map_step).collect(),
        has_variables: s.has_variables,
    }
}

/// Map a single step's reconstructed call stack into its serializable DTO.
pub fn map_frames(frames: &[Frame]) -> Vec<FrameDto> {
    frames.iter().map(map_frame).collect()
}

/// One node in the execution tree, ready for the frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecNodeDto {
    pub label: String,
    pub detail: String,
    pub dur_ns: Option<u64>,
    pub self_ns: Option<u64>,
    pub children: Vec<ExecNodeDto>,
    /// Apex source this node maps to, or `None` when unresolved.
    pub source: Option<SourceRefDto>,
    /// Absolute start offset in ns from log start (from `entry.nanos`).
    pub start_ns: u64,
}

/// One governor-limit reading.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitEntryDto {
    pub name: String,
    pub used: u64,
    pub max: u64,
}

/// All limit readings for one namespace.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitRollupDto {
    pub namespace: String,
    pub entries: Vec<LimitEntryDto>,
}

/// One aggregated method/unit hotspot.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotDto {
    pub signature: String,
    pub self_ns: u64,
    pub total_ns: u64,
    pub self_bytes: u64,
    pub count: usize,
}

/// One executed SOQL query or DML operation.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementDto {
    pub kind: String,
    pub text: String,
    pub rows: u64,
    pub dur_ns: Option<u64>,
}

/// One thrown exception or fatal error.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExceptionDto {
    pub kind: String,
    pub message: String,
}

/// One execution unit: its tree, hotspots, SOQL/DML statements, limit rollups,
/// and any exceptions/fatal errors.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitDto {
    pub tree: Vec<ExecNodeDto>,
    pub hotspots: Vec<HotspotDto>,
    pub statements: Vec<StatementDto>,
    pub limits: Vec<LimitRollupDto>,
    pub exceptions: Vec<ExceptionDto>,
}

/// A readable name for a log event. For `Other(s)` the raw event name is used.
pub fn event_label(event: &LogEvent) -> &str {
    match event {
        LogEvent::ExecutionStarted => "EXECUTION_STARTED",
        LogEvent::ExecutionFinished => "EXECUTION_FINISHED",
        LogEvent::CodeUnitStarted => "CODE_UNIT_STARTED",
        LogEvent::CodeUnitFinished => "CODE_UNIT_FINISHED",
        LogEvent::MethodEntry => "METHOD_ENTRY",
        LogEvent::MethodExit => "METHOD_EXIT",
        LogEvent::ConstructorEntry => "CONSTRUCTOR_ENTRY",
        LogEvent::ConstructorExit => "CONSTRUCTOR_EXIT",
        LogEvent::SoqlExecuteBegin => "SOQL_EXECUTE_BEGIN",
        LogEvent::SoqlExecuteEnd => "SOQL_EXECUTE_END",
        LogEvent::DmlBegin => "DML_BEGIN",
        LogEvent::DmlEnd => "DML_END",
        LogEvent::CalloutRequest => "CALLOUT_REQUEST",
        LogEvent::CalloutResponse => "CALLOUT_RESPONSE",
        LogEvent::UserDebug => "USER_DEBUG",
        LogEvent::HeapAllocate => "HEAP_ALLOCATE",
        LogEvent::VariableScopeBegin => "VARIABLE_SCOPE_BEGIN",
        LogEvent::VariableAssignment => "VARIABLE_ASSIGNMENT",
        LogEvent::CumulativeLimitUsage => "CUMULATIVE_LIMIT_USAGE",
        LogEvent::CumulativeLimitUsageEnd => "CUMULATIVE_LIMIT_USAGE_END",
        LogEvent::LimitUsageForNs => "LIMIT_USAGE_FOR_NS",
        LogEvent::FatalError => "FATAL_ERROR",
        LogEvent::ExceptionThrown => "EXCEPTION_THROWN",
        LogEvent::Other(name) => name,
    }
}

/// Join an entry's params into a single readable detail string, truncated.
fn detail_of(params: &[String]) -> String {
    let mut detail = params.join(" | ");
    if detail.len() > MAX_DETAIL_LEN {
        // Truncate on a char boundary, then append an ellipsis marker.
        let mut end = MAX_DETAIL_LEN;
        while !detail.is_char_boundary(end) {
            end -= 1;
        }
        detail.truncate(end);
        detail.push('…');
    }
    detail
}

/// Recursively map an `ExecNode` into its DTO.
fn map_node(node: &ExecNode) -> ExecNodeDto {
    ExecNodeDto {
        label: event_label(&node.entry.event).to_string(),
        detail: detail_of(&node.entry.params),
        dur_ns: node.dur_ns,
        self_ns: node.self_ns,
        children: node.children.iter().map(map_node).collect(),
        source: node.source.as_ref().map(map_source),
        start_ns: node.entry.nanos,
    }
}

fn map_limit_entry(entry: &LimitEntry) -> LimitEntryDto {
    LimitEntryDto {
        name: entry.name.clone(),
        used: entry.used,
        max: entry.max,
    }
}

fn map_rollup(rollup: &LimitRollup) -> LimitRollupDto {
    LimitRollupDto {
        namespace: rollup.namespace.clone(),
        entries: rollup.entries.iter().map(map_limit_entry).collect(),
    }
}

fn map_unit(unit: &UnitView) -> UnitDto {
    UnitDto {
        tree: unit.tree.iter().map(map_node).collect(),
        hotspots: log_parser::profile::hotspots(&unit.tree)
            .into_iter()
            .map(|h| HotspotDto {
                signature: h.signature,
                self_ns: h.self_ns,
                total_ns: h.total_ns,
                self_bytes: h.self_bytes,
                count: h.count,
            })
            .collect(),
        statements: unit
            .statements
            .iter()
            .map(|s| StatementDto {
                kind: match s.kind {
                    log_parser::statements::StatementKind::Soql => "soql",
                    log_parser::statements::StatementKind::Dml => "dml",
                }
                .to_string(),
                text: s.text.clone(),
                rows: s.rows,
                dur_ns: s.dur_ns,
            })
            .collect(),
        limits: unit.limits.iter().map(map_rollup).collect(),
        exceptions: unit
            .exceptions
            .iter()
            .map(|e| ExceptionDto {
                kind: e.kind.clone(),
                message: e.message.clone(),
            })
            .collect(),
    }
}

/// Map a parsed `DebugLogView` into its serializable unit DTOs.
pub fn map_units(view: &DebugLogView) -> Vec<UnitDto> {
    view.units.iter().map(map_unit).collect()
}

// ---- Command result / event payload DTOs ----

/// One subquery result attached to one parent row. Cells are raw JSON scalars
/// (string/number/bool/null) — the UI stringifies at render time so filters
/// compare numbers numerically.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildTableDto {
    pub row_index: usize,
    pub column: String,
    pub total_size: u64,
    pub done: bool,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    /// Nested subqueries inside child records; `row_index` points into this
    /// table's `rows`.
    pub children: Vec<ChildTableDto>,
}

pub fn map_child_table(t: features::soql_children::ChildTable) -> ChildTableDto {
    ChildTableDto {
        row_index: t.row_index,
        column: t.column,
        total_size: t.total_size,
        done: t.done,
        columns: t.columns,
        rows: t.rows,
        children: t.children.into_iter().map(map_child_table).collect(),
    }
}

/// Display labels for one child relationship's table (label toggle).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildLabelsDto {
    pub label: Option<String>,
    pub columns: std::collections::HashMap<String, String>,
}

/// Display labels for a query's result columns (API name ↔ label toggle).
/// Unresolvable columns are absent — the frontend falls back to API names.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnLabelsDto {
    pub parent: std::collections::HashMap<String, String>,
    pub children: std::collections::HashMap<String, ChildLabelsDto>,
}

pub fn map_column_labels(l: features::soql_labels::ColumnLabels) -> ColumnLabelsDto {
    ColumnLabelsDto {
        parent: l.parent,
        children: l
            .children
            .into_iter()
            .map(|(rel, c)| {
                (
                    rel,
                    ChildLabelsDto {
                        label: c.label,
                        columns: c.columns,
                    },
                )
            })
            .collect(),
    }
}

/// A SOQL query result: flat table projection plus a sparse sidecar of typed
/// child tables (one per subquery occurrence).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoqlResultDto {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_size: u64,
    pub done: bool,
    pub child_tables: Vec<ChildTableDto>,
}

/// Incremental progress for a running SOQL query, emitted as `soql-progress`.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoqlProgress {
    pub id: String,
    pub fetched: u64,
    pub total: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgressDto {
    pub org: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultDto {
    pub org: String,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
}

/// One callable signature for the Monaco signature-help widget.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureDto {
    pub label: String,
    pub params: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelpDto {
    pub signatures: Vec<SignatureDto>,
    pub active_signature: usize,
    pub active_parameter: usize,
}

impl From<&apex_lang::ast::signature::SignatureHelp> for SignatureHelpDto {
    fn from(h: &apex_lang::ast::signature::SignatureHelp) -> Self {
        SignatureHelpDto {
            signatures: h
                .signatures
                .iter()
                .map(|s| SignatureDto {
                    label: s.label.clone(),
                    params: s.params.clone(),
                })
                .collect(),
            active_signature: h.active_signature,
            active_parameter: h.active_parameter,
        }
    }
}

/// Source code (read-only) for an Apex class or trigger, for "jump to source".
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexSourceDto {
    pub name: String,
    pub kind: String,
    pub body: String,
}

/// Result of one anonymous-Apex run, flattened for the frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexOutcomeDto {
    pub compiled: bool,
    pub success: bool,
    pub compile_problem: Option<String>,
    pub exception_message: Option<String>,
    pub exception_stack_trace: Option<String>,
    pub line: Option<i64>,
    pub column: Option<i64>,
    pub logs: String,
}

/// One debug-log list entry handed to the frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRefDto {
    pub id: String,
    pub operation: String,
    pub status: String,
    pub start_time: String,
    pub application: String,
    pub user: String,
    pub duration_ms: i64,
    pub log_length: i64,
}

/// Map an `sf apex list log` entry into its DTO.
pub fn map_log_ref(l: sf_core::ApexLogRef) -> LogRefDto {
    LogRefDto {
        id: l.id,
        operation: l.operation,
        status: l.status,
        start_time: l.start_time,
        application: l.application,
        user: l.log_user.name,
        duration_ms: l.duration_ms,
        log_length: l.log_length,
    }
}

/// A fetched debug log's raw body plus its parsed execution tree + limits.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogViewDto {
    pub raw: String,
    pub api_version: Option<String>,
    pub units: Vec<UnitDto>,
}

/// Parsed view WITHOUT the raw body: the caller already holds the body it passed
/// to `parse_log`, so echoing 16MB+ back over IPC (and re-deserializing it) is
/// pure waste. The frontend re-attaches `raw` from the body it owns.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLogDto {
    pub api_version: Option<String>,
    pub units: Vec<UnitDto>,
}

/// The parsed view (execution tree + limits) without the raw body. Per-line source
/// mapping is excluded — loaded lazily via `log_sources` so opening a large log
/// isn't blocked by serializing a line-length array.
pub fn parsed_dto(view: &DebugLogView) -> ParsedLogDto {
    ParsedLogDto {
        api_version: view.header.as_ref().map(|h| h.api_version.clone()),
        units: map_units(view),
    }
}

/// Classified health of the `sf` CLI, so the UI can give the right guidance:
/// install it, upgrade it, or fix a PATH problem — instead of a bare error.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfStatusDto {
    /// "ok" | "outdated" | "not_found" | "path_issue"
    pub state: &'static str,
    /// Raw `sf --version` output when the CLI was found.
    pub version: Option<String>,
    /// Minimum version Ultraforce supports, e.g. "2.0.0".
    pub min_version: String,
    /// Where a login-shell probe found `sf` when it isn't on the app's PATH.
    pub found_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use log_parser::entry::LogEntry;

    fn entry(event: LogEvent, params: &[&str]) -> LogEntry {
        LogEntry {
            timestamp: "16:00:00.0 (0)".to_string(),
            nanos: 0,
            event,
            params: params.iter().map(|s| s.to_string()).collect(),
            line_no: 0,
        }
    }

    fn node(
        event: LogEvent,
        params: &[&str],
        dur_ns: Option<u64>,
        children: Vec<ExecNode>,
    ) -> ExecNode {
        ExecNode {
            entry: entry(event, params),
            children,
            dur_ns,
            self_ns: dur_ns,
            source: None,
        }
    }

    #[test]
    fn map_node_carries_source() {
        use log_parser::parse::ParsedLog;
        use log_parser::tree::build_tree;
        let text = "67.0 X\n\
16:00:00.0 (10)|EXECUTION_STARTED\n\
16:00:00.0 (20)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n\
16:00:00.0 (30)|METHOD_EXIT|[5]|MyClass.doWork()\n\
16:00:00.0 (40)|EXECUTION_FINISHED\n";
        let roots = build_tree(&ParsedLog::parse(text).units[0]);
        let dto = map_node(&roots[0]);
        assert!(dto.source.is_none()); // EXECUTION: no class
        let method = &dto.children[0];
        let s = method.source.as_ref().expect("method has source");
        assert_eq!(s.class_name, "MyClass");
        assert_eq!(s.line, Some(5));
    }

    #[test]
    fn maps_start_ns_from_entry_nanos() {
        use log_parser::parse::ParsedLog;
        use log_parser::tree::build_tree;
        let text = "67.0 X\n\
                    16:55:57.42 (42826462)|METHOD_ENTRY|[1]|Foo.bar()\n\
                    16:55:57.43 (52826462)|METHOD_EXIT|[1]|Foo.bar()";
        let unit = ParsedLog::parse(text).units[0].clone();
        let roots = build_tree(&unit);
        let dto = map_node(&roots[0]);
        assert_eq!(dto.start_ns, 42_826_462);
    }

    #[test]
    fn candidate_dto_maps_method_kind() {
        let candidate = apex_lang::candidate::Candidate {
            label: "valueOf".into(),
            kind: apex_lang::candidate::CandidateKind::Method,
            detail: None,
            params: None,
        };
        let dto = CandidateDto::from(&candidate);
        assert_eq!(dto.label, "valueOf");
        assert_eq!(dto.kind, "method");
    }

    #[test]
    fn candidate_dto_carries_detail_and_params() {
        let c = ApexCandidate {
            label: "debug".into(),
            kind: ApexCandidateKind::Method,
            detail: Some("void".into()),
            params: Some(vec!["Object".into()]),
        };
        let dto = CandidateDto::from(&c);
        assert_eq!(dto.detail.as_deref(), Some("void"));
        assert_eq!(dto.params, Some(vec!["Object".to_string()]));
    }

    #[test]
    fn org_dto_maps_from_org_ref() {
        let r = sf_core::OrgRef {
            username: "me@x.com".into(),
            alias: Some("dev".into()),
            instance_url: Some("https://x.my".into()),
            is_default: true,
        };
        let d = OrgDto::from(&r);
        assert_eq!(d.username, "me@x.com");
        assert_eq!(d.alias.as_deref(), Some("dev"));
        assert!(d.is_default);
    }

    #[test]
    fn child_table_dto_serializes_camel_case_with_typed_rows() {
        let dto = map_child_table(features::soql_children::ChildTable {
            row_index: 3,
            column: "Contacts".into(),
            total_size: 250,
            done: false,
            columns: vec!["LastName".into(), "Age__c".into()],
            rows: vec![vec![serde_json::json!("Yin"), serde_json::json!(9)]],
            children: vec![features::soql_children::ChildTable {
                row_index: 0,
                column: "Cases".into(),
                total_size: 1,
                done: true,
                columns: vec!["Subject".into()],
                rows: vec![vec![serde_json::json!("Broken")]],
                children: vec![],
            }],
        });
        let v: serde_json::Value = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["rowIndex"], 3);
        assert_eq!(v["totalSize"], 250);
        assert_eq!(v["done"], false);
        // Typed passthrough: the number survives as a JSON number.
        assert_eq!(v["rows"][0][1], serde_json::json!(9));
        // Nested subqueries map recursively.
        assert_eq!(v["children"][0]["column"], "Cases");
        assert_eq!(v["children"][0]["rowIndex"], 0);
        assert_eq!(v["children"][0]["children"], serde_json::json!([]));
    }

    #[test]
    fn column_labels_dto_serializes_camel_case() {
        let labels = features::soql_labels::ColumnLabels {
            parent: std::collections::HashMap::from([("Owner.Name".into(), "Full Name".into())]),
            children: std::collections::HashMap::from([(
                "Contacts".into(),
                features::soql_labels::ChildLabels {
                    label: Some("Contacts".into()),
                    columns: std::collections::HashMap::from([(
                        "LastName".into(),
                        "Last Name".into(),
                    )]),
                },
            )]),
        };
        let v: serde_json::Value = serde_json::to_value(map_column_labels(labels)).unwrap();
        assert_eq!(v["parent"]["Owner.Name"], "Full Name");
        assert_eq!(v["children"]["Contacts"]["label"], "Contacts");
        assert_eq!(v["children"]["Contacts"]["columns"]["LastName"], "Last Name");
    }

    #[test]
    fn event_label_maps_known_and_other() {
        assert_eq!(event_label(&LogEvent::UserDebug), "USER_DEBUG");
        assert_eq!(
            event_label(&LogEvent::SoqlExecuteBegin),
            "SOQL_EXECUTE_BEGIN"
        );
        assert_eq!(
            event_label(&LogEvent::Other("FLOW_ELEMENT_BEGIN".to_string())),
            "FLOW_ELEMENT_BEGIN"
        );
    }

    #[test]
    fn maps_nested_tree_preserving_structure() {
        let leaf = node(LogEvent::UserDebug, &["[1]", "DEBUG", "hi"], None, vec![]);
        let inner = node(LogEvent::CodeUnitStarted, &["x"], Some(20), vec![leaf]);
        let root = node(LogEvent::ExecutionStarted, &[], Some(40), vec![inner]);

        let view = DebugLogView {
            header: None,
            units: vec![UnitView {
                tree: vec![root],
                statements: vec![],
                limits: vec![],
                exceptions: vec![],
            }],
            raw_sources: vec![],
        };
        let units = map_units(&view);
        assert_eq!(units.len(), 1);

        let tree = &units[0].tree;
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].label, "EXECUTION_STARTED");
        assert_eq!(tree[0].dur_ns, Some(40));
        assert_eq!(tree[0].detail, "");
        assert_eq!(tree[0].children.len(), 1);

        let child = &tree[0].children[0];
        assert_eq!(child.label, "CODE_UNIT_STARTED");
        assert_eq!(child.detail, "x");
        assert_eq!(child.dur_ns, Some(20));
        assert_eq!(child.children.len(), 1);

        let grandchild = &child.children[0];
        assert_eq!(grandchild.label, "USER_DEBUG");
        assert_eq!(grandchild.detail, "[1] | DEBUG | hi");
        assert_eq!(grandchild.dur_ns, None);
        assert!(grandchild.children.is_empty());
    }

    #[test]
    fn maps_limit_rollups() {
        let view = DebugLogView {
            header: None,
            units: vec![UnitView {
                tree: vec![],
                statements: vec![],
                limits: vec![LimitRollup {
                    namespace: "(default)".to_string(),
                    entries: vec![
                        LimitEntry {
                            name: "Number of SOQL queries".to_string(),
                            used: 2,
                            max: 100,
                        },
                        LimitEntry {
                            name: "Maximum CPU time".to_string(),
                            used: 50,
                            max: 10000,
                        },
                    ],
                }],
                exceptions: vec![],
            }],
            raw_sources: vec![],
        };
        let units = map_units(&view);
        let limits = &units[0].limits;
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0].namespace, "(default)");
        assert_eq!(limits[0].entries.len(), 2);
        assert_eq!(limits[0].entries[0].name, "Number of SOQL queries");
        assert_eq!(limits[0].entries[0].used, 2);
        assert_eq!(limits[0].entries[0].max, 100);
        assert_eq!(limits[0].entries[1].used, 50);
        assert_eq!(limits[0].entries[1].max, 10000);
    }

    #[test]
    fn truncates_long_detail() {
        let long = "a".repeat(500);
        let n = node(LogEvent::UserDebug, &[&long], None, vec![]);
        let dto = map_node(&n);
        assert!(dto.detail.chars().count() <= MAX_DETAIL_LEN + 1);
        assert!(dto.detail.ends_with('…'));
    }

    #[test]
    fn signature_help_dto_maps_camel_case() {
        let h = apex_lang::ast::signature::SignatureHelp {
            signatures: vec![apex_lang::ast::signature::Signature {
                label: "debug(Object) : void".into(),
                params: vec!["Object".into()],
            }],
            active_signature: 0,
            active_parameter: 1,
        };
        let dto = SignatureHelpDto::from(&h);
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["activeParameter"], 1);
        assert_eq!(json["signatures"][0]["label"], "debug(Object) : void");
    }
}
