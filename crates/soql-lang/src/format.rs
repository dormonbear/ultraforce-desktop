//! SOQL pretty-printer.
//!
//! Puts each top-level clause on its own line and upper-cases keywords, and
//! additionally breaks *long* select-list subqueries onto indented multiple lines
//! so deeply nested child queries stay readable.
//!
//! Token-based (no AST) and paren-depth aware. A select-list subquery — a `(`
//! whose next token is SELECT, sitting in the enclosing SELECT's select list —
//! breaks onto its own indented block when its inline form exceeds 60 characters
//! or it contains a nested subquery; otherwise it stays inline. When a subquery
//! breaks, its clause keywords (FROM/WHERE/…) start new lines indented 4 spaces
//! per nesting depth, its own select-list subqueries each start on their own line,
//! and the closing paren stays attached to the last clause line. Semi-join /
//! anti-join subqueries in WHERE (`IN (SELECT …)`) always stay inline — only
//! select-list subqueries break.
//!
//! Long select-list *field* lists FILL-wrap: when the fields would push the line
//! past `MAX_WIDTH`, as many fields as fit are packed per line (comma-separated),
//! and each continuation line is indented one `INDENT` level deeper than the
//! query's clauses — the same indent broken subqueries use — so nested subquery
//! field lists wrap with their deeper indentation taken into account.
//!
//! Intra-clause whitespace collapses to single spaces (so a clause split across
//! lines rejoins), but text inside `'…'` literals is preserved exactly.
//! Idempotent.

use crate::lexer::{lex, Token, TokenKind};

const INDENT: usize = 4;
/// Inline width above which a select-list *subquery* breaks onto its own block.
const BREAK_WIDTH: usize = 60;
/// Max line width before a select-list *field* list FILL-wraps. Distinct from
/// `BREAK_WIDTH` (a subquery-break threshold, not a line width); no line-width
/// constant existed, so this uses the conventional 80.
const MAX_WIDTH: usize = 80;

/// Keywords that start a new clause (each goes on its own line).
/// `BY` is excluded — it stays attached to `GROUP` / `ORDER`.
fn is_clause_start(word: &str) -> bool {
    matches!(
        word.to_ascii_uppercase().as_str(),
        "FROM" | "WHERE" | "WITH" | "GROUP" | "ORDER" | "HAVING" | "LIMIT" | "OFFSET" | "FOR"
    )
}

