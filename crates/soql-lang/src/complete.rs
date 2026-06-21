//! Cursor-aware clause detection and SOQL completion (pure).

use crate::parse::{outline, SoqlOutline};
use sf_schema::SObjectSchema;

const SOQL_FUNCTIONS: &[&str] = &[
    "AVG",
    "COUNT",
    "COUNT_DISTINCT",
    "MAX",
    "MIN",
    "SUM",
    "CALENDAR_MONTH",
    "CALENDAR_QUARTER",
    "CALENDAR_YEAR",
    "DAY_IN_MONTH",
    "DAY_IN_WEEK",
    "DAY_IN_YEAR",
    "DAY_ONLY",
    "FISCAL_MONTH",
    "FISCAL_QUARTER",
    "FISCAL_YEAR",
    "HOUR_IN_DAY",
    "WEEK_IN_MONTH",
    "WEEK_IN_YEAR",
    "CONVERTCURRENCY",
    "CONVERTTIMEZONE",
    "DISTANCE",
    "FORMAT",
    "GROUPING",
    "TOLABEL",
    "FIELDS",
];

/// SOQL date-literal constants, valid as WHERE/HAVING values against date fields
/// (e.g. `WHERE CreatedDate = LAST_N_DAYS:7`). The `:`-suffixed ones take an
/// integer argument the user types after the colon.
const SOQL_DATE_LITERALS: &[&str] = &[
    "YESTERDAY",
    "TODAY",
    "TOMORROW",
    "LAST_WEEK",
    "THIS_WEEK",
    "NEXT_WEEK",
    "LAST_MONTH",
    "THIS_MONTH",
    "NEXT_MONTH",
    "LAST_90_DAYS",
    "NEXT_90_DAYS",
    "THIS_QUARTER",
    "LAST_QUARTER",
    "NEXT_QUARTER",
    "THIS_YEAR",
    "LAST_YEAR",
    "NEXT_YEAR",
    "THIS_FISCAL_QUARTER",
    "LAST_FISCAL_QUARTER",
    "NEXT_FISCAL_QUARTER",
    "THIS_FISCAL_YEAR",
    "LAST_FISCAL_YEAR",
    "NEXT_FISCAL_YEAR",
    "LAST_N_DAYS:",
    "NEXT_N_DAYS:",
    "N_DAYS_AGO:",
    "LAST_N_WEEKS:",
    "NEXT_N_WEEKS:",
    "LAST_N_MONTHS:",
    "NEXT_N_MONTHS:",
    "LAST_N_QUARTERS:",
    "NEXT_N_QUARTERS:",
    "LAST_N_YEARS:",
    "NEXT_N_YEARS:",
    "LAST_N_FISCAL_QUARTERS:",
    "NEXT_N_FISCAL_QUARTERS:",
    "LAST_N_FISCAL_YEARS:",
    "NEXT_N_FISCAL_YEARS:",
];

/// Which clause region a cursor sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clause {
    Select,
    From,
    Where,
    OrderBy,
    GroupBy,
    Having,
    Limit,
    Offset,
    /// Inside a polymorphic `TYPEOF … WHEN <here>` — expects an sObject type.
    TypeofWhen,
    /// Inside `TYPEOF … WHEN X THEN <here>` / `ELSE <here>` — expects fields of `X`.
    TypeofThen,
    None,
}

/// Kind of completion candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateKind {
    Field,
    Object,
    Keyword,
    Function,
    Relationship,
}

/// A single completion candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub label: String,
    pub kind: CandidateKind,
    pub detail: Option<String>,
}

