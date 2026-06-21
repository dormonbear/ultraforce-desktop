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
        } else {
            clause
        };
    }

    clause
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

/// Produce context-aware completions for `input` at `cursor`.
///
/// Pure: reads only `schema` and `objects`.
pub fn complete(
    input: &str,
    cursor: usize,
    schema: &SObjectSchema,
    objects: &[String],
) -> Vec<Candidate> {
    let o = outline(input);
    let clause = clause_at(&o, input, cursor);
    let partial = partial_at(input, cursor);
    let mut candidates = Vec::new();

    match clause {
        Clause::Select | Clause::Where | Clause::OrderBy | Clause::GroupBy | Clause::Having => {
            for field in &schema.fields {
                push_candidate(
                    &mut candidates,
                    field.name.clone(),
                    CandidateKind::Field,
                    None,
                );
            }
            for function in SOQL_FUNCTIONS {
                push_candidate(&mut candidates, *function, CandidateKind::Function, None);
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

    #[test]
    fn completes_partial_field_in_select() {
        let schema = account_schema();
        let input = "SELECT Na FROM Account";
        let cursor = "SELECT Na".len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[])
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
        assert!(complete(input, cursor, &schema, &[]).is_empty());
    }

    #[test]
    fn empty_partial_returns_all_fields() {
        let schema = account_schema();
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let labels: Vec<String> = complete(input, cursor, &schema, &[])
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
        let candidates = complete(input, cursor, &schema, &[]);
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
        let labels: Vec<String> = complete(input, cursor, &schema, &objects)
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
        let labels: Vec<String> = complete(input, cursor, &schema, &[])
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
        assert!(complete(input, cursor, &schema, &[]).is_empty());
    }

    #[test]
    fn offers_where_after_from_object_is_named() {
        let schema = account_schema();
        let objects = vec!["Account".to_string(), "Contact".to_string()];
        let input = "SELECT Id FROM Account wh";
        let cursor = input.len();
        let candidates = complete(input, cursor, &schema, &objects);
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
        let labels: Vec<String> = complete(input, cursor, &schema, &objects)
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
        let candidates = complete(input, cursor, &schema, &objects);
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
        let candidates = complete(input, cursor, &schema, &[]);
        assert!(candidates
            .iter()
            .any(|c| c.label == "FROM" && c.kind == CandidateKind::Keyword));
    }
}
