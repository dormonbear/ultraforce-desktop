//! Typed child-table projection for subquery display (desktop only).
//!
//! `to_table()` stays untouched for MCP; the desktop additionally projects each
//! subquery into a sparse sidecar of typed mini-tables so the UI can expand,
//! flatten, and *filter* child records with correct numeric comparison.

use crate::soql::{collect_columns, collect_parent_paths, FieldValue, QueryResult, Record};

/// One subquery result attached to one parent row: a typed mini-table.
/// `rows` hold raw JSON scalars (string/number/bool/null) so downstream
/// filtering compares numbers numerically; the UI stringifies at render time.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildTable {
    /// Index into the parent table's `rows`.
    pub row_index: usize,
    /// Relationship (column) name, e.g. `Contacts`.
    pub column: String,
    pub total_size: u64,
    /// `false` when Salesforce truncated the child page (child queryMore is out
    /// of scope) — the UI shows a truncation hint.
    pub done: bool,
    /// Dotted leaf paths, first-seen order (same rules as `to_table`).
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

/// Project every subquery in `qr` into a sparse list of [`ChildTable`]s.
/// Rows whose subquery field is `Null` contribute no entry.
pub fn child_tables(qr: &QueryResult) -> Vec<ChildTable> {
    let mut out = Vec::new();
    for (row_index, record) in qr.records.iter().enumerate() {
        for (name, value) in &record.fields {
            let FieldValue::Children(child) = value else {
                continue;
            };
            let mut parent_paths: Vec<String> = Vec::new();
            for rec in &child.records {
                collect_parent_paths(&rec.fields, "", &mut parent_paths);
            }
            let mut columns: Vec<String> = Vec::new();
            for rec in &child.records {
                collect_columns(&rec.fields, "", &parent_paths, &mut columns);
            }
            let rows = child
                .records
                .iter()
                .map(|rec| columns.iter().map(|col| typed_cell(rec, col)).collect())
                .collect();
            out.push(ChildTable {
                row_index,
                column: name.clone(),
                total_size: child.total_size,
                done: child.done,
                columns,
                rows,
            });
        }
    }
    out
}

/// Typed twin of `soql::render_cell`: resolves a (possibly dotted) column to the
/// raw JSON scalar instead of display text.
fn typed_cell(record: &Record, column: &str) -> serde_json::Value {
    let mut parts = column.split('.');
    let head = parts.next().expect("column path is non-empty");
    let Some((_, value)) = record.fields.iter().find(|(k, _)| k == head) else {
        return serde_json::Value::Null;
    };
    match value {
        FieldValue::Null => serde_json::Value::Null,
        FieldValue::Scalar(v) => v.clone(),
        // SOQL subqueries nest one level only; defensively render as a count.
        FieldValue::Children(qr) => serde_json::Value::from(qr.total_size),
        FieldValue::Parent(child) => {
            let rest = parts.collect::<Vec<_>>().join(".");
            typed_cell(child, &rest)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soql::QueryResult;
    use serde_json::json;

    /// Two Accounts; row 0 has two subqueries (Contacts done, Opportunities
    /// truncated), row 1 has null subqueries. Contacts include a numeric field
    /// and a dotted parent path.
    const JSON: &str = r#"{
      "totalSize": 2, "done": true,
      "records": [
        {"attributes":{"type":"Account"},"Id":"001A","Name":"Acme",
         "Contacts":{"totalSize":2,"done":true,"records":[
            {"attributes":{"type":"Contact"},"LastName":"Yin","Age__c":9,
             "Owner":{"attributes":{"type":"User"},"Name":"Alice"}},
            {"attributes":{"type":"Contact"},"LastName":"Zhao","Age__c":10,"Owner":null}]},
         "Opportunities":{"totalSize":250,"done":false,"records":[
            {"attributes":{"type":"Opportunity"},"Amount":1200.5}]}},
        {"attributes":{"type":"Account"},"Id":"001B","Name":"Globex",
         "Contacts":null,"Opportunities":null}
      ]}"#;

    fn qr() -> QueryResult {
        QueryResult::from_json(JSON).unwrap()
    }

    #[test]
    fn emits_one_entry_per_subquery_occurrence_sparse() {
        let tables = child_tables(&qr());
        // Row 1's subqueries are Null → no entries (sparse sidecar).
        assert_eq!(tables.len(), 2);
        assert_eq!(tables[0].row_index, 0);
        assert_eq!(tables[0].column, "Contacts");
        assert_eq!(tables[1].row_index, 0);
        assert_eq!(tables[1].column, "Opportunities");
    }

    #[test]
    fn carries_typed_scalars_not_strings() {
        let tables = child_tables(&qr());
        let contacts = &tables[0];
        assert_eq!(contacts.columns, ["LastName", "Age__c", "Owner.Name"]);
        // Numbers stay JSON numbers → `9 < 10` compares numerically downstream.
        assert_eq!(contacts.rows[0], vec![json!("Yin"), json!(9), json!("Alice")]);
        assert_eq!(contacts.rows[1], vec![json!("Zhao"), json!(10), json!(null)]);
    }

    #[test]
    fn passes_through_total_size_and_done() {
        let tables = child_tables(&qr());
        let opps = &tables[1];
        assert_eq!(opps.total_size, 250);
        assert!(!opps.done);
        assert_eq!(opps.rows.len(), 1);
        assert_eq!(opps.rows[0], vec![json!(1200.5)]);
    }
}