/// Classify which clause region the `cursor` byte offset falls in.
pub fn clause_at(_outline: &SoqlOutline, input: &str, cursor: usize) -> Clause {
    use crate::lexer::{lex, Token, TokenKind};

    fn token_before(tokens: &[Token], cursor: usize, offset: usize) -> Option<&Token> {
        tokens.iter().filter(|t| t.start < cursor).rev().nth(offset)
    }

    fn is_keyword(token: Option<&Token>, keyword: &str) -> bool {
        token.is_some_and(|t| t.kind == TokenKind::Keyword && t.text.eq_ignore_ascii_case(keyword))
    }

    let tokens: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();

    let previous = token_before(&tokens, cursor, 0);
    let previous_previous = token_before(&tokens, cursor, 1);

    if is_keyword(previous_previous, "ORDER") && is_keyword(previous, "BY") {
        return Clause::OrderBy;
    }
    if is_keyword(previous_previous, "GROUP") && is_keyword(previous, "BY") {
        return Clause::GroupBy;
    }

    let mut clause = Clause::None;
    for token in tokens.iter().filter(|t| t.start < cursor) {
        if token.kind != TokenKind::Keyword {
            continue;
        }

        if token.text.eq_ignore_ascii_case("BY") {
            continue;
        }

        clause = if token.text.eq_ignore_ascii_case("SELECT") {
            Clause::Select
        } else if token.text.eq_ignore_ascii_case("FROM") {
            Clause::From
        } else if token.text.eq_ignore_ascii_case("WHERE") {
            Clause::Where
        } else if token.text.eq_ignore_ascii_case("ORDER") {
            Clause::OrderBy
        } else if token.text.eq_ignore_ascii_case("GROUP") {
            Clause::GroupBy
        } else if token.text.eq_ignore_ascii_case("HAVING") {
            Clause::Having
        } else if token.text.eq_ignore_ascii_case("LIMIT") {
            Clause::Limit
        } else if token.text.eq_ignore_ascii_case("OFFSET") {
            Clause::Offset
        } else if token.text.eq_ignore_ascii_case("WHEN") {
            Clause::TypeofWhen
        } else if token.text.eq_ignore_ascii_case("THEN") || token.text.eq_ignore_ascii_case("ELSE")
        {
            Clause::TypeofThen
        } else if token.text.eq_ignore_ascii_case("END") {
            // TYPEOF finished → back to the SELECT field list.
            Clause::Select
        } else {
            clause
        };
    }

    clause
}

/// The sObject type named by the nearest preceding `WHEN <Type>` before `cursor`
/// (for `TYPEOF … WHEN X THEN …` field completion). `None` if not in such a clause.
fn typeof_when_type(input: &str, cursor: usize) -> Option<String> {
    use crate::lexer::{lex, TokenKind};
    let tokens: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace && t.start < cursor)
        .collect();
    // Find the last WHEN keyword; the Ident immediately after it is the type.
    let when_idx = tokens
        .iter()
        .rposition(|t| t.kind == TokenKind::Keyword && t.text.eq_ignore_ascii_case("WHEN"))?;
    tokens
        .get(when_idx + 1)
        .filter(|t| t.kind == TokenKind::Ident)
        .map(|t| t.text.clone())
}

/// Walk backwards from `cursor` over identifier characters to get the partial.
fn partial_at(input: &str, cursor: usize) -> &str {
    let bytes = input.as_bytes();
    let mut start = cursor;
    while start > 0 {
        let c = bytes[start - 1] as char;
        if c.is_ascii_alphanumeric() || c == '_' {
            start -= 1;
        } else {
            break;
        }
    }
    &input[start..cursor]
}

/// Within a FROM clause, decide whether the object name has already been given
/// (cursor sits *after* it, where trailing keywords like WHERE/LIMIT belong)
/// rather than the object still being typed (where object names belong).
fn from_object_named(input: &str, cursor: usize, partial: &str) -> bool {
    use crate::lexer::{lex, TokenKind};
    let tokens: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();
    let Some(from_tok) = tokens.iter().rev().find(|t| {
        t.start < cursor && t.kind == TokenKind::Keyword && t.text.eq_ignore_ascii_case("FROM")
    }) else {
        return false;
    };
    let partial_start = cursor - partial.len();
    // A complete identifier between FROM and the in-progress partial == object given.
    tokens
        .iter()
        .any(|t| t.kind == TokenKind::Ident && t.start >= from_tok.end && t.start < partial_start)
}

/// The relationship segments of a dotted path immediately before the cursor's
/// partial. `SELECT Account.Owner.Ma|` → `["Account","Owner"]`; `SELECT Na|` → `[]`.
/// Purely lexical, so it is clause-independent (works in SELECT and WHERE).
pub fn relationship_chain_at(input: &str, cursor: usize) -> Vec<String> {
    let bytes = input.as_bytes();
    let is_ident = |c: u8| (c as char).is_ascii_alphanumeric() || c == b'_';
    // Skip the trailing partial.
    let mut pos = cursor;
    while pos > 0 && is_ident(bytes[pos - 1]) {
        pos -= 1;
    }
    let mut segments: Vec<String> = Vec::new();
    // Each preceding `.<ident>` contributes one segment (innermost first).
    while pos > 0 && bytes[pos - 1] == b'.' {
        pos -= 1; // consume '.'
        let end = pos;
        while pos > 0 && is_ident(bytes[pos - 1]) {
            pos -= 1;
        }
        if pos == end {
            break; // a dot with no identifier before it
        }
        segments.push(input[pos..end].to_string());
    }
    segments.reverse();
    segments
}

