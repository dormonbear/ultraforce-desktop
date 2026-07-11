//! Trimmed serde model of an `sf sobject describe` result.
//!
//! Only the keys we use are declared; serde ignores everything else.

use serde::{Deserialize, Serialize};

/// A single Salesforce object's describe, trimmed to the fields we care about.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct SObjectSchema {
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default, rename = "labelPlural")]
    pub label_plural: String,
    #[serde(default, rename = "keyPrefix")]
    pub key_prefix: Option<String>,
    #[serde(default)]
    pub custom: bool,
    #[serde(default)]
    pub fields: Vec<Field>,
    #[serde(default, rename = "childRelationships")]
    pub child_relationships: Vec<ChildRelationship>,
    /// Record types on this object (identity only — per-RT picklist availability
    /// is Phase 2, needs the UI API).
    #[serde(default, rename = "recordTypeInfos")]
    pub record_type_infos: Vec<RecordTypeInfo>,
}

/// A field on an object.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Field {
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub custom: bool,
    #[serde(default)]
    pub nillable: bool,
    #[serde(default, rename = "referenceTo")]
    pub reference_to: Vec<String>,
    #[serde(default, rename = "relationshipName")]
    pub relationship_name: Option<String>,
    #[serde(default, rename = "picklistValues")]
    pub picklist_values: Vec<PicklistValue>,
    // ---- Tier-1 detail (surfaced via ost_fields; ost_object only tags them) --
    /// Controlling field of a dependent picklist (`None` if independent).
    #[serde(default, rename = "controllerName")]
    pub controller_name: Option<String>,
    #[serde(default, rename = "dependentPicklist")]
    pub dependent_picklist: bool,
    #[serde(default)]
    pub calculated: bool,
    /// Formula body for a formula field (`None` if not calculated).
    #[serde(default, rename = "calculatedFormula")]
    pub calculated_formula: Option<String>,
    #[serde(default, rename = "defaultValueFormula")]
    pub default_value_formula: Option<String>,
    #[serde(default)]
    pub length: i64,
    #[serde(default)]
    pub unique: bool,
    #[serde(default, rename = "restrictedPicklist")]
    pub restricted_picklist: bool,
    #[serde(rename = "inlineHelpText", default)]
    pub inline_help_text: Option<String>,
}

/// One entry in a picklist field.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct PicklistValue {
    #[serde(default)]
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default, rename = "defaultValue")]
    pub default_value: bool,
    /// Base64 dependency bitmap (present only on a dependent picklist's entries);
    /// decoded against the controlling field's active values at query time.
    #[serde(default, rename = "validFor")]
    pub valid_for: Option<String>,
}

/// Record type identity from `recordTypeInfos` in the object describe.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordTypeInfo {
    #[serde(default)]
    pub record_type_id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub developer_name: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub master: bool,
    #[serde(default)]
    pub available: bool,
}

/// A child relationship pointing back to this object.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ChildRelationship {
    #[serde(default, rename = "childSObject")]
    pub child_sobject: String,
    #[serde(default)]
    pub field: String,
    #[serde(default, rename = "relationshipName")]
    pub relationship_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    // The describe envelope: { status, result: SObjectSchema, ... }.
    #[derive(Debug, Deserialize)]
    struct Envelope {
        result: SObjectSchema,
    }

    fn load_account() -> SObjectSchema {
        let raw = include_str!("../tests/fixtures/describe_account.json");
        let env: Envelope = serde_json::from_str(raw).expect("fixture deserializes");
        env.result
    }

    #[test]
    fn deserializes_trimmed_account_schema() {
        let schema = load_account();
        assert_eq!(schema.name, "Account");
        assert_eq!(schema.fields.len(), 5);

        let owner = schema
            .fields
            .iter()
            .find(|f| f.name == "OwnerId")
            .expect("OwnerId field present");
        assert_eq!(owner.reference_to, vec!["User".to_string()]);
        assert_eq!(owner.relationship_name, Some("Owner".to_string()));

        let type_field = schema
            .fields
            .iter()
            .find(|f| f.name == "Type")
            .expect("Type field present");
        assert!(!type_field.picklist_values.is_empty());

        assert_eq!(schema.child_relationships.len(), 2);
    }

    #[test]
    fn deserializes_inline_help_text() {
        let schema = load_account();
        let name = schema.field("Name").expect("Name field present");
        assert_eq!(name.inline_help_text, Some("Account name help".to_string()));
    }
}
