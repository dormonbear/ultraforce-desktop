//! Caret-position classification on the CST — the IC2 analog of walking PSI
//! ancestors to the nearest registered completion-context node.

use crate::cst::{find_ancestor, node_at_offset, node_text};
use tree_sitter::{Node, Tree};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionContext {
    /// Naming a new variable after its type: offer names, never types.
    DeclaratorName { type_text: String },
    /// After `.`/`?.`: offer members of the receiver's type.
    Member { receiver_text: String },
    /// Only type names (new / extends / implements / generic args / type slot).
    TypeOnly,
    /// After `@`: annotation names.
    Annotation,
    /// Expression position: locals + types + expression keywords.
    Expression,
    /// Statement boundary: statement/decl/modifier keywords + types + locals.
    StatementStart,
    /// Inside an inline `[ … ]` SOQL/SOSL query.
    Soql,
    /// Nothing to offer.
    Unknown,
}

/// Classify the caret at `prefix_start` (the start byte of the identifier under
/// the caret, so we land inside the token being typed).
pub fn classify(tree: &Tree, src: &str, prefix_start: usize) -> CompletionContext {
    let node = node_at_offset(tree, prefix_start);

    // Member access — two representations in this grammar:
    //   1. Complete: field_access (object/field fields) — e.g. `obj.field` in expr position
    //   2. Error-tolerant partial: scoped_type_identifier (two type_identifier children joined by `.`)
    //      The grammar reinterprets `acc.nam` as a qualified type name when incomplete.
    if let Some(fa) = find_ancestor(node, &["field_access"]) {
        if let Some(obj) = fa.child_by_field_name("object") {
            if prefix_start >= obj.end_byte() {
                return CompletionContext::Member {
                    receiver_text: node_text(obj, src).to_string(),
                };
            }
        }
    }
    if let Some(scoped) = find_ancestor(node, &["scoped_type_identifier"]) {
        // scoped_type_identifier children: type_identifier `.` type_identifier
        // The first named child is the receiver.
        if let Some(first) = scoped.named_child(0) {
            if prefix_start >= first.end_byte() {
                return CompletionContext::Member {
                    receiver_text: node_text(first, src).to_string(),
                };
            }
        }
    }

    // Inline SOQL/SOSL — complete or error-tolerant.
    // When complete: query_expression wraps the `[ ... ]` brackets.
    // When partially typed: the grammar sees select_clause / soql_literal as a bare ERROR child.
    // Also do a text-based check: look for an unmatched `[` before the caret in the prefix.
    if find_ancestor(node, &["query_expression", "select_clause", "soql_literal"]).is_some()
        || has_open_soql_bracket(src, prefix_start)
    {
        return CompletionContext::Soql;
    }

    // Annotation (after `@`).
    if find_ancestor(node, &["annotation", "marker_annotation"]).is_some() {
        return CompletionContext::Annotation;
    }

    // Variable-declaration name vs type slot.
    if let Some(decl) = find_ancestor(node, &["local_variable_declaration", "formal_parameter"]) {
        if let Some(ty) = decl.child_by_field_name("type") {
            if prefix_start >= ty.end_byte() {
                return CompletionContext::DeclaratorName {
                    type_text: node_text(ty, src).to_string(),
                };
            }
            // caret inside the type itself
            return CompletionContext::TypeOnly;
        }
    }

    // Type-only positions — structural.
    if find_ancestor(node, &["superclass", "interfaces", "type_arguments", "type_parameter"]).is_some()
    {
        return CompletionContext::TypeOnly;
    }
    // `new Acc` — complete form.
    if let Some(oce) = find_ancestor(node, &["object_creation_expression"]) {
        if let Some(ty) = oce.child_by_field_name("type") {
            if prefix_start <= ty.end_byte() {
                return CompletionContext::TypeOnly;
            }
        }
    }
    // `new Acc` — error-tolerant fallback: scan backward for bare `new` keyword.
    // Use the node's actual start byte (not prefix_start which may be at EOF when test-driving).
    let token_start = node.start_byte().min(prefix_start);
    if has_new_keyword_before(src, token_start) {
        return CompletionContext::TypeOnly;
    }

    // Expression vs statement-start.
    if in_expression(node) {
        return CompletionContext::Expression;
    }
    if find_ancestor(node, &["block", "parser_output"]).is_some() {
        return CompletionContext::StatementStart;
    }

    CompletionContext::Unknown
}