fn matches_partial(label: &str, partial: &str) -> bool {
    label
        .to_ascii_lowercase()
        .starts_with(&partial.to_ascii_lowercase())
}

fn keyword_candidates_for(clause: Clause) -> &'static [&'static str] {
    match clause {
        Clause::Select => &["FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET"],
        Clause::Where => &[
            "AND", "OR", "NOT", "LIKE", "IN", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET", "NULL",
            "TRUE", "FALSE",
        ],
        Clause::OrderBy => &[
            "ASC",
            "DESC",
            "NULLS FIRST",
            "NULLS LAST",
            "LIMIT",
            "OFFSET",
        ],
        Clause::GroupBy => &["HAVING", "ORDER BY", "LIMIT", "OFFSET"],
        Clause::Having => &[
            "AND", "OR", "NOT", "LIKE", "IN", "ORDER BY", "LIMIT", "OFFSET",
        ],
        Clause::None => &["SELECT"],
        Clause::From => &[],
        Clause::Limit | Clause::Offset => &[],
        // After a WHEN type's fields, `THEN` follows; after THEN/ELSE fields,
        // `ELSE`/`END` follow. Offered alongside the field/object candidates.
        Clause::TypeofWhen => &[],
        Clause::TypeofThen => &["ELSE", "END"],
    }
}

fn push_candidate(
    candidates: &mut Vec<Candidate>,
    label: impl Into<String>,
    kind: CandidateKind,
    detail: Option<String>,
) {
    candidates.push(Candidate {
        label: label.into(),
        kind,
        detail,
    });
}

fn finish_candidates(mut candidates: Vec<Candidate>, partial: &str) -> Vec<Candidate> {
    candidates.retain(|candidate| matches_partial(&candidate.label, partial));
    candidates.sort_by_key(|candidate| candidate.label.to_ascii_lowercase());
    candidates.dedup_by(|a, b| a.label.eq_ignore_ascii_case(&b.label));
    candidates
}

/// Schemas of every object the final relationship in `chain` can resolve to.
/// Intermediate hops use the first `referenceTo`; only the final hop (the one
/// being completed) unions all targets, so polymorphic fields all surface.
fn resolve_chain_targets<'a>(
    schema: &'a SObjectSchema,
    chain: &[String],
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Vec<&'a SObjectSchema> {
    let find_rel = |s: &SObjectSchema, seg: &str| -> Option<usize> {
        s.fields.iter().position(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })
    };
    let mut cur = schema;
    for seg in &chain[..chain.len() - 1] {
        let Some(idx) = find_rel(cur, seg) else {
            return Vec::new();
        };
        let Some(target) = cur.fields[idx].reference_to.first() else {
            return Vec::new();
        };
        let Some(next) = resolve(target) else {
            return Vec::new();
        };
        cur = next;
    }
    let Some(idx) = find_rel(cur, &chain[chain.len() - 1]) else {
        return Vec::new();
    };
    cur.fields[idx]
        .reference_to
        .iter()
        .filter_map(|t| resolve(t))
        .collect()
}

/// Push every field (as `Field`) and every relationship name (as `Relationship`).
fn push_fields_and_relationships(candidates: &mut Vec<Candidate>, schema: &SObjectSchema) {
    for field in &schema.fields {
        push_candidate(candidates, field.name.clone(), CandidateKind::Field, None);
        if let Some(rel) = &field.relationship_name {
            push_candidate(candidates, rel.clone(), CandidateKind::Relationship, None);
        }
    }
}

/// A child subquery enclosing the cursor: its inner text, the cursor offset into
/// that text, and the child-relationship named in its FROM (if any).
pub struct Subquery {
    pub inner: String,
    pub cursor: usize,
    pub from_rel: Option<String>,
}

