//! Unknown-field + WHERE operator/type diagnostics for SOQL (pure).

use crate::parse::{outline, subquery_groups, where_conditions};
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
    if segs.len() < 2 {
        return schema.field(segs[0]);
    }
    let mut cur = schema;
    // Intermediate relationships use the first target.
    for seg in &segs[..segs.len() - 2] {
        let rel = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = rel.reference_to.first()?;
        cur = resolve(target)?;
    }
    // Last relationship: the field is known if it exists on ANY target (polymorphic).
    let last_rel = segs[segs.len() - 2];
    let field_name = segs[segs.len() - 1];
    let rel = cur.fields.iter().find(|f| {
        f.relationship_name
            .as_deref()
            .is_some_and(|r| r.eq_ignore_ascii_case(last_rel))
    })?;
    rel.reference_to
        .iter()
        .filter_map(|t| resolve(t))
        .find_map(|s| s.field(field_name))
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
            // Existence check is polymorphic-aware (field may live on any target);
            // `obj` is only used for the message's object name (first target).
            if resolve_field(schema, &f.name, resolve).is_none() {
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

    // 3. Child-subquery SELECT fields validated against the child sObject.
    for (body_start, inner) in subquery_groups(input) {
        let sub = outline(&inner);
        let Some(rel) = sub.from_object else {
            continue;
        };
        let Some(child) = schema
            .child_relationships
            .iter()
            .find(|c| {
                c.relationship_name
                    .as_deref()
                    .is_some_and(|r| r.eq_ignore_ascii_case(&rel))
            })
            .and_then(|c| resolve(&c.child_sobject))
        else {
            continue;
        };
        for f in &sub.select_fields {
            if f.name == "*" || f.name.contains('.') {
                continue;
            }
            if child.field(&f.name).is_none() {
                diags.push(Diagnostic {
                    message: format!("Unknown field '{}' on {}", f.name, child.name),
                    start: body_start + f.start,
                    end: body_start + f.end,
                    severity: Severity::Error,
                });
            }
        }
    }

    diags
}

/// Aggregate functions whose presence makes a row-limiting `LIMIT` unnecessary.
fn is_aggregate_fn(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "COUNT" | "COUNT_DISTINCT" | "SUM" | "AVG" | "MIN" | "MAX"
    )
}

