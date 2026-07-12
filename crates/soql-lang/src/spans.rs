//! Inner subquery range detection for editor highlighting.
//!
//! A subquery is a parenthesized group whose first meaningful token is `SELECT`
//! (e.g. `(SELECT Id FROM Contacts)`). This reuses the crate's [`lexer::lex`]
//! tokenizer — the same one `format.rs` builds on — so there is no second
//! tokenizer. Nested subqueries are reported too, via a paren stack.

use crate::lexer::{lex, TokenKind};

/// Byte-offset spans `(open_paren_start, close_paren_end)` of every subquery in
/// `input`, including nested ones, sorted by start. Each span covers the whole
/// `(SELECT … )` group including its parentheses. Unbalanced parentheses never
/// panic — an unmatched `)` is ignored and an unclosed `(` yields no span.
pub fn subquery_spans(input: &str) -> Vec<(usize, usize)> {
    let toks = lex(input);
    // Stack of open parens: (byte_start_of_open_paren, is_subquery).
    let mut stack: Vec<(usize, bool)> = Vec::new();
    let mut out: Vec<(usize, usize)> = Vec::new();
    for (idx, t) in toks.iter().enumerate() {
        match t.kind {
            TokenKind::LParen => {
                let is_subquery = toks[idx + 1..]
                    .iter()
                    .find(|n| n.kind != TokenKind::Whitespace)
                    .is_some_and(|n| {
                        n.kind == TokenKind::Keyword && n.text.eq_ignore_ascii_case("SELECT")
                    });
                stack.push((t.start, is_subquery));
            }
            TokenKind::RParen => {
                if let Some((open_start, is_subquery)) = stack.pop() {
                    if is_subquery {
                        out.push((open_start, t.end));
                    }
                }
            }
            _ => {}
        }
    }
    out.sort_by_key(|&(start, _)| start);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_subquery_yields_nothing() {
        assert_eq!(subquery_spans("SELECT Id, Name FROM Account"), vec![]);
    }

    #[test]
    fn single_subquery_span_covers_parens() {
        let input = "SELECT Id, (SELECT LastName FROM Contacts) FROM Account";
        let spans = subquery_spans(input);
        assert_eq!(spans.len(), 1);
        let (s, e) = spans[0];
        assert_eq!(&input[s..e], "(SELECT LastName FROM Contacts)");
    }

    #[test]
    fn multiple_subqueries_in_field_list() {
        let input =
            "SELECT (SELECT Id FROM Contacts), (SELECT Id FROM Cases) FROM Account";
        let spans = subquery_spans(input);
        assert_eq!(spans.len(), 2);
        assert_eq!(&input[spans[0].0..spans[0].1], "(SELECT Id FROM Contacts)");
        assert_eq!(&input[spans[1].0..spans[1].1], "(SELECT Id FROM Cases)");
    }

    #[test]
    fn nested_subqueries_are_reported() {
        let input = "SELECT (SELECT (SELECT Id FROM Cases) FROM Contacts) FROM Account";
        let spans = subquery_spans(input);
        assert_eq!(spans.len(), 2);
        // Outer first (smaller start), then inner.
        assert_eq!(
            &input[spans[0].0..spans[0].1],
            "(SELECT (SELECT Id FROM Cases) FROM Contacts)"
        );
        assert_eq!(&input[spans[1].0..spans[1].1], "(SELECT Id FROM Cases)");
    }

    #[test]
    fn function_call_parens_are_not_subqueries() {
        // The `(Name)` group opens with an identifier, not SELECT.
        let input = "SELECT COUNT(Id) FROM Account";
        assert_eq!(subquery_spans(input), vec![]);
    }

    #[test]
    fn in_clause_parens_are_not_subqueries() {
        let input = "SELECT Id FROM Account WHERE Id IN ('a', 'b')";
        assert_eq!(subquery_spans(input), vec![]);
    }

    #[test]
    fn unbalanced_parens_do_not_panic() {
        // Extra close paren.
        assert_eq!(subquery_spans("SELECT Id FROM Account)"), vec![]);
        // Unclosed subquery paren — no span, no panic.
        assert_eq!(subquery_spans("SELECT (SELECT Id FROM Contacts"), vec![]);
    }

    #[test]
    fn multibyte_prefix_keeps_byte_offsets_correct() {
        // A multibyte string literal before the subquery shifts byte offsets.
        let input = "SELECT Id FROM Account WHERE Name = '数据' AND Id IN (SELECT AccountId FROM Contact)";
        let spans = subquery_spans(input);
        assert_eq!(spans.len(), 1);
        let (s, e) = spans[0];
        assert_eq!(&input[s..e], "(SELECT AccountId FROM Contact)");
    }
}
