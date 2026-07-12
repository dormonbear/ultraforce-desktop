//! SOQL result DTOs: the flat table projection, its sparse child-table sidecar,
//! column-label lookups, the running-query progress event, and the query-plan
//! (EXPLAIN) adapter.

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

// ---- Subquery ranges (editor highlighting) ----

/// One inner subquery `(SELECT … )` range as **UTF-16 code-unit offsets** into
/// the query text. Monaco positions are UTF-16 based, so the frontend feeds
/// these straight into `model.getPositionAt` to build a decoration range.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubquerySpanDto {
    pub start: usize,
    pub end: usize,
}

/// Detect subquery spans in `query` and convert the crate's byte offsets to the
/// UTF-16 offsets Monaco expects.
pub fn subquery_spans(query: &str) -> Vec<SubquerySpanDto> {
    let byte_to_utf16 =
        |byte: usize| query[..byte].chars().map(char::len_utf16).sum::<usize>();
    soql_lang::subquery_spans(query)
        .into_iter()
        .map(|(start, end)| SubquerySpanDto {
            start: byte_to_utf16(start),
            end: byte_to_utf16(end),
        })
        .collect()
}

// ---- Query plan (EXPLAIN) ----

/// An optimizer note (e.g. "not selective", "consider an index").
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanNoteDto {
    pub description: String,
    pub fields: Vec<String>,
    pub table_enum_or_id: String,
}

impl From<features::query_plan::PlanNote> for PlanNoteDto {
    fn from(n: features::query_plan::PlanNote) -> Self {
        PlanNoteDto {
            description: n.description,
            fields: n.fields,
            table_enum_or_id: n.table_enum_or_id,
        }
    }
}

/// A single candidate plan. `relative_cost > 1.0` means the optimizer expects a
/// non-selective query.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRowDto {
    pub cardinality: i64,
    pub leading_operation_type: String,
    pub relative_cost: f64,
    pub sobject_cardinality: i64,
    pub sobject_type: String,
    pub fields: Vec<String>,
    pub notes: Vec<PlanNoteDto>,
}

impl From<features::query_plan::PlanRow> for PlanRowDto {
    fn from(r: features::query_plan::PlanRow) -> Self {
        PlanRowDto {
            cardinality: r.cardinality,
            leading_operation_type: r.leading_operation_type,
            relative_cost: r.relative_cost,
            sobject_cardinality: r.sobject_cardinality,
            sobject_type: r.sobject_type,
            fields: r.fields,
            notes: r.notes.into_iter().map(PlanNoteDto::from).collect(),
        }
    }
}

/// The full explain response: one [`PlanRowDto`] per candidate execution plan.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPlanDto {
    pub plans: Vec<PlanRowDto>,
    pub source_query: String,
}

impl From<features::query_plan::QueryPlan> for QueryPlanDto {
    fn from(p: features::query_plan::QueryPlan) -> Self {
        QueryPlanDto {
            plans: p.plans.into_iter().map(PlanRowDto::from).collect(),
            source_query: p.source_query,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn subquery_spans_convert_bytes_to_utf16_offsets() {
        // The '数据' literal is 2 UTF-16 units but 6 bytes; offsets must be UTF-16.
        let query = "SELECT Id FROM A WHERE N = '数据' AND Id IN (SELECT AccountId FROM Contact)";
        let spans = subquery_spans(query);
        assert_eq!(spans.len(), 1);
        let utf16: Vec<u16> = query.encode_utf16().collect();
        let slice = String::from_utf16(&utf16[spans[0].start..spans[0].end]).unwrap();
        assert_eq!(slice, "(SELECT AccountId FROM Contact)");
        // camelCase serialization.
        let v = serde_json::to_value(&spans[0]).unwrap();
        assert!(v.get("start").is_some() && v.get("end").is_some());
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
}
