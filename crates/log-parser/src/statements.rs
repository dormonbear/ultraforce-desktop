//! SOQL / DML statement extraction from a debug log — the data behind N+1 and
//! bulkification analysis (that plugin surfaces query text + row counts per statement).

use crate::event::LogEvent;
use crate::parse::ExecUnit;

/// Whether a statement is a SOQL query or a DML operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementKind {
    Soql,
    Dml,
}

/// One executed SOQL query or DML operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Statement {
    pub kind: StatementKind,
    /// The SOQL query text, or `"Op Type"` for DML (e.g. `"Insert Account"`).
    pub text: String,
    /// Rows returned (SOQL) or affected (DML).
    pub rows: u64,
    /// Wall time for the statement, if both begin and end were seen.
    pub dur_ns: Option<u64>,
}

/// `key:value` param → the value (`"Rows:5"` with key `Rows` → `"5"`).
fn param_field<'a>(params: &'a [String], key: &str) -> Option<&'a str> {
    let prefix = format!("{key}:");
    params.iter().find_map(|p| p.strip_prefix(&prefix))
}

fn param_u64(params: &[String], key: &str) -> u64 {
    param_field(params, key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Extract every SOQL/DML statement (in execution order) from a unit's entries.
pub fn statements(unit: &ExecUnit) -> Vec<Statement> {
    let mut out = Vec::new();
    // begin time + (text, rows) awaiting the matching end.
    let mut soql: Vec<(u64, String)> = Vec::new();
    let mut dml: Vec<(u64, String, u64)> = Vec::new();

    for e in &unit.entries {
        match e.event {
            LogEvent::SoqlExecuteBegin => {
                let text = e.params.last().cloned().unwrap_or_default();
                soql.push((e.nanos, text));
            }
            LogEvent::SoqlExecuteEnd => {
                if let Some((start, text)) = soql.pop() {
                    out.push(Statement {
                        kind: StatementKind::Soql,
                        text,
                        rows: param_u64(&e.params, "Rows"),
                        dur_ns: Some(e.nanos.saturating_sub(start)),
                    });
                }
            }
            LogEvent::DmlBegin => {
                // DML_BEGIN|[line]|Op:Insert|Type:Account|Rows:1 — rows are here.
                let op = param_field(&e.params, "Op").unwrap_or("");
                let ty = param_field(&e.params, "Type").unwrap_or("");
                let text = format!("{op} {ty}").trim().to_string();
                dml.push((e.nanos, text, param_u64(&e.params, "Rows")));
            }
            LogEvent::DmlEnd => {
                if let Some((start, text, rows)) = dml.pop() {
                    out.push(Statement {
                        kind: StatementKind::Dml,
                        text,
                        rows,
                        dur_ns: Some(e.nanos.saturating_sub(start)),
                    });
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    #[test]
    fn extracts_soql_with_rows_and_duration() {
        let text = "67.0 X,Y\n\
            00:00:00.0 (0)|EXECUTION_STARTED\n\
            00:00:00.0 (10)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n\
            00:00:00.0 (60)|SOQL_EXECUTE_END|[3]|Rows:5\n\
            00:00:00.0 (90)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let stmts = statements(&log.units[0]);
        assert_eq!(stmts.len(), 1);
        assert_eq!(stmts[0].kind, StatementKind::Soql);
        assert_eq!(stmts[0].text, "SELECT Id FROM Account");
        assert_eq!(stmts[0].rows, 5);
        assert_eq!(stmts[0].dur_ns, Some(50));
    }

    #[test]
    fn extracts_dml_op_type_rows() {
        let text = "67.0 X,Y\n\
            00:00:00.0 (0)|EXECUTION_STARTED\n\
            00:00:00.0 (10)|DML_BEGIN|[7]|Op:Insert|Type:Account|Rows:200\n\
            00:00:00.0 (110)|DML_END|[7]\n\
            00:00:00.0 (120)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let stmts = statements(&log.units[0]);
        assert_eq!(stmts.len(), 1);
        assert_eq!(stmts[0].kind, StatementKind::Dml);
        assert_eq!(stmts[0].text, "Insert Account");
        assert_eq!(stmts[0].rows, 200);
        assert_eq!(stmts[0].dur_ns, Some(100));
    }

    #[test]
    fn n_plus_one_same_query_repeated() {
        // The same query run 3 times — what an N+1 view groups.
        let text = "67.0 X,Y\n\
            00:00:00.0 (0)|EXECUTION_STARTED\n\
            00:00:00.0 (10)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Contact\n\
            00:00:00.0 (20)|SOQL_EXECUTE_END|[3]|Rows:1\n\
            00:00:00.0 (30)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Contact\n\
            00:00:00.0 (40)|SOQL_EXECUTE_END|[3]|Rows:1\n\
            00:00:00.0 (50)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Contact\n\
            00:00:00.0 (60)|SOQL_EXECUTE_END|[3]|Rows:1\n\
            00:00:00.0 (90)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let stmts = statements(&log.units[0]);
        assert_eq!(stmts.len(), 3);
        assert!(stmts.iter().all(|s| s.text == "SELECT Id FROM Contact"));
    }
}
