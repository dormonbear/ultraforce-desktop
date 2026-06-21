//! Parse-lite: extract a structural outline (FROM object + SELECT field list).

use crate::lexer::{lex, TokenKind};

/// A reference to a (possibly dotted) field in the SELECT list, with span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldRef {
    pub name: String,
    pub start: usize,
    pub end: usize,
}

/// A coarse structural outline of a SOQL query.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SoqlOutline {
    pub from_object: Option<String>,
    pub select_fields: Vec<FieldRef>,
}

/// Build a `SoqlOutline` from raw SOQL text.
///
pub fn outline(input: &str) -> SoqlOutline {
    let toks: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();

    let mut out = SoqlOutline::default();
    let mut in_select = false;
    let mut expect_from_object = false;
    let mut at_item_start = false;
    let mut i = 0;

    while i < toks.len() {
        let t = &toks[i];
        match t.kind {
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("SELECT") => {
                in_select = true;
                expect_from_object = false;
                at_item_start = true;
                i += 1;
            }
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("FROM") => {
                in_select = false;
                at_item_start = false;
                expect_from_object = true;
                i += 1;
            }
            TokenKind::Ident if expect_from_object => {
                out.from_object = Some(t.text.clone());
                expect_from_object = false;
                i += 1;
            }
            TokenKind::Comma if in_select => {
                at_item_start = true;
                i += 1;
            }
            TokenKind::Ident if in_select && at_item_start => {
                // A function call at item start (`ident (`) is not a field — skip the whole item.
                if toks.get(i + 1).map(|n| n.kind) == Some(TokenKind::LParen) {
                    at_item_start = false;
                    i += 1;
                } else {
                    // Dotted field run at item start: Ident (Dot Ident)*.
                    let start = t.start;
                    let mut end = t.end;
                    let mut name = t.text.clone();
                    i += 1;
                    while i + 1 < toks.len()
                        && toks[i].kind == TokenKind::Dot
                        && toks[i + 1].kind == TokenKind::Ident
                    {
                        name.push('.');
                        name.push_str(&toks[i + 1].text);
                        end = toks[i + 1].end;
                        i += 2;
                    }
                    out.select_fields.push(FieldRef { name, start, end });
                    at_item_start = false; // trailing idents in this item (alias) are not fields
                }
            }
            TokenKind::LParen if in_select => {
                // Skip a balanced parenthesized group (child subquery or function
                // args) — its contents are not parent SELECT fields or FROM object.
                let mut depth = 1;
                i += 1;
                while i < toks.len() && depth > 0 {
                    match toks[i].kind {
                        TokenKind::LParen => depth += 1,
                        TokenKind::RParen => depth -= 1,
                        _ => {}
                    }
                    i += 1;
                }
                at_item_start = false;
            }
            _ => {
                expect_from_object = false;
                at_item_start = false;
                i += 1;
            }
        }
    }

    out
}

