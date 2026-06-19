//! Unknown-field diagnostics for SOQL SELECT lists (pure).

use crate::parse::outline;
use sf_schema::SObjectSchema;

/// Diagnostic severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

/// A single diagnostic with a byte span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub message: String,
    pub start: usize,
    pub end: usize,
    pub severity: Severity,
}

/// Flag SELECT fields that are unknown on `schema`.
///
/// Pure: reads only `schema`. Returns `[]` when there is no FROM object.
/// Dotted fields and `*` are skipped (relationship resolution is out of scope).
pub fn diagnostics(input: &str, schema: &SObjectSchema) -> Vec<Diagnostic> {
    let o = outline(input);
    if o.from_object.is_none() {
        return Vec::new();
    }

    o.select_fields
        .iter()
        .filter(|f| f.name != "*" && !f.name.contains('.') && schema.field(&f.name).is_none())
        .map(|f| Diagnostic {
            message: format!("Unknown field '{}' on {}", f.name, schema.name),
            start: f.start,
            end: f.end,
            severity: Severity::Error,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_schema::model::{Field, SObjectSchema};

    fn field(name: &str) -> Field {
        Field {
            name: name.to_string(),
            label: String::new(),
            field_type: "string".to_string(),
            custom: false,
            nillable: false,
            reference_to: vec![],
            relationship_name: None,
            picklist_values: vec![],
        }
    }

    fn account_schema() -> SObjectSchema {
        SObjectSchema {
            name: "Account".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![
                field("Id"),
                field("Name"),
                field("Industry"),
                field("OwnerId"),
            ],
            child_relationships: vec![],
        }
    }

    #[test]
    fn flags_unknown_field() {
        let schema = account_schema();
        let input = "SELECT Id, Bogus FROM Account";
        let diags = diagnostics(input, &schema);
        assert_eq!(diags.len(), 1);
        let d = &diags[0];
        assert_eq!(&input[d.start..d.end], "Bogus");
        assert_eq!(d.severity, Severity::Error);
    }

    #[test]
    fn known_fields_no_diagnostics() {
        let schema = account_schema();
        assert!(diagnostics("SELECT Id, Name FROM Account", &schema).is_empty());
    }

    #[test]
    fn dotted_field_skipped() {
        let schema = account_schema();
        assert!(diagnostics("SELECT Owner.Name FROM Account", &schema).is_empty());
    }

    #[test]
    fn aggregate_function_no_false_diagnostic() {
        let schema = account_schema();
        assert!(diagnostics("SELECT COUNT(Id) FROM Account", &schema).is_empty());
    }
}