/// A normalized, whitespace-free token: keywords upper-cased and `'…'` literals
/// merged verbatim. `space_before` records whether whitespace preceded it in the
/// source, which drives inline spacing.
#[derive(Clone, PartialEq, Eq)]
struct Atom {
    text: String,
    space_before: bool,
    kind: AtomKind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AtomKind {
    LParen,
    RParen,
    Keyword,
    Other,
}

fn is_select_atom(a: &Atom) -> bool {
    a.kind == AtomKind::Keyword && a.text == "SELECT"
}

/// Collapse the lexer's tokens into `Atom`s: drop whitespace (remembering it as
/// `space_before`), upper-case keywords, and merge each `'…'` literal into one
/// verbatim atom.
fn normalize(tokens: &[Token]) -> Vec<Atom> {
    let mut atoms = Vec::new();
    let mut pending_space = false;
    let mut i = 0;
    while i < tokens.len() {
        let t = &tokens[i];
        if t.kind == TokenKind::Whitespace {
            if !atoms.is_empty() {
                pending_space = true;
            }
            i += 1;
            continue;
        }
        // String literal: merge '...' verbatim (whitespace inside preserved).
        if t.kind == TokenKind::Other && t.text == "'" {
            let space_before = pending_space;
            pending_space = false;
            let mut text = String::from("'");
            i += 1;
            let mut prev_backslash = false;
            while i < tokens.len() {
                let u = &tokens[i];
                text.push_str(&u.text);
                i += 1;
                let is_quote = u.kind == TokenKind::Other && u.text == "'";
                if is_quote && !prev_backslash {
                    break;
                }
                prev_backslash = u.kind == TokenKind::Other && u.text == "\\";
            }
            atoms.push(Atom {
                text,
                space_before,
                kind: AtomKind::Other,
            });
            continue;
        }
        let kind = match t.kind {
            TokenKind::LParen => AtomKind::LParen,
            TokenKind::RParen => AtomKind::RParen,
            TokenKind::Keyword => AtomKind::Keyword,
            _ => AtomKind::Other,
        };
        let text = if t.kind == TokenKind::Keyword {
            t.text.to_ascii_uppercase()
        } else {
            t.text.clone()
        };
        atoms.push(Atom {
            text,
            space_before: pending_space,
            kind,
        });
        pending_space = false;
        i += 1;
    }
    atoms
}

/// Index of the `)` matching the `(` at `open` within `atoms`.
fn matching_paren(atoms: &[Atom], open: usize) -> usize {
    let mut depth = 0usize;
    for (k, a) in atoms.iter().enumerate().skip(open) {
        match a.kind {
            AtomKind::LParen => depth += 1,
            AtomKind::RParen => {
                depth -= 1;
                if depth == 0 {
                    return k;
                }
            }
            _ => {}
        }
    }
    atoms.len().saturating_sub(1)
}

/// Render `atoms` on a single line, joining with a space wherever the source had
/// whitespace.
fn inline_render(atoms: &[Atom]) -> String {
    let mut s = String::new();
    for (k, a) in atoms.iter().enumerate() {
        if k > 0 && a.space_before {
            s.push(' ');
        }
        s.push_str(&a.text);
    }
    s
}

/// Whether a select-list subquery (`child` includes its outer parens) should
/// break onto its own indented block: it contains a nested subquery, or its
/// inline form is wider than `BREAK_WIDTH`.
fn should_break(child: &[Atom]) -> bool {
    let inner = &child[1..child.len() - 1];
    let has_nested = inner
        .iter()
        .enumerate()
        .any(|(k, a)| a.kind == AtomKind::LParen && inner.get(k + 1).is_some_and(is_select_atom));
    has_nested || inline_render(child).chars().count() > BREAK_WIDTH
}

/// Render a query (`atoms[0]` is `SELECT`) at nesting level `u`. `parent_broken`
/// is true when this query is itself a broken subquery, in which case every one
/// of its select-list subqueries starts on its own line.
fn render_query(atoms: &[Atom], u: usize, parent_broken: bool) -> String {
    // Clause keywords at relative depth 0 begin new lines.
    let mut depth = 0i32;
    let mut clause_starts: Vec<usize> = Vec::new();
    for (k, a) in atoms.iter().enumerate() {
        match a.kind {
            AtomKind::LParen => depth += 1,
            AtomKind::RParen => depth -= 1,
            AtomKind::Keyword if depth == 0 && k > 0 && is_clause_start(&a.text) => {
                clause_starts.push(k);
            }
            _ => {}
        }
    }
    let first_clause = clause_starts.first().copied().unwrap_or(atoms.len());

    let mut out = String::from("SELECT");
    append_select_list(&mut out, &atoms[1..first_clause], u, parent_broken);

    let clause_indent = " ".repeat(INDENT * u);
    for (idx, &start) in clause_starts.iter().enumerate() {
        let end = clause_starts.get(idx + 1).copied().unwrap_or(atoms.len());
        out.push('\n');
        out.push_str(&clause_indent);
        out.push_str(&inline_render(&atoms[start..end]));
    }
    out
}

/// Column at which this query level's `SELECT` keyword sits: the root starts at
/// column 0; a broken subquery's `SELECT` is preceded by its indent and a `(`.
fn select_lead_col(u: usize) -> usize {
    if u == 0 {
        0
    } else {
        INDENT * u + 1
    }
}

/// Char width of the last line of `s` (everything after the final newline).
fn last_line_width(s: &str) -> usize {
    match s.rfind('\n') {
        Some(nl) => s[nl + 1..].chars().count(),
        None => s.chars().count(),
    }
}

/// Inline char width of the select-list field beginning at `items[start]`, up to
/// (excluding) the next top-level comma or the end of the list.
fn field_width(items: &[Atom], start: usize) -> usize {
    let mut depth = 0i32;
    let mut w = 0usize;
    for (k, a) in items.iter().enumerate().skip(start) {
        if depth == 0 && k > start && a.kind == AtomKind::Other && a.text == "," {
            break;
        }
        if k > start && a.space_before {
            w += 1;
        }
        w += a.text.chars().count();
        match a.kind {
            AtomKind::LParen => depth += 1,
            AtomKind::RParen => depth -= 1,
            _ => {}
        }
    }
    w
}

/// Append the select list to `out` (which already ends with `SELECT`), breaking
/// subqueries that must break (or all subqueries when `parent_broken`) onto their
/// own indented lines, and FILL-wrapping the field list once a line would exceed
/// `MAX_WIDTH`. Continuation lines use `child_indent` (one level deeper).
fn append_select_list(out: &mut String, items: &[Atom], u: usize, parent_broken: bool) {
    let child_indent = " ".repeat(INDENT * (u + 1));
    let cont_col = child_indent.chars().count();
    // The first line's true column includes the `(` prefix a subquery gets later.
    let mut col = select_lead_col(u) + last_line_width(out);
    let mut depth = 0i32;
    let mut after_top_comma = false;
    let mut i = 0;
    while i < items.len() {
        let a = &items[i];
        if a.kind == AtomKind::LParen && items.get(i + 1).is_some_and(is_select_atom) {
            let j = matching_paren(items, i);
            let child = &items[i..=j];
            let breaks = should_break(child);
            if breaks || parent_broken {
                out.push('\n');
                out.push_str(&child_indent);
                if breaks {
                    out.push_str(&render_broken_subquery(child, u + 1));
                } else {
                    out.push_str(&inline_render(child));
                }
                col = last_line_width(out);
            } else {
                let piece = inline_render(child);
                let wrap = after_top_comma
                    && a.space_before
                    && col + 1 + field_width(items, i) > MAX_WIDTH;
                if wrap {
                    out.push('\n');
                    out.push_str(&child_indent);
                    col = cont_col;
                } else if a.space_before {
                    out.push(' ');
                    col += 1;
                }
                out.push_str(&piece);
                col += piece.chars().count();
            }
            after_top_comma = false;
            i = j + 1;
        } else {
            let wrap = after_top_comma
                && depth == 0
                && a.space_before
                && col + 1 + field_width(items, i) > MAX_WIDTH;
            if wrap {
                out.push('\n');
                out.push_str(&child_indent);
                col = cont_col;
            } else if a.space_before {
                out.push(' ');
                col += 1;
            }
            out.push_str(&a.text);
            col += a.text.chars().count();
            match a.kind {
                AtomKind::LParen => depth += 1,
                AtomKind::RParen => depth -= 1,
                _ => {}
            }
            after_top_comma = depth == 0 && a.kind == AtomKind::Other && a.text == ",";
            i += 1;
        }
    }
}

/// Render a breaking subquery: `(` + the inner query broken across lines + `)`
/// attached to the last clause line.
fn render_broken_subquery(child: &[Atom], u: usize) -> String {
    let inner = &child[1..child.len() - 1];
    let mut s = String::from("(");
    s.push_str(&render_query(inner, u, true));
    s.push(')');
    s
}

/// Reformat `input`: every depth-0 clause keyword begins a new line, keywords are
/// upper-cased, and long select-list subqueries break onto indented lines.
///
/// Returns the input trimmed when there is no `SELECT` to structure, never
/// erroring.
pub fn format_soql(input: &str) -> String {
    let atoms = normalize(&lex(input));
    if atoms.is_empty() {
        return String::new();
    }
    if !is_select_atom(&atoms[0]) {
        return inline_render(&atoms).trim().to_string();
    }
    render_query(&atoms, 0, false)
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
        // Short subquery with no nesting -> stays inline on the SELECT line.
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
        // Child subquery is short with no nesting and a semi-join IN(...) lives in
        // WHERE, so both stay inline; only the outer clauses break.
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
    fn breaks_long_nested_select_list_subquery() {
        // User-approved example: the child subquery contains a nested subquery, so
        // it breaks; the nested subquery is short so it renders inline but on its
        // own indented line because its parent broke.
        let q = "SELECT Id, (SELECT FIELDS(All), (SELECT Id FROM ApprovalWorkItems) FROM License_Copy_Borrowing_Requests__r LIMIT 200) FROM Vendor_Contract__c LIMIT 1000";
        let expected = "SELECT Id,\n    \
             (SELECT FIELDS(All),\n        \
             (SELECT Id FROM ApprovalWorkItems)\n    \
             FROM License_Copy_Borrowing_Requests__r\n    \
             LIMIT 200)\n\
             FROM Vendor_Contract__c\n\
             LIMIT 1000";
        assert_eq!(format_soql(q), expected);
    }

    #[test]
    fn breaks_long_single_level_select_list_subquery() {
        // Over 60 chars inline, no nesting: breaks its own clauses but keeps its
        // (subquery-free) select list on the opening line.
        let q = "SELECT Id, (SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone FROM Contacts) FROM Account";
        let expected = "SELECT Id,\n    \
             (SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone\n    \
             FROM Contacts)\n\
             FROM Account";
        assert_eq!(format_soql(q), expected);
    }

    #[test]
    fn keeps_long_semi_join_in_where_inline() {
        // A long IN (SELECT ...) in WHERE never breaks — only select-list
        // subqueries do.
        let q = "SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE Email != null AND CreatedDate = TODAY AND MailingCity != null)";
        let expected = "SELECT Id\n\
             FROM Account\n\
             WHERE Id IN (SELECT AccountId FROM Contact WHERE Email != null AND CreatedDate = TODAY AND MailingCity != null)";
        assert_eq!(format_soql(q), expected);
    }

    #[test]
    fn is_idempotent() {
        let q = "SELECT Id FROM Account WHERE Name = 'x' LIMIT 5";
        let once = format_soql(q);
        assert_eq!(format_soql(&once), once);
    }

    #[test]
    fn broken_subquery_is_idempotent() {
        let q = "SELECT Id, (SELECT FIELDS(All), (SELECT Id FROM ApprovalWorkItems) FROM License_Copy_Borrowing_Requests__r LIMIT 200) FROM Vendor_Contract__c LIMIT 1000";
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

    #[test]
    fn short_field_list_stays_single_line() {
        let q = "SELECT Id, Name, Email, Phone FROM Account";
        assert_eq!(
            format_soql(q),
            "SELECT Id, Name, Email, Phone\nFROM Account"
        );
    }

    #[test]
    fn fill_wraps_long_root_field_list() {
        let q = "SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone, AccountId, OwnerId, CreatedDate, LastModifiedDate FROM Account";
        let expected = "SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone, AccountId, OwnerId,\n    \
             CreatedDate, LastModifiedDate\n\
             FROM Account";
        assert_eq!(format_soql(q), expected);
    }

    #[test]
    fn fill_wraps_long_subquery_field_list_with_nested_indent() {
        let q = "SELECT Id, (SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone, AccountId, Department, Title, Birthdate FROM Contacts) FROM Account";
        let expected = "SELECT Id,\n    \
             (SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone, AccountId,\n        \
             Department, Title, Birthdate\n    \
             FROM Contacts)\n\
             FROM Account";
        assert_eq!(format_soql(q), expected);
    }

    #[test]
    fn fill_wrapped_field_list_is_idempotent() {
        let root = "SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone, AccountId, OwnerId, CreatedDate, LastModifiedDate FROM Account";
        let once = format_soql(root);
        assert_eq!(format_soql(&once), once);

        let sub = "SELECT Id, (SELECT Id, Name, Email, Phone, Fax, Website, MobilePhone, AccountId, Department, Title, Birthdate FROM Contacts) FROM Account";
        let once_sub = format_soql(sub);
        assert_eq!(format_soql(&once_sub), once_sub);
    }
}
