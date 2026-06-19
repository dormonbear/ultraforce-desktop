//! Cursor-aware clause detection and SELECT field-name completion (pure).

use crate::parse::{outline, SoqlOutline};
use sf_schema::SObjectSchema;

/// Which clause region a cursor sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clause {
    Select,
    From,
    Other,
}

/// Kind of completion candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateKind {
    Field,
}

/// A single completion candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub label: String,
    pub kind: CandidateKind,
}

/// Find the byte offsets of the `SELECT` and `FROM` keywords (case-insensitive).
fn keyword_span(input: &str, keyword: &str) -> Option<(usize, usize)> {
    use crate::lexer::{lex, TokenKind};
    lex(input).into_iter().find_map(|t| {
        if t.kind == TokenKind::Keyword && t.text.eq_ignore_ascii_case(keyword) {
            Some((t.start, t.end))
        } else {
            None
        }
    })
}

/// Classify which clause region the `cursor` byte offset falls in.
pub fn clause_at(outline: &SoqlOutline, input: &str, cursor: usize) -> Clause {
    let select = keyword_span(input, "SELECT");
    let from = keyword_span(input, "FROM");

    // Between SELECT keyword end and FROM keyword start = Select region.
    if let Some((_, sel_end)) = select {
        let before_from = match from {
            Some((from_start, _)) => cursor <= from_start,
            None => true,
        };
        if cursor >= sel_end && before_from {
            return Clause::Select;
        }
    }

    // At/after the FROM object slot = From region.
    if let Some((_, from_end)) = from {
        if cursor >= from_end {
            // If a from_object is present and the cursor is within/at its span, From.
            if let Some(obj) = &outline.from_object {
                if let Some(pos) = input[from_end..].find(obj.as_str()) {
                    let obj_start = from_end + pos;
                    let obj_end = obj_start + obj.len();
                    if cursor >= from_end && cursor <= obj_end {
                        return Clause::From;
                    }
                    if cursor < obj_start {
                        return Clause::From;
                    }
                } else if cursor >= from_end {
                    return Clause::From;
                }
            } else {
                return Clause::From;
            }
        }
    }

    Clause::Other
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

/// Produce SELECT field-name completions for `input` at `cursor`.
///
/// Pure: reads only `schema`. Returns `[]` outside the SELECT clause.
pub fn complete(input: &str, cursor: usize, schema: &SObjectSchema) -> Vec<Candidate> {
    let o = outline(input);
    if clause_at(&o, input, cursor) != Clause::Select {
        return Vec::new();
    }

    let partial = partial_at(input, cursor);

    let mut labels: Vec<String> = schema
        .fields
        .iter()
        .filter(|f| {
            f.name
                .to_ascii_lowercase()
                .starts_with(&partial.to_ascii_lowercase())
        })
        .map(|f| f.name.clone())
        .collect();
    labels.sort();
    labels.dedup();

    labels
        .into_iter()
        .map(|label| Candidate {
            label,
            kind: CandidateKind::Field,
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
    fn completes_partial_field_in_select() {
        let schema = account_schema();
        let input = "SELECT Na FROM Account";
        let cursor = "SELECT Na".len();
        let labels: Vec<String> = complete(input, cursor, &schema)
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
        assert!(complete(input, cursor, &schema).is_empty());
    }

    #[test]
    fn empty_partial_returns_all_fields() {
        let schema = account_schema();
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let labels: Vec<String> = complete(input, cursor, &schema)
            .into_iter()
            .map(|c| c.label)
            .collect();
        assert_eq!(labels, vec!["Id", "Industry", "Name", "OwnerId"]);
    }
}
