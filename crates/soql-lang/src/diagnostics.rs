//! Unknown-field + WHERE operator/type diagnostics for SOQL (pure).

use crate::parse::{outline, where_conditions};
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

/// Text-ish field types `LIKE` is valid against.
fn is_text_type(t: &str) -> bool {
    matches!(
        t.to_ascii_lowercase().as_str(),
        "string"
            | "picklist"
            | "multipicklist"
            | "textarea"
            | "email"
            | "phone"
            | "url"
            | "combobox"
            | "reference"
            | "id"
            | "encryptedstring"
    )
}

/// Resolve a (possibly dotted) field path to its `Field`, walking relationships via `resolve`.
/// Returns `None` if any hop or the final field cannot be resolved.
fn resolve_field<'a>(
    schema: &'a SObjectSchema,
    path: &str,
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Option<&'a sf_schema::model::Field> {
    let segs: Vec<&str> = path.split('.').collect();
    let mut cur = schema;
    for seg in &segs[..segs.len() - 1] {
        let rel = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = rel.reference_to.first()?;
        cur = resolve(target)?;
    }
    cur.field(segs[segs.len() - 1])
}

/// Final object a dotted path's relationship segments land on. `None` if unresolved.
fn resolve_object<'a>(
    schema: &'a SObjectSchema,
    segs: &[&str],
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Option<&'a SObjectSchema> {
    let mut cur = schema;
    for seg in segs {
        let rel = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = rel.reference_to.first()?;
        cur = resolve(target)?;
    }
    Some(cur)
}

/// SELECT unknown-field + WHERE operator/type diagnostics.
///
/// Pure: reads `schema` and `resolve` (object name → schema). With `&|_| None`,
/// dotted fields are skipped and no operator checks run (legacy behavior).
pub fn diagnostics<'a>(
    input: &str,
    schema: &'a SObjectSchema,
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Vec<Diagnostic> {
    let o = outline(input);
    if o.from_object.is_none() {
        return Vec::new();
    }
    let mut diags = Vec::new();

    // 1. Unknown SELECT fields (dotted paths resolved through relationships).
    for f in &o.select_fields {
        if f.name == "*" {
            continue;
        }
        if f.name.contains('.') {
            let segs: Vec<&str> = f.name.split('.').collect();
            // Skip when the relationship chain cannot be resolved (no false positive).
            let Some(obj) = resolve_object(schema, &segs[..segs.len() - 1], resolve) else {
                continue;
            };
            if obj.field(segs[segs.len() - 1]).is_none() {
                diags.push(Diagnostic {
                    message: format!("Unknown field '{}' on {}", segs[segs.len() - 1], obj.name),
                    start: f.start,
                    end: f.end,
                    severity: Severity::Error,
                });
            }
        } else if schema.field(&f.name).is_none() {
            diags.push(Diagnostic {
                message: format!("Unknown field '{}' on {}", f.name, schema.name),
                start: f.start,
                end: f.end,
                severity: Severity::Error,
            });
        }
    }

    // 2. WHERE operator vs field type (conservative — only SF-illegal combos).
    for c in where_conditions(input) {
        let Some(field) = resolve_field(schema, &c.field.name, resolve) else {
            continue;
        };
        let t = field.field_type.to_ascii_lowercase();
        let bad = match c.op.as_str() {
            "LIKE" => !is_text_type(&t),
            "<" | ">" | "<=" | ">=" => t == "boolean",
            "INCLUDES" | "EXCLUDES" => t != "multipicklist",
            _ => false,
        };
        if bad {
            diags.push(Diagnostic {
                message: format!(
                    "Operator {} is not valid for {} field '{}'",
                    c.op, t, c.field.name
                ),
                start: c.op_start,
                end: c.op_end,
                severity: Severity::Error,
            });
        }
    }

    diags
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

    fn user_schema() -> SObjectSchema {
        let mut age = field("Age");
        age.field_type = "double".to_string();
        SObjectSchema {
            name: "User".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), field("Email"), age],
            child_relationships: vec![],
        }
    }

    fn account_with_owner() -> SObjectSchema {
        let mut s = account_schema();
        s.fields[3].relationship_name = Some("Owner".to_string()); // OwnerId
        s.fields[3].reference_to = vec!["User".to_string()];
        s
    }

    #[test]
    fn flags_unknown_field() {
        let schema = account_schema();
        let input = "SELECT Id, Bogus FROM Account";
        let diags = diagnostics(input, &schema, &|_| None);
        assert_eq!(diags.len(), 1);
        let d = &diags[0];
        assert_eq!(&input[d.start..d.end], "Bogus");
        assert_eq!(d.severity, Severity::Error);
    }

    #[test]
    fn known_fields_no_diagnostics() {
        let schema = account_schema();
        assert!(diagnostics("SELECT Id, Name FROM Account", &schema, &|_| None).is_empty());
    }

    #[test]
    fn dotted_field_skipped_without_resolver() {
        let schema = account_schema();
        assert!(diagnostics("SELECT Owner.Name FROM Account", &schema, &|_| None).is_empty());
    }

    #[test]
    fn aggregate_function_no_false_diagnostic() {
        let schema = account_schema();
        assert!(diagnostics("SELECT COUNT(Id) FROM Account", &schema, &|_| None).is_empty());
    }

    #[test]
    fn flags_unknown_dotted_field_via_resolver() {
        let schema = account_with_owner();
        let user = user_schema();
        let resolve = |n: &str| (n == "User").then_some(&user);
        let input = "SELECT Owner.Bogus FROM Account";
        let diags = diagnostics(input, &schema, &resolve);
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert!(diags[0].message.contains("Bogus"));
    }

    #[test]
    fn known_dotted_field_clean() {
        let schema = account_with_owner();
        let user = user_schema();
        let resolve = |n: &str| (n == "User").then_some(&user);
        assert!(diagnostics("SELECT Owner.Email FROM Account", &schema, &resolve).is_empty());
    }

    #[test]
    fn flags_like_on_number() {
        let schema = account_with_owner();
        let user = user_schema();
        let resolve = |n: &str| (n == "User").then_some(&user);
        let input = "SELECT Id FROM Account WHERE Owner.Age LIKE 'x'";
        let diags = diagnostics(input, &schema, &resolve);
        assert!(
            diags.iter().any(|d| d.message.contains("LIKE")),
            "{diags:?}"
        );
    }

    #[test]
    fn like_on_string_clean() {
        let schema = account_schema();
        assert!(diagnostics(
            "SELECT Id FROM Account WHERE Name LIKE 'a%'",
            &schema,
            &|_| None
        )
        .is_empty());
    }
}
