//! Read-only lookups over a loaded [`SObjectSchema`].

use crate::model::{ChildRelationship, Field, PicklistValue, SObjectSchema};

impl SObjectSchema {
    /// Find a field by name, case-insensitively.
    pub fn field(&self, name: &str) -> Option<&Field> {
        self.fields
            .iter()
            .find(|f| f.name.eq_ignore_ascii_case(name))
    }

    /// Picklist values for a field; empty if the field is missing or not a picklist.
    pub fn picklist_values(&self, field: &str) -> &[PicklistValue] {
        match self.field(field) {
            Some(f) => &f.picklist_values,
            None => &[],
        }
    }

    /// Find a child relationship by `relationship_name`, case-insensitively.
    pub fn child_relationship(&self, name: &str) -> Option<&ChildRelationship> {
        self.child_relationships.iter().find(|c| {
            c.relationship_name
                .as_deref()
                .is_some_and(|rn| rn.eq_ignore_ascii_case(name))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct Envelope {
        result: SObjectSchema,
    }

    fn account() -> SObjectSchema {
        let raw = include_str!("../tests/fixtures/describe_account.json");
        serde_json::from_str::<Envelope>(raw).unwrap().result
    }

    #[test]
    fn field_lookup_is_case_insensitive() {
        let a = account();
        assert!(a.field("ownerid").is_some());
        assert!(a.field("nope").is_none());
    }

    #[test]
    fn picklist_values_present_only_for_picklist_fields() {
        let a = account();
        assert!(!a.picklist_values("Type").is_empty());
        assert!(a.picklist_values("Name").is_empty());
        assert!(a.picklist_values("nope").is_empty());
    }

    #[test]
    fn child_relationship_resolves_by_name() {
        let a = account();
        let rel = a.child_relationship("contacts").expect("Contacts present");
        assert_eq!(rel.child_sobject, "Contact");
    }
}
