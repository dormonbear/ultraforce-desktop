//! Minimal SOQL pretty-printer: put each top-level clause on its own line.
//!
//! Token-based and paren-depth aware, so subquery clauses stay inline. Only
//! clause breaks are restructured — intra-clause text (field lists, spacing in
//! a `WHERE`) is preserved as the user wrote it. Idempotent.

use crate::lexer::{lex, TokenKind};

/// Keywords that start a new top-level clause (each goes on its own line).
/// `BY` is excluded — it stays attached to `GROUP` / `ORDER`.
fn is_clause_start(word: &str) -> bool {
    matches!(
        word.to_ascii_uppercase().as_str(),
        "FROM" | "WHERE" | "WITH" | "GROUP" | "ORDER" | "HAVING" | "LIMIT" | "OFFSET" | "FOR"
    )
}

/// Reformat `input` so every depth-0 clause keyword begins a new line.
///
/// Returns the input trimmed when there is no structure to format (e.g. no
/// clause keywords), never erroring.
pub fn format_soql(input: &str) -> String {
    let tokens = lex(input);
    let mut depth: i32 = 0;
    let mut seen_token = false;
    let mut out = String::with_capacity(input.len() + 8);
    let mut last_end = 0usize;

    for t in &tokens {
        match t.kind {
            TokenKind::LParen => depth += 1,
            TokenKind::RParen => depth -= 1,
            TokenKind::Keyword if depth == 0 && seen_token && is_clause_start(&t.text) => {
                // Flush text before this keyword, drop the gap, start a new line.
                out.push_str(input[last_end..t.start].trim_end());
                out.push('\n');
                last_end = t.start;
            }
            _ => {}
        }
        if t.kind != TokenKind::Whitespace {
            seen_token = true;
        }
    }
    out.push_str(&input[last_end..]);
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaks_top_level_clauses_onto_their_own_lines() {
        let q = "SELECT Id, Name FROM Account WHERE Id != null ORDER BY Name LIMIT 10";
        assert_eq!(
            format_soql(q),
            "SELECT Id, Name\nFROM Account\nWHERE Id != null\nORDER BY Name\nLIMIT 10"
        );
    }

    #[test]
    fn keeps_subquery_clauses_inline() {
        let q = "SELECT Id, (SELECT Id FROM Contacts) FROM Account";
        // The subquery's FROM is at depth 1 -> not broken; the outer FROM is.
        assert_eq!(
            format_soql(q),
            "SELECT Id, (SELECT Id FROM Contacts)\nFROM Account"
        );
    }

    #[test]
    fn is_idempotent() {
        let q = "SELECT Id FROM Account WHERE Name = 'x' LIMIT 5";
        let once = format_soql(q);
        assert_eq!(format_soql(&once), once);
    }

    #[test]
    fn collapses_existing_newlines_before_clauses() {
        let q = "SELECT Id\n\n   FROM Account   \n  WHERE Id != null";
        assert_eq!(format_soql(q), "SELECT Id\nFROM Account\nWHERE Id != null");
    }

    #[test]
    fn no_clauses_returns_trimmed_input() {
        assert_eq!(format_soql("  SELECT Id  "), "SELECT Id");
        assert_eq!(format_soql(""), "");
    }
}
