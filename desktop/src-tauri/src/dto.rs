//! Serde-serializable DTOs for the parsed debug-log view, plus mappers from the
//! `log_parser` / `features` model types (which are not serde-aware).

use features::debug_log::{DebugLogView, UnitView};
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

/// Max length of a node's joined `detail` string before truncation.
const MAX_DETAIL_LEN: usize = 300;

/// One node in the execution tree, ready for the frontend.
#[derive(serde::Serialize)]
pub struct ExecNodeDto {
    pub label: String,
    pub detail: String,
    pub dur_ns: Option<u64>,
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

/// One execution unit: its tree and its limit rollups.
#[derive(serde::Serialize)]
pub struct UnitDto {
    pub tree: Vec<ExecNodeDto>,
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
        }
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
