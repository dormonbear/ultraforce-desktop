//! Field "where-used" via the Tooling MetadataComponentDependency (beta) API.
//!
//! Org-I/O only: resolve a custom field's `CustomField` Id, then list the
//! metadata components that reference it. Standard fields aren't tracked by the
//! Dependency API, so they short-circuit to [`WhereUsed::Unsupported`] with no
//! query. Task 6 wraps this in a Tauri command with SQLite caching.

use std::sync::atomic::AtomicBool;

use sf_core::{AuthInfo, SfError};

use crate::soql::{run_query_rest, FieldValue, QueryOptions, Record};

/// One metadata component that references the queried field.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldDependency {
    pub component_type: String,
    pub component_name: String,
    pub component_id: String,
}

/// The result of a where-used lookup.
#[derive(Debug, Clone, PartialEq)]
pub enum WhereUsed {
    /// Standard field: not a `CustomField`, so the Dependency API can't see it.
    Unsupported,
    /// Components that reference the field (may be empty).
    Deps(Vec<FieldDependency>),
}

/// The `DeveloperName` of a custom field: the API name minus its `__c`/`__pc`
/// suffix. `None` for a standard field (no custom suffix), which the Dependency
/// API cannot track.
pub fn developer_name(field: &str) -> Option<String> {
    for suffix in ["__pc", "__c"] {
        if let Some(base) = field.strip_suffix(suffix) {
            return Some(base.to_string());
        }
    }
    None
}

/// Escape a value for embedding in a single-quoted SOQL literal by doubling
/// single quotes.
fn escape_soql(input: &str) -> String {
    input.replace('\'', "''")
}

/// Read a record field as a plain string (empty when absent or non-string).
fn field_str(record: &Record, key: &str) -> String {
    record
        .fields
        .iter()
        .find(|(k, _)| k == key)
        .and_then(|(_, v)| match v {
            FieldValue::Scalar(serde_json::Value::String(s)) => Some(s.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

/// Project MetadataComponentDependency records into [`FieldDependency`] rows.
pub fn parse_dependency_records(records: &[Record]) -> Vec<FieldDependency> {
    records
        .iter()
        .map(|r| FieldDependency {
            component_type: field_str(r, "MetadataComponentType"),
            component_name: field_str(r, "MetadataComponentName"),
            component_id: field_str(r, "MetadataComponentId"),
        })
        .collect()
}

/// Fetch the components that reference `object.field`.
///
/// Standard fields (no `__c`/`__pc` suffix) and custom fields with no resolvable
/// `CustomField` row return [`WhereUsed::Unsupported`]. Otherwise runs the beta
/// dependency query, which caps at 2000 rows (accepted without pagination).
pub async fn fetch_field_dependencies(
    auth: &AuthInfo,
    object: &str,
    field: &str,
) -> Result<WhereUsed, SfError> {
    let Some(dev_name) = developer_name(field) else {
        return Ok(WhereUsed::Unsupported);
    };

    let tooling = QueryOptions {
        use_tooling_api: true,
        all_rows: false,
    };
    let noop = |_: u64, _: u64| {};
    let cancel = AtomicBool::new(false);

    // Query A: resolve the CustomField Id for this object + developer name.
    let query_a = format!(
        "SELECT Id FROM CustomField WHERE DeveloperName = '{}' AND EntityDefinition.QualifiedApiName = '{}'",
        escape_soql(&dev_name),
        escape_soql(object),
    );
    let field_result = run_query_rest(auth, &query_a, tooling, &noop, &cancel).await?;
    let Some(first) = field_result.records.first() else {
        return Ok(WhereUsed::Unsupported);
    };
    let field_id = field_str(first, "Id");
    if field_id.is_empty() {
        return Ok(WhereUsed::Unsupported);
    }

    // Query B: components that reference the field (beta, caps at 2000 rows).
    let query_b = format!(
        "SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = '{}'",
        escape_soql(&field_id),
    );
    let dep_result = run_query_rest(auth, &query_b, tooling, &noop, &cancel).await?;
    Ok(WhereUsed::Deps(parse_dependency_records(&dep_result.records)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn developer_name_strips_custom_suffix() {
        assert_eq!(
            developer_name("Invoice_Status__c"),
            Some("Invoice_Status".to_string())
        );
    }

    #[test]
    fn developer_name_strips_person_account_suffix() {
        assert_eq!(developer_name("Loyalty__pc"), Some("Loyalty".to_string()));
    }

    #[test]
    fn developer_name_none_for_standard_field() {
        assert_eq!(developer_name("Name"), None);
    }

    #[test]
    fn escape_soql_doubles_single_quotes() {
        assert_eq!(escape_soql("O'Brien"), "O''Brien");
    }

    #[test]
    fn parse_dependency_records_maps_the_three_fields() {
        let json = r#"[
            {
                "attributes": {"type": "MetadataComponentDependency"},
                "MetadataComponentId": "01pAAA",
                "MetadataComponentName": "AccountTrigger",
                "MetadataComponentType": "ApexTrigger"
            },
            {
                "attributes": {"type": "MetadataComponentDependency"},
                "MetadataComponentId": "01qBBB",
                "MetadataComponentName": "Billing_Flow",
                "MetadataComponentType": "Flow"
            }
        ]"#;
        let records: Vec<Record> = serde_json::from_str(json).unwrap();
        let deps = parse_dependency_records(&records);

        assert_eq!(
            deps,
            vec![
                FieldDependency {
                    component_type: "ApexTrigger".into(),
                    component_name: "AccountTrigger".into(),
                    component_id: "01pAAA".into(),
                },
                FieldDependency {
                    component_type: "Flow".into(),
                    component_name: "Billing_Flow".into(),
                    component_id: "01qBBB".into(),
                },
            ]
        );
    }
}
