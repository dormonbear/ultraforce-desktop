//! SOQL execution slice: run a query → typed [`QueryResult`] → flat [`TableModel`].

use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use sf_core::{SfError, SfInvoker};
use std::fmt;

/// A parsed SOQL query response.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub total_size: u64,
    pub done: bool,
    pub records: Vec<Record>,
}

/// A single SOQL record. Field order mirrors the query (preserved via a custom
/// `Deserialize` that walks the JSON map in source order).
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub sobject_type: String,
    pub fields: Vec<(String, FieldValue)>,
}

/// The value of a single field within a [`Record`].
#[derive(Debug, Clone, PartialEq)]
pub enum FieldValue {
    Null,
    Scalar(serde_json::Value),
    Parent(Box<Record>),
    Children(QueryResult),
}

/// A flat, table-shaped projection of a [`QueryResult`].
#[derive(Debug, Clone, PartialEq)]
pub struct TableModel {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl<'de> Deserialize<'de> for Record {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RecordVisitor;

        impl<'de> Visitor<'de> for RecordVisitor {
            type Value = Record;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a SOQL record object")
            }

            fn visit_map<M>(self, mut map: M) -> Result<Record, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut sobject_type = String::new();
                let mut fields: Vec<(String, FieldValue)> = Vec::new();

                while let Some((key, value)) = map.next_entry::<String, serde_json::Value>()? {
                    if key == "attributes" {
                        sobject_type = value
                            .get("type")
                            .and_then(|t| t.as_str())
                            .ok_or_else(|| de::Error::custom("record attributes missing `type`"))?
                            .to_string();
                    } else {
                        fields.push((key, classify::<M::Error>(value)?));
                    }
                }

                Ok(Record {
                    sobject_type,
                    fields,
                })
            }
        }

        deserializer.deserialize_map(RecordVisitor)
    }
}

/// Classify a raw JSON value into a [`FieldValue`].
///
// ponytail: a Parent's *nested* field order falls back to serde_json's default
// (sorted) since the value goes through Value; top-level/query order is
// preserved. Upgrade to preserve_order when SP-E needs deep nested order.
fn classify<E>(v: serde_json::Value) -> Result<FieldValue, E>
where
    E: de::Error,
{
    match v {
        serde_json::Value::Null => Ok(FieldValue::Null),
        serde_json::Value::Object(ref map) if map.contains_key("records") => {
            let qr = serde_json::from_value::<QueryResult>(v).map_err(de::Error::custom)?;
            Ok(FieldValue::Children(qr))
        }
        serde_json::Value::Object(ref map) if map.contains_key("attributes") => {
            let rec = serde_json::from_value::<Record>(v).map_err(de::Error::custom)?;
            Ok(FieldValue::Parent(Box::new(rec)))
        }
        other => Ok(FieldValue::Scalar(other)),
    }
}

impl QueryResult {
    /// Parse the `result` object of an `sf data query --json` envelope from its
    /// raw JSON text.
    ///
    /// Takes `&str` rather than `&serde_json::Value` on purpose: deserializing
    /// from a string drives the custom [`Record`] visitor in source order,
    /// whereas `serde_json::Value` is a sorted map (no `preserve_order`) and
    /// would lose the query's top-level field order.
    pub fn from_json(result: &str) -> Result<QueryResult, serde_json::Error> {
        serde_json::from_str(result)
    }

    /// Project records into a flat [`TableModel`].
    ///
    /// Columns are the union of leaf paths across all records in first-seen
    /// order. Parents expand to dotted leaves; subqueries become a single
    /// column rendered as the child `total_size`.
    pub fn to_table(&self) -> TableModel {
        // A field that is a `Parent` in *any* record expands to dotted leaves;
        // when the same field is `Null` in another record it must not also emit
        // a bare column. Collect those parent paths up front.
        let mut parent_paths: Vec<String> = Vec::new();
        for record in &self.records {
            collect_parent_paths(&record.fields, "", &mut parent_paths);
        }

        let mut columns: Vec<String> = Vec::new();
        for record in &self.records {
            collect_columns(&record.fields, "", &parent_paths, &mut columns);
        }

        let rows = self
            .records
            .iter()
            .map(|record| columns.iter().map(|col| render_cell(record, col)).collect())
            .collect();

        TableModel { columns, rows }
    }
}

/// Record every field path that appears as a `Parent` in any record.
fn collect_parent_paths(
    fields: &[(String, FieldValue)],
    prefix: &str,
    parent_paths: &mut Vec<String>,
) {
    for (name, value) in fields {
        if let FieldValue::Parent(child) = value {
            let path = format!("{prefix}{name}");
            if !parent_paths.contains(&path) {
                parent_paths.push(path.clone());
            }
            collect_parent_paths(&child.fields, &format!("{path}."), parent_paths);
        }
    }
}

/// Walk fields in order, accumulating leaf column paths (first-seen wins).
fn collect_columns(
    fields: &[(String, FieldValue)],
    prefix: &str,
    parent_paths: &[String],
    columns: &mut Vec<String>,
) {
    for (name, value) in fields {
        let path = format!("{prefix}{name}");
        match value {
            FieldValue::Parent(child) => {
                collect_columns(&child.fields, &format!("{path}."), parent_paths, columns);
            }
            // A null/scalar whose path is a parent elsewhere is covered by the
            // parent's dotted leaves; skip the bare column.
            _ if parent_paths.contains(&path) => {}
            _ => {
                if !columns.contains(&path) {
                    columns.push(path);
                }
            }
        }
    }
}