/// Each child subquery's `(body_start_byte_offset, body_text)`. A subquery is a
/// parenthesized group whose body begins with `SELECT`.
pub fn subquery_groups(input: &str) -> Vec<(usize, String)> {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            let body_start = i + 1;
            let trimmed = input[body_start..].trim_start();
            if trimmed.len() >= 6 && trimmed[..6].eq_ignore_ascii_case("SELECT") {
                let mut depth = 0i32;
                let mut close = input.len();
                let mut j = body_start;
                while j < bytes.len() {
                    match bytes[j] {
                        b'(' => depth += 1,
                        b')' => {
                            if depth == 0 {
                                close = j;
                                break;
                            }
                            depth -= 1;
                        }
                        _ => {}
                    }
                    j += 1;
                }
                out.push((body_start, input[body_start..close].to_string()));
                i = close + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// A WHERE condition: a (possibly dotted) field, an operator, and the operator span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Condition {
    pub field: FieldRef,
    pub op: String,
    pub op_start: usize,
    pub op_end: usize,
}

/// Recognized comparison operators built from one or two `Other` tokens.
fn comparison_op(s: &str) -> bool {
    matches!(s, "=" | "!=" | "<>" | "<" | ">" | "<=" | ">=")
}

/// Extract `field operator …` conditions from the WHERE clause (best-effort, never panics).
/// Operators: `= != <> < > <= >=`, keyword `LIKE`/`IN`, ident `INCLUDES`/`EXCLUDES`.
pub fn where_conditions(input: &str) -> Vec<Condition> {
    let toks: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();

    // Locate the WHERE keyword; bound the scan at the next top-level clause keyword.
    let Some(where_i) = toks
        .iter()
        .position(|t| t.kind == TokenKind::Keyword && t.text.eq_ignore_ascii_case("WHERE"))
    else {
        return Vec::new();
    };
    let stop = ["GROUP", "ORDER", "LIMIT", "OFFSET", "HAVING", "WITH", "FOR"];
    let end = toks[where_i + 1..]
        .iter()
        .position(|t| {
            t.kind == TokenKind::Keyword && stop.iter().any(|s| t.text.eq_ignore_ascii_case(s))
        })
        .map(|p| where_i + 1 + p)
        .unwrap_or(toks.len());

    let mut out = Vec::new();
    let mut i = where_i + 1;
    while i < end {
        // A field path: Ident (Dot Ident)*.
        if toks[i].kind != TokenKind::Ident {
            i += 1;
            continue;
        }
        let start = toks[i].start;
        let mut last_end = toks[i].end;
        let mut name = toks[i].text.clone();
        i += 1;
        while i + 1 < end && toks[i].kind == TokenKind::Dot && toks[i + 1].kind == TokenKind::Ident
        {
            name.push('.');
            name.push_str(&toks[i + 1].text);
            last_end = toks[i + 1].end;
            i += 2;
        }
        let field = FieldRef {
            name,
            start,
            end: last_end,
        };

        // The operator immediately following the field path.
        if i >= end {
            break;
        }
        let t = &toks[i];
        let word_op = (t.kind == TokenKind::Keyword
            && (t.text.eq_ignore_ascii_case("LIKE") || t.text.eq_ignore_ascii_case("IN")))
            || (t.kind == TokenKind::Ident
                && (t.text.eq_ignore_ascii_case("INCLUDES")
                    || t.text.eq_ignore_ascii_case("EXCLUDES")));
        if word_op {
            out.push(Condition {
                field,
                op: t.text.to_ascii_uppercase(),
                op_start: t.start,
                op_end: t.end,
            });
            i += 1;
        } else if t.kind == TokenKind::Other {
            // Join up to two adjacent `Other` tokens into the operator text.
            let mut op = t.text.clone();
            let op_start = t.start;
            let mut op_end = t.end;
            if i + 1 < end && toks[i + 1].kind == TokenKind::Other && toks[i + 1].start == op_end {
                let joined = format!("{op}{}", toks[i + 1].text);
                if comparison_op(&joined) {
                    op = joined;
                    op_end = toks[i + 1].end;
                    i += 1;
                }
            }
            if comparison_op(&op) {
                out.push(Condition {
                    field,
                    op,
                    op_start,
                    op_end,
                });
            }
            i += 1;
        }
        // else: not an operator (e.g. a bare keyword) — skip and resume scanning.
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outlines_simple_query() {
        let input = "SELECT Id, Name FROM Account";
        let o = outline(input);
        assert_eq!(o.from_object.as_deref(), Some("Account"));
        let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Id", "Name"]);
        for f in &o.select_fields {
            assert_eq!(&input[f.start..f.end], f.name);
        }
    }

    #[test]
    fn outlines_dotted_field() {
        let input = "SELECT Owner.Name FROM Account";
        let o = outline(input);
        assert_eq!(o.select_fields.len(), 1);
        assert_eq!(o.select_fields[0].name, "Owner.Name");
        let f = &o.select_fields[0];
        assert_eq!(&input[f.start..f.end], "Owner.Name");
    }

    #[test]
    fn outline_without_from() {
        let o = outline("SELECT Id");
        assert_eq!(o.from_object, None);
    }

    #[test]
    fn aggregate_function_is_not_a_field() {
        let o = outline("SELECT COUNT(Id) FROM Account");
        assert_eq!(o.from_object.as_deref(), Some("Account"));
        let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
        assert!(
            names.is_empty(),
            "function name/args must not be collected, got {names:?}"
        );
    }

    #[test]
    fn alias_is_not_a_field() {
        let o = outline("SELECT Name n, Id FROM Account");
        let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Name", "Id"]); // alias `n` skipped
    }

    #[test]
    fn function_then_real_field() {
        let o = outline("SELECT toLabel(Status), Name FROM Case");
        let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Name"]); // toLabel + its arg skipped; Name kept
    }

    #[test]
    fn extracts_simple_condition() {
        let c = where_conditions("SELECT Id FROM Account WHERE Name = 'x'");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].field.name, "Name");
        assert_eq!(c[0].op, "=");
    }

    #[test]
    fn extracts_dotted_field_and_two_char_op() {
        let c = where_conditions("SELECT Id FROM Account WHERE Owner.Age >= 18");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].field.name, "Owner.Age");
        assert_eq!(c[0].op, ">=");
    }

    #[test]
    fn extracts_like_and_and() {
        let c =
            where_conditions("SELECT Id FROM Account WHERE Name LIKE 'a%' AND Industry = 'Tech'");
        let pairs: Vec<(&str, &str)> = c
            .iter()
            .map(|x| (x.field.name.as_str(), x.op.as_str()))
            .collect();
        assert_eq!(pairs, vec![("Name", "LIKE"), ("Industry", "=")]);
    }

    #[test]
    fn stops_at_order_by() {
        let c = where_conditions("SELECT Id FROM Account WHERE Amount > 1 ORDER BY Name");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].op, ">");
    }

    #[test]
    fn no_where_no_conditions() {
        assert!(where_conditions("SELECT Id FROM Account").is_empty());
    }

    #[test]
    fn outline_skips_subquery_contents() {
        let o = outline("SELECT Id, (SELECT LastName FROM Contacts) FROM Account");
        // Parent fields exclude the subquery's LastName; FROM stays Account.
        let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Id"]);
        assert_eq!(o.from_object.as_deref(), Some("Account"));
    }

    #[test]
    fn subquery_groups_extracts_body_and_offset() {
        let input = "SELECT Id, (SELECT LastName FROM Contacts) FROM Account";
        let groups = subquery_groups(input);
        assert_eq!(groups.len(), 1);
        let (start, body) = &groups[0];
        assert_eq!(body, "SELECT LastName FROM Contacts");
        assert_eq!(&input[*start..*start + body.len()], body);
    }
}
