//! Minimal SOQL pretty-printer: put each top-level clause on its own line and
//! upper-case keywords.
//!
//! Token-based and paren-depth aware, so subquery clauses stay inline.
//! Intra-clause whitespace is collapsed to single spaces (so a clause split
//! across lines rejoins), but text inside `'...'` literals is preserved exactly.
//! Idempotent.

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
    // The lexer has no string token, so track quote state here: whitespace and
    // keywords inside a '...' literal must be left exactly as written.
    let mut in_string = false;
    let mut prev_backslash = false;
    let mut out = String::with_capacity(input.len() + 8);

    for t in &tokens {
        let is_quote = t.kind == TokenKind::Other && t.text == "'";
        if is_quote && !prev_backslash {
            in_string = !in_string;
        }

        if in_string {
            // Inside a literal: emit verbatim, no casing or structure changes.
            out.push_str(&t.text);
            seen_token = true;
            prev_backslash = t.kind == TokenKind::Other && t.text == "\\";
            continue;
        }

        if t.kind == TokenKind::Whitespace {
            // Collapse intra-clause whitespace to one space; a following clause
            // keyword turns that space into a line break.
            if seen_token {
                out.push(' ');
            }
            prev_backslash = false;
            continue;
        }

        match t.kind {
            TokenKind::LParen => depth += 1,
            TokenKind::RParen => depth -= 1,
            _ => {}
        }

        // Start a new line before each depth-0 clause keyword.
        if t.kind == TokenKind::Keyword && depth == 0 && seen_token && is_clause_start(&t.text) {
            out.truncate(out.trim_end().len());
            out.push('\n');
        }

        match t.kind {
            // Keywords upper-cased everywhere (including inside subqueries).
            TokenKind::Keyword => out.push_str(&t.text.to_ascii_uppercase()),
            _ => out.push_str(&t.text),
        }

        seen_token = true;
        prev_backslash = t.kind == TokenKind::Other && t.text == "\\";
    }
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
    fn rejoins_clause_split_across_lines() {
        // A clause keyword and its body on separate lines collapse back together.
        let q = "SELECT\nFIELDS(all)\nFROM Maycur_Form__c\nWHERE\nForm_Code__c = 'x'";
        assert_eq!(
            format_soql(q),
            "SELECT FIELDS(all)\nFROM Maycur_Form__c\nWHERE Form_Code__c = 'x'"
        );
    }

    #[test]
    fn preserves_whitespace_inside_string_literals() {
        let q = "select Id from Account where Name = 'John  Doe'";
        assert_eq!(
            format_soql(q),
            "SELECT Id\nFROM Account\nWHERE Name = 'John  Doe'"
        );
    }

    #[test]
    fn upper_cases_keywords_only() {
        // Lowercase keywords are raised; FIELDS()/field names are left alone.
        let q = "select FIELDS(all) from Maycur_Form__c where Form_Code__c = 'x' order by Created_At__c limit 200";
        assert_eq!(
            format_soql(q),
            "SELECT FIELDS(all)\nFROM Maycur_Form__c\nWHERE Form_Code__c = 'x'\nORDER BY Created_At__c\nLIMIT 200"
        );
    }

    #[test]
    fn complex_query_keeps_nested_clauses_inline() {
        // Child subquery and a semi-join IN(...) live at depth > 0, so their
        // clauses stay inline; only the outer clauses break.
        let q = "select id, (select id from contacts where lastname = 'a') from account where id in (select accountid from opportunity) order by name limit 5";
        assert_eq!(
            format_soql(q),
            "SELECT id, (SELECT id FROM contacts WHERE lastname = 'a')\n\
             FROM account\n\
             WHERE id IN (SELECT accountid FROM opportunity)\n\
             ORDER BY name\n\
             LIMIT 5"
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
