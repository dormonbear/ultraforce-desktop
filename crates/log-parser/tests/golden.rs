use log_parser::event::LogEvent;
use log_parser::parse::ParsedLog;

const LOG: &str = include_str!("fixtures/anon_apex.log");

#[test]
fn golden_log_parses_header_and_units() {
    let log = ParsedLog::parse(LOG);
    assert_eq!(log.header.as_ref().unwrap().api_version, "67.0");
    // unit 0 = leading USER_INFO; unit 1 = the EXECUTION_STARTED..FINISHED block
    assert_eq!(log.units.len(), 2);
    let exec = &log.units[1];
    assert_eq!(exec.entries.first().unwrap().event, LogEvent::ExecutionStarted);
    assert_eq!(exec.entries.last().unwrap().event, LogEvent::ExecutionFinished);
}

#[test]
fn golden_log_builds_expected_tree() {
    use log_parser::tree::build_tree;
    let log = ParsedLog::parse(LOG);
    let roots = build_tree(&log.units[1]);
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].entry.event, LogEvent::ExecutionStarted);
    // EXECUTION -> CODE_UNIT
    let code_unit = &roots[0].children[0];
    assert_eq!(code_unit.entry.event, LogEvent::CodeUnitStarted);
    // CODE_UNIT contains the two USER_DEBUG leaves and the limit-usage scope
    assert!(code_unit
        .children
        .iter()
        .any(|c| c.entry.event == LogEvent::UserDebug));
    assert!(code_unit
        .children
        .iter()
        .any(|c| c.entry.event == LogEvent::CumulativeLimitUsage));
}

#[test]
fn golden_log_extracts_limits() {
    use log_parser::limits::{extract_limits, LimitEntry};
    let log = ParsedLog::parse(LOG);
    let rollups = extract_limits(&log.units[1]);
    assert_eq!(rollups.len(), 1);
    assert_eq!(rollups[0].namespace, "(default)");
    let e = &rollups[0].entries;
    assert!(e.contains(&LimitEntry { name: "Number of SOQL queries".to_string(), used: 1, max: 100 }));
    assert!(e.contains(&LimitEntry { name: "Maximum CPU time".to_string(), used: 0, max: 10000 }));
    assert!(e.contains(&LimitEntry { name: "Maximum heap size".to_string(), used: 0, max: 6000000 }));
}