/// Returns true when there is an unmatched `[` in the source before `prefix_start`
/// AND the content after that `[` begins with a SOQL/SOSL keyword (`SELECT` or `FIND`).
/// This prevents array indexing like `arr[0` from being misclassified as SOQL.
fn has_open_soql_bracket(src: &str, prefix_start: usize) -> bool {
    let prefix = &src[..prefix_start.min(src.len())];
    // Walk backward tracking bracket depth; record position of each `[`.
    let bytes = prefix.as_bytes();
    let mut depth: i32 = 0;
    let mut open_pos: Option<usize> = None;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'[' => {
                depth += 1;
                open_pos = Some(i);
            }
            b']' => {
                depth -= 1;
                if depth < 1 {
                    open_pos = None;
                }
            }
            _ => {}
        }
    }
    if depth <= 0 {
        return false;
    }
    // We have an unmatched `[`. Check that the first non-whitespace word after it
    // is SELECT or FIND (case-insensitive) — indicating an inline SOQL/SOSL query.
    if let Some(pos) = open_pos {
        let after = &prefix[pos + 1..];
        let first_word: &str = after.trim_start().split(|c: char| c.is_whitespace()).next().unwrap_or("");
        let upper = first_word.to_ascii_uppercase();
        upper == "SELECT" || upper == "FIND"
    } else {
        false
    }
}

/// Returns true when the token immediately before the caret (ignoring whitespace)
/// is the keyword `new`, indicating a `new TypeName` construction position.
fn has_new_keyword_before(src: &str, prefix_start: usize) -> bool {
    let prefix = &src[..prefix_start.min(src.len())];
    // Trim the current identifier being typed (already at prefix_start), then trim whitespace.
    let before = prefix.trim_end();
    // Check if it ends with the keyword `new` preceded by a non-word boundary.
    before.ends_with("new")
        && before
            .as_bytes()
            .get(before.len().wrapping_sub(4))
            .map_or(true, |&b| !b.is_ascii_alphanumeric() && b != b'_')
}

fn in_expression(node: Node) -> bool {
    find_ancestor(
        node,
        &[
            "assignment_expression",
            "binary_expression",
            "ternary_expression",
            "instanceof_expression",
            "unary_expression",
            "argument_list",
            "parenthesized_expression",
            "return_statement",
            "expression_statement",
        ],
    )
    .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cst::parse;

    fn ctx(src: &str) -> CompletionContext {
        // prefix_start = end of src (caret at EOF, prefix already typed there)
        classify(&parse(src), src, src.len())
    }

    #[test]
    fn declarator_name_position() {
        assert_eq!(
            ctx("List<Account> accou"),
            CompletionContext::DeclaratorName { type_text: "List<Account>".into() }
        );
    }

    #[test]
    fn type_position_after_new() {
        assert_eq!(ctx("Object o = new Acc"), CompletionContext::TypeOnly);
    }

    #[test]
    fn member_after_dot() {
        match ctx("void m(){ acc.nam") {
            CompletionContext::Member { receiver_text } => assert_eq!(receiver_text, "acc"),
            other => panic!("expected Member, got {other:?}"),
        }
    }

    #[test]
    fn soql_inside_brackets() {
        assert_eq!(ctx("List<Account> a = [SELECT Id FR"), CompletionContext::Soql);
    }

    #[test]
    fn array_index_is_not_soql() {
        // `arr[0` is array indexing, not an inline SOQL query.
        assert_ne!(ctx("void m(){ String[] arr; arr[0"), CompletionContext::Soql);
    }

}
