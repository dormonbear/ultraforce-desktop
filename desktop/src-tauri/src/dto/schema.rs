//! Schema-browser DTOs (objects, fields, record types, child relationships,
//! search hits, and field where-used). The `From` mappers live in
//! `schema_browse.rs`; these are the pure serde shapes.

/// One object in the schema-browser list.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectDto {
    pub name: String,
    pub label: String,
    pub custom: bool,
    pub key_prefix: Option<String>,
}

/// One picklist entry on a schema field.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPicklistValueDto {
    pub label: String,
    pub value: String,
    pub active: bool,
    pub default_value: bool,
}

/// A single field in an object's schema detail.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaFieldDto {
    pub name: String,
    pub label: String,
    pub field_type: String,
    pub custom: bool,
    pub nillable: bool,
    pub reference_to: Vec<String>,
    pub relationship_name: Option<String>,
    pub picklist_values: Vec<SchemaPicklistValueDto>,
    pub restricted_picklist: bool,
    pub dependent_picklist: bool,
    pub calculated: bool,
    pub calculated_formula: Option<String>,
    pub length: i64,
    pub unique: bool,
    pub inline_help_text: Option<String>,
}

/// A record type's identity in an object's schema detail.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRecordTypeDto {
    pub name: String,
    pub developer_name: String,
    pub active: bool,
    pub master: bool,
    pub available: bool,
}

/// A child relationship pointing back to the object.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChildRelationshipDto {
    pub child_s_object: String,
    pub relationship_name: Option<String>,
    pub field: String,
}

/// Full schema detail for one object.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectDetailDto {
    pub name: String,
    pub label: String,
    pub key_prefix: Option<String>,
    pub custom: bool,
    pub fields: Vec<SchemaFieldDto>,
    pub child_relationships: Vec<SchemaChildRelationshipDto>,
    pub record_types: Vec<SchemaRecordTypeDto>,
}

/// One hit from the schema search palette.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSearchHitDto {
    pub object_name: String,
    pub field_name: String,
    pub field_label: String,
    pub snippet: String,
}

/// One metadata component that references a field ("where-used" row).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDependencyDto {
    pub component_type: String,
    pub component_name: String,
    pub component_id: String,
}

/// A field's where-used result: the referencing components plus when the cache
/// was populated. `supported == false` (with `fetched_at == None`) marks a
/// standard field the Dependency API can't track — never cached.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDependenciesDto {
    pub supported: bool,
    pub items: Vec<FieldDependencyDto>,
    pub fetched_at: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_dependencies_dto_serializes_camel_case() {
        let dto = FieldDependenciesDto {
            supported: true,
            items: vec![FieldDependencyDto {
                component_type: "ApexClass".into(),
                component_name: "AccountService".into(),
                component_id: "01pAAA".into(),
            }],
            fetched_at: Some(1_700_000_000_000),
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["fetchedAt"], 1_700_000_000_000i64);
        assert_eq!(json["items"][0]["componentType"], "ApexClass");
        assert_eq!(json["items"][0]["componentName"], "AccountService");
        assert_eq!(json["items"][0]["componentId"], "01pAAA");
    }

    #[test]
    fn field_dependencies_dto_unsupported_has_null_fetched_at() {
        let dto = FieldDependenciesDto {
            supported: false,
            items: vec![],
            fetched_at: None,
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["supported"], false);
        assert_eq!(json["fetchedAt"], serde_json::Value::Null);
    }
}
