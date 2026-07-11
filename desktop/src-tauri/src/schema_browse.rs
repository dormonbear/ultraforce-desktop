//! Schema-browser orchestration: object list + detail + FTS search over the
//! per-org schema index. `lib.rs` holds only the thin command shells that
//! delegate here.

use sf_schema::model::{ChildRelationship, Field, PicklistValue, SObjectSchema};
use sf_schema::{sqlite, SchemaStore};

use crate::dto::{
    SchemaChildRelationshipDto, SchemaFieldDto, SchemaObjectDetailDto, SchemaObjectDto,
    SchemaPicklistValueDto, SchemaRecordTypeDto, SchemaSearchHitDto,
};
use crate::error::CommandError;
use crate::state::AppState;

/// The index db is missing or stale (table absent) — tell the user to index.
fn no_index_err(org: &str) -> CommandError {
    CommandError::new(
        "no-index",
        format!("No schema index for org “{org}”. Index this org first."),
    )
}

fn picklist_dto(p: &PicklistValue) -> SchemaPicklistValueDto {
    SchemaPicklistValueDto {
        label: p.label.clone(),
        value: p.value.clone(),
        active: p.active,
        default_value: p.default_value,
    }
}

fn field_dto(f: &Field) -> SchemaFieldDto {
    SchemaFieldDto {
        name: f.name.clone(),
        label: f.label.clone(),
        field_type: f.field_type.clone(),
        custom: f.custom,
        nillable: f.nillable,
        reference_to: f.reference_to.clone(),
        relationship_name: f.relationship_name.clone(),
        picklist_values: f.picklist_values.iter().map(picklist_dto).collect(),
        restricted_picklist: f.restricted_picklist,
        dependent_picklist: f.dependent_picklist,
        calculated: f.calculated,
        calculated_formula: f.calculated_formula.clone(),
        length: f.length,
        unique: f.unique,
        inline_help_text: f.inline_help_text.clone(),
    }
}

fn child_dto(c: &ChildRelationship) -> SchemaChildRelationshipDto {
    SchemaChildRelationshipDto {
        child_s_object: c.child_sobject.clone(),
        relationship_name: c.relationship_name.clone(),
        field: c.field.clone(),
    }
}

/// Pure mapping: trimmed describe model → serde camelCase detail DTO.
pub fn object_detail_dto(s: &SObjectSchema) -> SchemaObjectDetailDto {
    SchemaObjectDetailDto {
        name: s.name.clone(),
        label: s.label.clone(),
        key_prefix: s.key_prefix.clone(),
        custom: s.custom,
        fields: s.fields.iter().map(field_dto).collect(),
        child_relationships: s.child_relationships.iter().map(child_dto).collect(),
        record_types: s
            .record_type_infos
            .iter()
            .map(|r| SchemaRecordTypeDto {
                name: r.name.clone(),
                developer_name: r.developer_name.clone(),
                active: r.active,
                master: r.master,
                available: r.available,
            })
            .collect(),
    }
}

/// Read the `objects` table for the browse list. Missing/stale index → `no-index`.
pub fn list_objects(org: &str, _state: &AppState) -> Result<Vec<SchemaObjectDto>, CommandError> {
    let path = sqlite::db_path(&SchemaStore::default_root(), org);
    if !path.exists() {
        return Err(no_index_err(org));
    }
    let conn = sqlite::open_readonly(&path).map_err(|_| no_index_err(org))?;
    let rows = sqlite::list_objects(&conn).map_err(|_| no_index_err(org))?;
    Ok(rows
        .into_iter()
        .map(|(name, label, custom, key_prefix)| SchemaObjectDto {
            name,
            label,
            custom,
            key_prefix,
        })
        .collect())
}

/// Full detail for one object via the schema store (fetches on cache miss).
pub async fn object_detail(
    org: String,
    object: String,
    state: &AppState,
) -> Result<SchemaObjectDetailDto, CommandError> {
    let api = features::api_version::api_version_for(&state.invoker, &org).await;
    let mut store = SchemaStore::new(SchemaStore::default_root(), &org);
    let schema = store.get_or_fetch(&state.invoker, &api, &object).await?;
    Ok(object_detail_dto(&schema))
}

/// FTS search over the schema index. Missing/stale index → `no-index`.
pub fn search(
    org: &str,
    query: &str,
    limit: Option<u32>,
    _state: &AppState,
) -> Result<Vec<SchemaSearchHitDto>, CommandError> {
    let path = sqlite::db_path(&SchemaStore::default_root(), org);
    if !path.exists() {
        return Err(no_index_err(org));
    }
    let conn = sqlite::open_readonly(&path).map_err(|_| no_index_err(org))?;
    let hits = sqlite::search_schema(&conn, query, limit.unwrap_or(30) as usize)
        .map_err(|_| no_index_err(org))?;
    Ok(hits
        .into_iter()
        .map(|h| SchemaSearchHitDto {
            object_name: h.object_name,
            field_name: h.field_name,
            field_label: h.field_label,
            snippet: h.snippet,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_schema::model::RecordTypeInfo;

    #[test]
    fn object_detail_dto_serializes_camel_case() {
        let schema = SObjectSchema {
            name: "Account".into(),
            label: "Account".into(),
            key_prefix: Some("001".into()),
            custom: false,
            fields: vec![Field {
                name: "Type".into(),
                label: "Account Type".into(),
                field_type: "picklist".into(),
                inline_help_text: Some("The account type".into()),
                picklist_values: vec![PicklistValue {
                    label: "Customer".into(),
                    value: "Customer".into(),
                    active: true,
                    default_value: false,
                    valid_for: None,
                }],
                ..Default::default()
            }],
            child_relationships: vec![ChildRelationship {
                child_sobject: "Contact".into(),
                field: "AccountId".into(),
                relationship_name: Some("Contacts".into()),
            }],
            record_type_infos: vec![RecordTypeInfo {
                name: "Master".into(),
                developer_name: "Master".into(),
                active: true,
                master: true,
                available: true,
                record_type_id: None,
            }],
            ..Default::default()
        };

        let json = serde_json::to_value(object_detail_dto(&schema)).unwrap();
        assert_eq!(json["keyPrefix"], "001");
        assert_eq!(json["fields"][0]["fieldType"], "picklist");
        assert_eq!(json["fields"][0]["inlineHelpText"], "The account type");
        assert_eq!(json["fields"][0]["picklistValues"][0]["defaultValue"], false);
        assert_eq!(json["childRelationships"][0]["childSObject"], "Contact");
        assert_eq!(json["recordTypes"][0]["developerName"], "Master");
    }
}