/// Warn when a query has a FROM object but no `LIMIT` clause and is not an
/// aggregate / GROUP BY query — an unbounded result set risks governor limits.
///
/// Schema-free (token-only), so it fires even when the org/describe is
/// unavailable. Conservative: a `LIMIT` anywhere (including in a subquery)
/// suppresses the warning rather than risk a false positive.
pub fn missing_limit(input: &str) -> Option<Diagnostic> {
    use crate::lexer::TokenKind;

    let tokens = crate::lexer::lex(input);
    let non_ws: Vec<&crate::lexer::Token> = tokens
        .iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();

    let mut from_obj_span: Option<(usize, usize)> = None;
    let mut has_limit = false;
    let mut has_aggregate = false;
    let mut expect_from = false;
    let mut depth: i32 = 0;

    for (i, t) in non_ws.iter().enumerate() {
        match t.kind {
            TokenKind::LParen => depth += 1,
            TokenKind::RParen => depth -= 1,
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("LIMIT") => has_limit = true,
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("GROUP") => has_aggregate = true,
            // Only the outer (depth-0) FROM object anchors the warning span.
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("FROM") && depth == 0 => {
                expect_from = true
            }
            TokenKind::Ident if expect_from => {
                from_obj_span = Some((t.start, t.end));
                expect_from = false;
            }
            TokenKind::Ident
                if is_aggregate_fn(&t.text)
                    && non_ws.get(i + 1).map(|n| n.kind) == Some(TokenKind::LParen) =>
            {
                has_aggregate = true;
            }
            _ => {}
        }
    }

    let (start, end) = from_obj_span?;
    if has_limit || has_aggregate {
        return None;
    }
    Some(Diagnostic {
        message:
            "Query has no LIMIT clause and may return a large result set. Add a LIMIT to bound it."
                .to_string(),
        start,
        end,
        severity: Severity::Warning,
    })
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

    fn account_with_contacts() -> SObjectSchema {
        let mut a = account_schema();
        a.child_relationships = vec![sf_schema::model::ChildRelationship {
            child_sobject: "Contact".to_string(),
            field: "AccountId".to_string(),
            relationship_name: Some("Contacts".to_string()),
        }];
        a
    }

    fn contact_schema() -> SObjectSchema {
        SObjectSchema {
            name: "Contact".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), field("LastName")],
            child_relationships: vec![],
        }
    }

    #[test]
    fn flags_unknown_subquery_field() {
        let schema = account_with_contacts();
        let contact = contact_schema();
        let resolve = |n: &str| (n == "Contact").then_some(&contact);
        let input = "SELECT Id, (SELECT Bogus FROM Contacts) FROM Account";
        let diags = diagnostics(input, &schema, &resolve);
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert_eq!(&input[diags[0].start..diags[0].end], "Bogus");
    }

    #[test]
    fn known_subquery_field_clean() {
        let schema = account_with_contacts();
        let contact = contact_schema();
        let resolve = |n: &str| (n == "Contact").then_some(&contact);
        let input = "SELECT Id, (SELECT LastName FROM Contacts) FROM Account";
        assert!(
            diagnostics(input, &schema, &resolve).is_empty(),
            "should be clean"
        );
    }

    #[test]
    fn no_false_positive_on_subquery_without_resolver() {
        let schema = account_with_contacts();
        let input = "SELECT Id, (SELECT LastName FROM Contacts) FROM Account";
        assert!(diagnostics(input, &schema, &|_| None).is_empty());
    }

    fn account_with_who() -> SObjectSchema {
        let mut a = account_schema();
        let mut who = field("WhoId");
        who.relationship_name = Some("Who".to_string());
        who.reference_to = vec!["Contact".to_string(), "Lead".to_string()];
        a.fields.push(who);
        a
    }

    fn lead_schema() -> SObjectSchema {
        let mut company = field("Company");
        company.field_type = "string".to_string();
        SObjectSchema {
            name: "Lead".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), company],
            child_relationships: vec![],
        }
    }

    #[test]
    fn polymorphic_field_on_second_target_not_flagged() {
        // `Company` exists only on Lead, the second target of Who.
        let schema = account_with_who();
        let contact = contact_schema(); // Id, LastName (no Company)
        let lead = lead_schema(); // Id, Company
        let resolve = |n: &str| match n {
            "Contact" => Some(&contact),
            "Lead" => Some(&lead),
            _ => None,
        };
        assert!(diagnostics("SELECT Who.Company FROM Account", &schema, &resolve).is_empty());
    }

    #[test]
    fn polymorphic_field_on_no_target_flagged() {
        let schema = account_with_who();
        let contact = contact_schema();
        let lead = lead_schema();
        let resolve = |n: &str| match n {
            "Contact" => Some(&contact),
            "Lead" => Some(&lead),
            _ => None,
        };
        let diags = diagnostics("SELECT Who.Nope FROM Account", &schema, &resolve);
        assert_eq!(diags.len(), 1, "{diags:?}");
    }

    #[test]
    fn missing_limit_warns_on_unbounded_query() {
        let d = missing_limit("SELECT Id, Name FROM Account").expect("should warn");
        assert_eq!(d.severity, Severity::Warning);
        // Span points at the FROM object.
        assert_eq!(&"SELECT Id, Name FROM Account"[d.start..d.end], "Account");
    }

    #[test]
    fn missing_limit_silent_when_limit_present() {
        assert!(missing_limit("SELECT Id FROM Account LIMIT 100").is_none());
        assert!(missing_limit("SELECT Id FROM Account limit 5").is_none());
    }

    #[test]
    fn missing_limit_silent_for_aggregates_and_group_by() {
        assert!(missing_limit("SELECT COUNT() FROM Account").is_none());
        assert!(missing_limit("SELECT MAX(CreatedDate) FROM Account").is_none());
        assert!(
            missing_limit("SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry").is_none()
        );
    }

    #[test]
    fn missing_limit_silent_without_from() {
        assert!(missing_limit("SELECT Id").is_none());
        assert!(missing_limit("").is_none());
    }

    #[test]
    fn missing_limit_targets_outer_object_with_subquery() {
        // First FROM (outer) object is the span; subquery LIMIT suppresses the warning.
        assert!(
            missing_limit("SELECT Id, (SELECT Id FROM Contacts LIMIT 5) FROM Account").is_none()
        );
        let d = missing_limit("SELECT Id, (SELECT Id FROM Contacts) FROM Account").expect("warn");
        assert_eq!(
            &"SELECT Id, (SELECT Id FROM Contacts) FROM Account"[d.start..d.end],
            "Account",
            "span is the outer (depth-0) FROM object"
        );
    }
}