/// Detect the innermost `(SELECT …)` child subquery enclosing `cursor`.
pub fn subquery_at(input: &str, cursor: usize) -> Option<Subquery> {
    let bytes = input.as_bytes();
    // Innermost unclosed '(' before the cursor.
    let mut depth = 0i32;
    let mut open = None;
    for i in (0..cursor).rev() {
        match bytes[i] {
            b')' => depth += 1,
            b'(' => {
                if depth == 0 {
                    open = Some(i);
                    break;
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    let open = open?;
    let body_start = open + 1;
    // Body must begin with SELECT (after optional whitespace).
    let trimmed = input[body_start..].trim_start();
    if trimmed.len() < 6 || !trimmed[..6].eq_ignore_ascii_case("SELECT") {
        return None;
    }
    // Matching ')' (or end of input).
    let mut d = 0i32;
    let mut close = input.len();
    for (i, &b) in bytes.iter().enumerate().skip(body_start) {
        match b {
            b'(' => d += 1,
            b')' => {
                if d == 0 {
                    close = i;
                    break;
                }
                d -= 1;
            }
            _ => {}
        }
    }
    let inner = input[body_start..close].to_string();
    let from_rel = outline(&inner).from_object;
    Some(Subquery {
        inner,
        cursor: cursor - body_start,
        from_rel,
    })
}

/// Resolve a child-relationship name to its child sObject schema.
fn resolve_child<'a>(
    schema: &'a SObjectSchema,
    rel: &str,
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Option<&'a SObjectSchema> {
    let cr = schema.child_relationships.iter().find(|c| {
        c.relationship_name
            .as_deref()
            .is_some_and(|r| r.eq_ignore_ascii_case(rel))
    })?;
    resolve(&cr.child_sobject)
}

/// Produce context-aware completions for `input` at `cursor`.
///
/// Pure: reads `schema`, `objects`, and `resolve` (object name → schema, used to
/// traverse relationship paths). Callers without related schemas pass `&|_| None`.
pub fn complete<'a>(
    input: &str,
    cursor: usize,
    schema: &'a SObjectSchema,
    objects: &[String],
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Vec<Candidate> {
    // Inside a child subquery: complete against the child sObject (fields) or the
    // parent's child-relationship names (its FROM).
    if let Some(sub) = subquery_at(input, cursor) {
        let child_rel_names: Vec<String> = schema
            .child_relationships
            .iter()
            .filter_map(|c| c.relationship_name.clone())
            .collect();
        let child = sub
            .from_rel
            .as_deref()
            .and_then(|rel| resolve_child(schema, rel, resolve))
            .unwrap_or(schema);
        return complete(&sub.inner, sub.cursor, child, &child_rel_names, resolve);
    }

    let o = outline(input);
    let clause = clause_at(&o, input, cursor);
    let partial = partial_at(input, cursor);
    let chain = relationship_chain_at(input, cursor);
    let mut candidates = Vec::new();

    // A dotted path completes against the related object(s), in any clause.
    // Polymorphic final hops union every target's fields (deduped on finish).
    if !chain.is_empty() {
        for target in resolve_chain_targets(schema, &chain, resolve) {
            push_fields_and_relationships(&mut candidates, target);
        }
        return finish_candidates(candidates, partial);
    }

    match clause {
        Clause::Select | Clause::Where | Clause::OrderBy | Clause::GroupBy | Clause::Having => {
            push_fields_and_relationships(&mut candidates, schema);
            for function in SOQL_FUNCTIONS {
                push_candidate(&mut candidates, *function, CandidateKind::Function, None);
            }
            // Date literals are WHERE/HAVING values (e.g. CreatedDate = TODAY).
            if matches!(clause, Clause::Where | Clause::Having) {
                for literal in SOQL_DATE_LITERALS {
                    push_candidate(&mut candidates, *literal, CandidateKind::Keyword, None);
                }
            }
            for keyword in keyword_candidates_for(clause) {
                push_candidate(&mut candidates, *keyword, CandidateKind::Keyword, None);
            }
        }
        Clause::From => {
            if from_object_named(input, cursor, partial) {
                // Object already named → offer the clauses that may follow it.
                for keyword in ["WHERE", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET"] {
                    push_candidate(&mut candidates, keyword, CandidateKind::Keyword, None);
                }
            } else {
                for object in objects {
                    push_candidate(&mut candidates, object.clone(), CandidateKind::Object, None);
                }
            }
        }
        Clause::None => {
            for keyword in keyword_candidates_for(clause) {
                push_candidate(&mut candidates, *keyword, CandidateKind::Keyword, None);
            }
        }
        Clause::TypeofWhen => {
            // `TYPEOF rel WHEN <here>` → an sObject type.
            for object in objects {
                push_candidate(&mut candidates, object.clone(), CandidateKind::Object, None);
            }
        }
        Clause::TypeofThen => {
            // `WHEN X THEN <here>` / `ELSE <here>` → fields of X (else base schema).
            let target = typeof_when_type(input, cursor)
                .and_then(|t| resolve(&t))
                .unwrap_or(schema);
            push_fields_and_relationships(&mut candidates, target);
            for keyword in keyword_candidates_for(clause) {
                push_candidate(&mut candidates, *keyword, CandidateKind::Keyword, None);
            }
        }
        Clause::Limit | Clause::Offset => {}
    }

    finish_candidates(candidates, partial)
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
        SObjectSchema {
            name: "User".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), field("Email"), field("ManagerId")],
            child_relationships: vec![],
        }
    }

    #[test]
    fn chain_single_hop() {
        assert_eq!(
            relationship_chain_at("SELECT Owner.Ma", "SELECT Owner.Ma".len()),
            vec!["Owner"]
        );
    }

    #[test]
    fn chain_multi_hop_empty_partial() {
        let input = "SELECT Account.Owner.";
        assert_eq!(
            relationship_chain_at(input, input.len()),
            vec!["Account", "Owner"]
        );
    }

    #[test]
    fn chain_plain_field_is_empty() {
        assert_eq!(
            relationship_chain_at("SELECT Na", "SELECT Na".len()),
            Vec::<String>::new()
        );
    }

    #[test]
    fn chain_in_where_clause() {
        let input = "SELECT Id FROM Account WHERE Owner.Na";
        assert_eq!(relationship_chain_at(input, input.len()), vec!["Owner"]);
    }

    #[test]
    fn completes_related_object_fields_single_hop() {
        let mut account = account_schema();
        account.fields[3].relationship_name = Some("Owner".to_string());
        account.fields[3].reference_to = vec!["User".to_string()];
        let mut map = std::collections::HashMap::new();
        map.insert("User".to_string(), user_schema());
        let resolve = |name: &str| map.get(name);
        let input = "SELECT Owner.Em FROM Account";
        let cursor = "SELECT Owner.Em".len();
        let labels: Vec<String> = complete(input, cursor, &account, &[], &resolve)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Email".to_string()), "{labels:?}");
        assert!(
            !labels.contains(&"Industry".to_string()),
            "no root fields: {labels:?}"
        );
    }

    #[test]
    fn unresolvable_hop_yields_no_candidates() {
        let mut account = account_schema();
        account.fields[3].relationship_name = Some("Owner".to_string());
        account.fields[3].reference_to = vec!["User".to_string()];
        let resolve = |_: &str| None;
        let input = "SELECT Owner.Em FROM Account";
        let cursor = "SELECT Owner.Em".len();
        assert!(complete(input, cursor, &account, &[], &resolve).is_empty());
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
    fn subquery_at_detects_inner_select() {
        let input = "SELECT Id, (SELECT Las FROM Contacts) FROM Account";
        let cursor = input.find("Las").unwrap() + 3;
        let sub = subquery_at(input, cursor).expect("subquery");
        assert_eq!(sub.from_rel.as_deref(), Some("Contacts"));
        assert_eq!(&sub.inner[..6], "SELECT");
    }

    #[test]
    fn subquery_at_none_outside() {
        let input = "SELECT Id FROM Account";
        assert!(subquery_at(input, input.len()).is_none());
    }

    #[test]
    fn completes_child_subquery_fields() {
        let account = account_with_contacts();
        let mut map = std::collections::HashMap::new();
        map.insert("Contact".to_string(), contact_schema());
        let resolve = |n: &str| map.get(n);
        let input = "SELECT Id, (SELECT Las FROM Contacts) FROM Account";
        let cursor = input.find("Las").unwrap() + 3;
        let labels: Vec<String> = complete(input, cursor, &account, &[], &resolve)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"LastName".to_string()), "{labels:?}");
        assert!(
            !labels.contains(&"Industry".to_string()),
            "parent field leaked into subquery: {labels:?}"
        );
    }

    #[test]
    fn completes_child_relationship_names_in_subquery_from() {
        let account = account_with_contacts();
        let input = "SELECT Id, (SELECT Id FROM Con) FROM Account";
        let cursor = input.find("Con").unwrap() + 3;
        let cands = complete(input, cursor, &account, &[], &|_| None);
        assert!(
            cands
                .iter()
                .any(|c| c.label == "Contacts" && c.kind == CandidateKind::Object),
            "{cands:?}"
        );
    }

    fn lead_schema() -> SObjectSchema {
        SObjectSchema {
            name: "Lead".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), field("Company")],
            child_relationships: vec![],
        }
    }

    #[test]
    fn unions_polymorphic_relationship_targets() {
        let mut acct = account_schema();
        let mut who = field("WhoId");
        who.relationship_name = Some("Who".to_string());
        who.reference_to = vec!["Contact".to_string(), "Lead".to_string()];
        acct.fields.push(who);
        let mut map = std::collections::HashMap::new();
        map.insert("Contact".to_string(), contact_schema()); // LastName
        map.insert("Lead".to_string(), lead_schema()); // Company
        let resolve = |n: &str| map.get(n);
        let input = "SELECT Who. FROM Account";
        let cursor = "SELECT Who.".len();
        let labels: Vec<String> = complete(input, cursor, &acct, &[], &resolve)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(
            labels.contains(&"LastName".to_string()),
            "Contact field: {labels:?}"
        );
        assert!(
            labels.contains(&"Company".to_string()),
            "Lead field: {labels:?}"
        );
    }

    #[test]
    fn offers_relationship_names_at_root() {
        let mut schema = account_schema();
        schema.fields[3].relationship_name = Some("Owner".to_string());
        schema.fields[3].reference_to = vec!["User".to_string()];
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let cands = complete(input, cursor, &schema, &[], &|_| None);
        assert!(
            cands
                .iter()
                .any(|c| c.label == "Owner" && c.kind == CandidateKind::Relationship),
            "{cands:?}"
        );
    }

    #[test]
    fn completes_partial_field_in_select() {
        let schema = account_schema();
        let input = "SELECT Na FROM Account";
        let cursor = "SELECT Na".len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Name".to_string()));
        assert!(!labels.contains(&"Id".to_string()));
    }

    #[test]
    fn no_completions_inside_from_object() {
        let schema = account_schema();
        let input = "SELECT Na FROM Account";
        let cursor = input.len(); // inside "Account"
        assert!(complete(input, cursor, &schema, &[], &|_| None).is_empty());
    }

    #[test]
    fn empty_partial_returns_all_fields() {
        let schema = account_schema();
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Id".to_string()));
        assert!(labels.contains(&"Industry".to_string()));
        assert!(labels.contains(&"Name".to_string()));
        assert!(labels.contains(&"OwnerId".to_string()));
    }

    #[test]
    fn select_position_contains_field_and_function() {
        let schema = account_schema();
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let candidates = complete(input, cursor, &schema, &[], &|_| None);
        assert!(candidates
            .iter()
            .any(|c| c.label == "Name" && c.kind == CandidateKind::Field && c.detail.is_none()));
        assert!(candidates
            .iter()
            .any(|c| c.label == "COUNT_DISTINCT" && c.kind == CandidateKind::Function));
    }

    #[test]
    fn completes_objects_in_from_position_by_prefix() {
        let schema = account_schema();
        let input = "SELECT Id FROM Acc";
        let cursor = input.len();
        let objects = vec!["Account".to_string(), "Contact".to_string()];
        let labels: Vec<String> = complete(input, cursor, &schema, &objects, &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Account".to_string()));
        assert!(!labels.contains(&"Contact".to_string()));
    }

    #[test]
    fn prefix_filtering_is_case_insensitive() {
        let schema = account_schema();
        let input = "SELECT na FROM Account";
        let cursor = "SELECT na".len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Name".to_string()));
    }

    #[test]
    fn empty_objects_in_from_position_does_not_panic() {
        let schema = account_schema();
        let input = "SELECT Id FROM ";
        let cursor = input.len();
        assert!(complete(input, cursor, &schema, &[], &|_| None).is_empty());
    }

    #[test]
    fn offers_where_after_from_object_is_named() {
        let schema = account_schema();
        let objects = vec!["Account".to_string(), "Contact".to_string()];
        let input = "SELECT Id FROM Account wh";
        let cursor = input.len();
        let candidates = complete(input, cursor, &schema, &objects, &|_| None);
        assert!(
            candidates
                .iter()
                .any(|c| c.label == "WHERE" && c.kind == CandidateKind::Keyword),
            "expected WHERE keyword after a named FROM object: {candidates:?}"
        );
        assert!(
            !candidates.iter().any(|c| c.kind == CandidateKind::Object),
            "should not offer object names once the FROM object is named"
        );
    }

    #[test]
    fn offers_trailing_keywords_after_from_object_and_space() {
        let schema = account_schema();
        let objects = vec!["Account".to_string()];
        let input = "SELECT Id FROM Account ";
        let cursor = input.len();
        let labels: Vec<String> = complete(input, cursor, &schema, &objects, &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"WHERE".to_string()));
        assert!(labels.contains(&"ORDER BY".to_string()));
        assert!(labels.contains(&"LIMIT".to_string()));
        assert!(!labels.contains(&"Account".to_string()));
    }

    #[test]
    fn still_offers_objects_while_typing_from_object() {
        let schema = account_schema();
        let objects = vec!["Account".to_string(), "Contact".to_string()];
        let input = "SELECT Id FROM Acc";
        let cursor = input.len();
        let candidates = complete(input, cursor, &schema, &objects, &|_| None);
        assert!(
            candidates
                .iter()
                .any(|c| c.label == "Account" && c.kind == CandidateKind::Object),
            "still typing the object → offer object names: {candidates:?}"
        );
    }

    #[test]
    fn offers_from_after_select_list() {
        let schema = account_schema();
        let input = "SELECT Name FR";
        let cursor = input.len();
        let candidates = complete(input, cursor, &schema, &[], &|_| None);
        assert!(candidates
            .iter()
            .any(|c| c.label == "FROM" && c.kind == CandidateKind::Keyword));
    }

    #[test]
    fn offers_date_literals_in_where() {
        let schema = account_schema();
        let input = "SELECT Id FROM Account WHERE CreatedDate = ";
        let cursor = input.len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"TODAY".to_string()), "{labels:?}");
        assert!(labels.contains(&"LAST_N_DAYS:".to_string()), "{labels:?}");
    }

    #[test]
    fn no_date_literals_in_select() {
        let schema = account_schema();
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(!labels.contains(&"TODAY".to_string()), "{labels:?}");
    }

    #[test]
    fn partial_date_literal_filters_to_matching() {
        let schema = account_schema();
        let input = "SELECT Id FROM Account WHERE CreatedDate = LAST_N";
        let cursor = input.len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"LAST_N_DAYS:".to_string()), "{labels:?}");
        assert!(!labels.contains(&"TODAY".to_string()), "{labels:?}");
    }

    #[test]
    fn typeof_when_offers_object_types() {
        let base = account_schema();
        let objects = vec!["Account".to_string(), "Opportunity".to_string()];
        let input = "SELECT TYPEOF What WHEN Acc FROM Event";
        let cursor = "SELECT TYPEOF What WHEN Acc".len();
        let labels: Vec<String> = complete(input, cursor, &base, &objects, &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Account".to_string()), "{labels:?}");
    }

    #[test]
    fn typeof_then_offers_when_type_fields() {
        let base = account_schema(); // stands in for Event
        let mut map = std::collections::HashMap::new();
        map.insert("Account".to_string(), account_schema());
        let resolve = |n: &str| map.get(n);
        let input = "SELECT TYPEOF What WHEN Account THEN Indu FROM Event";
        let cursor = "SELECT TYPEOF What WHEN Account THEN Indu".len();
        let labels: Vec<String> = complete(input, cursor, &base, &[], &resolve)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Industry".to_string()), "{labels:?}");
    }

    #[test]
    fn typeof_then_falls_back_to_base_when_type_unresolved() {
        let base = account_schema();
        let input = "SELECT TYPEOF What WHEN Unknown THEN Na FROM Event";
        let cursor = "SELECT TYPEOF What WHEN Unknown THEN Na".len();
        let labels: Vec<String> = complete(input, cursor, &base, &[], &|_| None)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert!(labels.contains(&"Name".to_string()), "{labels:?}");
    }
}
