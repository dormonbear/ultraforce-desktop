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
            _ => {
                expect_from_object = false;
                at_item_start = false;
                i += 1;
            }
        }
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
}
