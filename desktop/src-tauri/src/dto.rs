//! Serde-serializable DTOs for the parsed debug-log view, plus mappers from the
//! `log_parser` / `features` model types (which are not serde-aware).

use apex_lang::complete::{Candidate as ApexCandidate, CandidateKind as ApexCandidateKind};
use features::debug_config::{CategoryLevels, DebugConfig, LogLevel};
use features::debug_log::{DebugLogView, UnitView};
use features::soql::{FieldValue, Record};
use log_parser::event::LogEvent;
use log_parser::limits::{LimitEntry, LimitRollup};
use log_parser::tree::ExecNode;
use sf_core::OrgRef;

/// One Salesforce org entry handed to the frontend.
#[derive(serde::Serialize)]
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
}

fn candidate_kind_str(k: &ApexCandidateKind) -> &'static str {
    match k {
        ApexCandidateKind::Type => "type",
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
}

impl From<&DebugConfig> for DebugConfigDto {
    fn from(c: &DebugConfig) -> Self {
        DebugConfigDto {
            trace_flag_id: c.trace_flag_id.clone(),
            levels: CategoryLevelsDto::from(&c.levels),
        }
    }
}

/// One Salesforce record in a SOQL result tree, ready for the frontend.
#[derive(serde::Serialize)]
pub struct RecordDto {
    pub sobject_type: String,
    pub fields: Vec<FieldDto>,
}

/// One field of a record: its name and tagged value.
#[derive(serde::Serialize)]
pub struct FieldDto {
    pub name: String,
    pub value: FieldValueDto,
}

/// A tagged field value: scalar text, a parent record, or child records.
#[derive(serde::Serialize)]
pub struct FieldValueDto {
    pub kind: &'static str, // "null" | "scalar" | "parent" | "children"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scalar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<Box<RecordDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<RecordDto>>,
}

/// Render a scalar JSON value as display text (strings unquoted).
fn scalar_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Recursively map a `Record` into its serializable DTO.
pub fn map_record(r: &Record) -> RecordDto {
    RecordDto {
        sobject_type: r.sobject_type.clone(),
        fields: r
            .fields
            .iter()
            .map(|(name, value)| FieldDto {
                name: name.clone(),
                value: map_field_value(value),
            })
            .collect(),
    }
}

fn map_field_value(v: &FieldValue) -> FieldValueDto {
    match v {
        FieldValue::Null => FieldValueDto {
            kind: "null",
            scalar: None,
            parent: None,
            children: None,
        },
        FieldValue::Scalar(s) => FieldValueDto {
            kind: "scalar",
            scalar: Some(scalar_text(s)),
            parent: None,
            children: None,
        },
        FieldValue::Parent(rec) => FieldValueDto {
            kind: "parent",
            scalar: None,
            parent: Some(Box::new(map_record(rec))),
            children: None,
        },
        FieldValue::Children(qr) => FieldValueDto {
            kind: "children",
            scalar: None,
            parent: None,
            children: Some(qr.records.iter().map(map_record).collect()),
        },
    }
}

/// Max length of a node's joined `detail` string before truncation.
const MAX_DETAIL_LEN: usize = 300;

/// One node in the execution tree, ready for the frontend.
#[derive(serde::Serialize)]
pub struct ExecNodeDto {
    pub label: String,
    pub detail: String,
    pub dur_ns: Option<u64>,
    pub self_ns: Option<u64>,
    pub children: Vec<ExecNodeDto>,
}

/// One governor-limit reading.
#[derive(serde::Serialize)]
pub struct LimitEntryDto {
    pub name: String,
    pub used: u64,
    pub max: u64,
}

/// All limit readings for one namespace.
#[derive(serde::Serialize)]
pub struct LimitRollupDto {
    pub namespace: String,
    pub entries: Vec<LimitEntryDto>,
}

/// One aggregated method/unit hotspot.
#[derive(serde::Serialize)]
pub struct HotspotDto {
    pub signature: String,
    pub self_ns: u64,
    pub total_ns: u64,
    pub count: usize,
}

/// One executed SOQL query or DML operation.
#[derive(serde::Serialize)]
pub struct StatementDto {
    pub kind: String,
    pub text: String,
    pub rows: u64,
    pub dur_ns: Option<u64>,
}

/// One execution unit: its tree, hotspots, SOQL/DML statements, and limit rollups.
#[derive(serde::Serialize)]
pub struct UnitDto {
    pub tree: Vec<ExecNodeDto>,
    pub hotspots: Vec<HotspotDto>,
    pub statements: Vec<StatementDto>,
    pub limits: Vec<LimitRollupDto>,
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
    }
}

/// Map a parsed `DebugLogView` into its serializable unit DTOs.
pub fn map_units(view: &DebugLogView) -> Vec<UnitDto> {
    view.units.iter().map(map_unit).collect()
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
        }
    }

    #[test]
    fn candidate_dto_maps_method_kind() {
        let candidate = apex_lang::complete::Candidate {
            label: "valueOf".into(),
            kind: apex_lang::complete::CandidateKind::Method,
        };
        let dto = CandidateDto::from(&candidate);
        assert_eq!(dto.label, "valueOf");
        assert_eq!(dto.kind, "method");
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
    fn record_dto_maps_scalar_parent_children() {
        use features::soql::{FieldValue, QueryResult, Record};
        let parent = Record {
            sobject_type: "User".into(),
            fields: vec![("Name".into(), FieldValue::Scalar(serde_json::json!("Amy")))],
        };
        let child = Record {
            sobject_type: "Contact".into(),
            fields: vec![(
                "LastName".into(),
                FieldValue::Scalar(serde_json::json!("Lee")),
            )],
        };
        let rec = Record {
            sobject_type: "Account".into(),
            fields: vec![
                ("Id".into(), FieldValue::Scalar(serde_json::json!("001"))),
                ("Phone".into(), FieldValue::Null),
                ("Owner".into(), FieldValue::Parent(Box::new(parent))),
                (
                    "Contacts".into(),
                    FieldValue::Children(QueryResult {
                        total_size: 1,
                        done: true,
                        records: vec![child],
                    }),
                ),
            ],
        };
        let d = map_record(&rec);
        assert_eq!(d.sobject_type, "Account");
        assert_eq!(d.fields.len(), 4);
        assert_eq!(d.fields[0].value.kind, "scalar");
        assert_eq!(d.fields[0].value.scalar.as_deref(), Some("001"));
        assert_eq!(d.fields[1].value.kind, "null");
        assert_eq!(d.fields[2].value.kind, "parent");
        assert_eq!(
            d.fields[2].value.parent.as_ref().unwrap().sobject_type,
            "User"
        );
        assert_eq!(d.fields[3].value.kind, "children");
        assert_eq!(d.fields[3].value.children.as_ref().unwrap().len(), 1);
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
            }],
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
            }],
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
}