/// Render a single cell of `record` for the given (possibly dotted) `column`.
fn render_cell(record: &Record, column: &str) -> String {
    let mut parts = column.split('.');
    let head = parts.next().expect("column path is non-empty");
    let Some((_, value)) = record.fields.iter().find(|(k, _)| k == head) else {
        return String::new();
    };

    match value {
        FieldValue::Null => String::new(),
        FieldValue::Scalar(v) => scalar_text(v),
        FieldValue::Children(qr) => qr.total_size.to_string(),
        FieldValue::Parent(child) => {
            let rest = parts.collect::<Vec<_>>().join(".");
            render_cell(child, &rest)
        }
    }
}

/// Render a scalar JSON value as plain text (strings unquoted).
fn scalar_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Execute a SOQL query and return the typed [`QueryResult`].
pub async fn run_query(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
) -> Result<QueryResult, SfError> {
    let mut args = vec!["data", "query", "-q", soql];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    invoker.run_json::<QueryResult>(&args).await
}

/// Execute a SOQL query and project it into a flat [`TableModel`].
pub async fn run_query_table(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
) -> Result<TableModel, SfError> {
    let result = run_query(invoker, soql, target_org).await?;
    Ok(result.to_table())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use sf_core::RawOutput;
    use std::sync::{Arc, Mutex};

    const FIXTURE: &str = include_str!("../tests/fixtures/query_accounts.json");

    /// Extract the raw `result` JSON text from the envelope, preserving field
    /// order (via `RawValue`) so the custom `Record` visitor sees source order.
    fn fixture_result() -> String {
        #[derive(serde::Deserialize)]
        struct Env<'a> {
            #[serde(borrow)]
            result: &'a serde_json::value::RawValue,
        }
        let env: Env = serde_json::from_str(FIXTURE).unwrap();
        env.result.get().to_string()
    }

    #[test]
    fn parses_preserving_query_field_order() {
        let qr = QueryResult::from_json(&fixture_result()).unwrap();

        assert_eq!(qr.total_size, 2);
        assert!(qr.done);
        assert_eq!(qr.records.len(), 2);

        let r0 = &qr.records[0];
        assert_eq!(r0.sobject_type, "Account");
        let keys: Vec<&str> = r0.fields.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["Id", "Name", "Owner", "Contacts"]);

        let owner = &r0.fields.iter().find(|(k, _)| k == "Owner").unwrap().1;
        match owner {
            FieldValue::Parent(parent) => {
                let name = &parent.fields.iter().find(|(k, _)| k == "Name").unwrap().1;
                assert_eq!(*name, FieldValue::Scalar(serde_json::json!("Alice")));
            }
            other => panic!("expected Parent, got {other:?}"),
        }

        let contacts = &r0.fields.iter().find(|(k, _)| k == "Contacts").unwrap().1;
        match contacts {
            FieldValue::Children(child) => assert_eq!(child.total_size, 1),
            other => panic!("expected Children, got {other:?}"),
        }

        let r1 = &qr.records[1];
        assert_eq!(
            r1.fields.iter().find(|(k, _)| k == "Owner").unwrap().1,
            FieldValue::Null
        );
        assert_eq!(
            r1.fields.iter().find(|(k, _)| k == "Contacts").unwrap().1,
            FieldValue::Null
        );
    }

    #[test]
    fn projects_flat_table() {
        let qr = QueryResult::from_json(&fixture_result()).unwrap();
        let table = qr.to_table();

        assert_eq!(table.columns, ["Id", "Name", "Owner.Name", "Contacts"]);
        assert_eq!(
            table.rows,
            vec![
                vec!["001A", "Acme", "Alice", "1"],
                vec!["001B", "Globex", "", ""],
            ]
        );
    }

    #[tokio::test]
    async fn run_query_passes_args_and_parses() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            *seen2.lock().unwrap() = args.to_vec();
            Ok(RawOutput {
                status: 0,
                stdout: FIXTURE.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let soql = "SELECT Id, Name, Owner.Name, (SELECT LastName FROM Contacts) FROM Account";
        let qr = run_query(&invoker, soql, None).await.unwrap();

        let args = seen.lock().unwrap().clone();
        assert_eq!(args, vec!["data", "query", "-q", soql, "--json"]);

        assert_eq!(qr.total_size, 2);
        assert_eq!(qr.records[0].sobject_type, "Account");
    }

    #[tokio::test]
    async fn run_query_table_projects_columns() {
        let runner = MockRunner::ok_json(FIXTURE);
        let invoker = SfInvoker::new(Arc::new(runner));

        let table = run_query_table(&invoker, "SELECT Id FROM Account", None)
            .await
            .unwrap();
        assert_eq!(table.columns, ["Id", "Name", "Owner.Name", "Contacts"]);
    }

    #[tokio::test]
    async fn run_query_appends_target_org_when_set() {
        use std::sync::{Arc, Mutex};
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_query(&invoker, "SELECT Id FROM Account", Some("me@x.com"))
            .await
            .unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(
            args.windows(2).any(|w| w == ["--target-org", "me@x.com"]),
            "got: {args:?}"
        );
    }
}
