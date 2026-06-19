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
/// Walks the non-whitespace token stream: collects dotted-ident runs between
/// `SELECT` and `FROM` as select fields, and takes the first `Ident` after a
/// `FROM` keyword as the `from_object`. A lone `*` is ignored.
pub fn outline(input: &str) -> SoqlOutline {
    let toks: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();

    let mut out = SoqlOutline::default();
    let mut in_select = false;
    let mut expect_from_object = false;
    let mut i = 0;

    while i < toks.len() {
        let t = &toks[i];
        match t.kind {
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("SELECT") => {
                in_select = true;
                expect_from_object = false;
                i += 1;
            }
            TokenKind::Keyword if t.text.eq_ignore_ascii_case("FROM") => {
                in_select = false;
                expect_from_object = true;
                i += 1;
            }
            TokenKind::Ident if expect_from_object => {
                out.from_object = Some(t.text.clone());
                expect_from_object = false;
                i += 1;
            }
            TokenKind::Ident if in_select => {
                // Join a dotted run: Ident (Dot Ident)*.
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
            }
            _ => {
                expect_from_object = false;
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
}
