//! Serialization contract tests: pin the exact JSON wire shape of the DTOs that
//! cross the IPC boundary — field names must be camelCase and nullable fields
//! must serialize as JSON `null` — so a Rust-side rename can't silently drift
//! from `desktop/src/types.ts`. Cheap insurance until full TS codegen lands.
//!
//! Assertions check that the serialized object's key SET matches the expected
//! camelCase names (extra/renamed/dropped keys all fail), plus null handling.

use super::*;
use serde_json::Value;
use std::collections::BTreeSet;

/// The set of top-level object keys in `v`.
fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object()
        .expect("serialized DTO is a JSON object")
        .keys()
        .cloned()
        .collect()
}

/// Assert `v`'s top-level keys are exactly `expected`.
fn assert_keys(v: &Value, expected: &[&str]) {
    let want: BTreeSet<String> = expected.iter().map(|s| s.to_string()).collect();
    assert_eq!(keys(v), want, "wire keys drifted: {v}");
}

// ---- The four newly-adapted commands (A4) ----

#[test]
fn query_plan_dto_wire_shape() {
    let dto = QueryPlanDto::from(features::query_plan::QueryPlan {
        plans: vec![features::query_plan::PlanRow {
            cardinality: 10,
            leading_operation_type: "Index".into(),
            relative_cost: 0.5,
            sobject_cardinality: 100,
            sobject_type: "Account".into(),
            fields: vec!["Name".into()],
            notes: vec![features::query_plan::PlanNote {
                description: "not selective".into(),
                fields: vec!["Name".into()],
                table_enum_or_id: "Account".into(),
            }],
        }],
        source_query: "SELECT Id FROM Account".into(),
    });
    let v = serde_json::to_value(&dto).unwrap();
    assert_keys(&v, &["plans", "sourceQuery"]);
    assert_keys(
        &v["plans"][0],
        &[
            "cardinality",
            "leadingOperationType",
            "relativeCost",
            "sobjectCardinality",
            "sobjectType",
            "fields",
            "notes",
        ],
    );
    assert_keys(
        &v["plans"][0]["notes"][0],
        &["description", "fields", "tableEnumOrId"],
    );
    assert_eq!(v["sourceQuery"], "SELECT Id FROM Account");
}

#[test]
fn soql_diagnostic_dto_wire_shape() {
    let dto = SoqlDiagnosticDto::from(features::soql::SoqlDiagnostic {
        message: "unknown field".into(),
        start: 7,
        end: 12,
        severity: "error".into(),
    });
    let v = serde_json::to_value(&dto).unwrap();
    assert_keys(&v, &["message", "start", "end", "severity"]);
    assert_eq!(v["severity"], "error");
}

#[test]
fn apex_diagnostic_dto_wire_shape_matches_soql() {
    let dto = ApexDiagnosticDto::from(features::apex_complete::ApexDiagnostic {
        message: "syntax".into(),
        start: 0,
        end: 3,
        severity: "warning".into(),
    });
    let v = serde_json::to_value(&dto).unwrap();
    // Apex + SOQL diagnostics share one wire shape (TS reuses SoqlDiagnosticDto).
    assert_keys(&v, &["message", "start", "end", "severity"]);
}

// ---- Representative DTOs from each domain ----

#[test]
fn org_dto_wire_shape_with_nulls() {
    let dto = OrgDto {
        username: "me@x.com".into(),
        alias: None,
        instance_url: None,
        is_default: false,
    };
    let v = serde_json::to_value(&dto).unwrap();
    assert_keys(&v, &["username", "alias", "instanceUrl", "isDefault"]);
    // Nullable fields serialize as JSON null (not omitted).
    assert_eq!(v["alias"], Value::Null);
    assert_eq!(v["instanceUrl"], Value::Null);
}

#[test]
fn index_status_dto_wire_shape_with_nulls() {
    let dto = IndexStatusDto {
        org: "me@x.com".into(),
        state: "idle".into(),
        phase: None,
        done: None,
        total: None,
        last_indexed: None,
        error: None,
    };
    let v = serde_json::to_value(&dto).unwrap();
    assert_keys(
        &v,
        &["org", "state", "phase", "done", "total", "lastIndexed", "error"],
    );
    assert_eq!(v["lastIndexed"], Value::Null);
}

#[test]
fn schema_field_dto_wire_shape() {
    let dto = SchemaFieldDto {
        name: "Name".into(),
        label: "Name".into(),
        field_type: "string".into(),
        custom: false,
        nillable: true,
        reference_to: vec![],
        relationship_name: None,
        picklist_values: vec![],
        restricted_picklist: false,
        dependent_picklist: false,
        calculated: false,
        calculated_formula: None,
        length: 80,
        unique: false,
        inline_help_text: None,
    };
    let v = serde_json::to_value(&dto).unwrap();
    assert_keys(
        &v,
        &[
            "name",
            "label",
            "fieldType",
            "custom",
            "nillable",
            "referenceTo",
            "relationshipName",
            "picklistValues",
            "restrictedPicklist",
            "dependentPicklist",
            "calculated",
            "calculatedFormula",
            "length",
            "unique",
            "inlineHelpText",
        ],
    );
}

#[test]
fn soql_result_dto_wire_shape() {
    let dto = SoqlResultDto {
        columns: vec!["Id".into()],
        rows: vec![vec!["001".into()]],
        total_size: 1,
        done: true,
        child_tables: vec![],
    };
    let v = serde_json::to_value(&dto).unwrap();
    assert_keys(&v, &["columns", "rows", "totalSize", "done", "childTables"]);
}
