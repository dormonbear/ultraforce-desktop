//! tree-sitter CST layer for Apex. The apex grammar's root is
//! `parser_output = repeat(statement)`, so the same entry parses anonymous
//! Apex (bare statements) and full class files. Error-tolerant: parse never
//! fails; incomplete input yields a tree with ERROR/MISSING nodes.

use tree_sitter::{Node, Parser, Tree};

/// Parse Apex source into a CST. Never fails for non-cancelled parses.
pub fn parse(src: &str) -> Tree {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_sfapex::apex::LANGUAGE.into())
        .expect("load apex grammar");
    parser.parse(src, None).expect("apex parse returned None")
}

/// The deepest named node containing `offset` (clamped to the source length).
/// Lands inside the token under the caret so callers can read its kind/ancestry.
/// Biases one byte left at a token's trailing edge so a just-typed identifier
/// resolves to the identifier node, not its parent.
pub fn node_at_offset(tree: &Tree, offset: usize) -> Node {
    let root = tree.root_node();
    let len = root.end_byte();
    let at = offset.min(len);
    // Try the exact position first (handles caret at a token's start).
    // Fall back to at-1 to handle caret at a token's trailing edge.
    let probe_fwd = root
        .named_descendant_for_byte_range(at, at + 1)
        .or_else(|| root.descendant_for_byte_range(at, at + 1));
    if let Some(n) = probe_fwd {
        if n != root || at == 0 {
            return n;
        }
    }
    // Bias one byte left.
    let probe = if at > 0 { at - 1 } else { at };
    root.named_descendant_for_byte_range(probe, at)
        .or_else(|| root.descendant_for_byte_range(probe, at))
        .unwrap_or(root)
}

/// Walk up from `node` (inclusive) to the nearest ancestor whose kind is in
/// `kinds`.
pub fn find_ancestor<'a>(node: Node<'a>, kinds: &[&str]) -> Option<Node<'a>> {
    let mut cur = Some(node);
    while let Some(n) = cur {
        if kinds.contains(&n.kind()) {
            return Some(n);
        }
        cur = n.parent();
    }
    None
}

/// The source text a node spans.
pub fn node_text<'a>(node: Node, src: &'a str) -> &'a str {
    node.utf8_text(src.as_bytes()).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_anonymous_block() {
        let tree = parse("Integer x = 1; System.debug(x);");
        assert_eq!(tree.root_node().kind(), "parser_output");
        assert!(!tree.root_node().has_error());
    }

    #[test]
    fn parses_class_file() {
        let tree = parse("public class Foo { void bar() {} }");
        assert!(!tree.root_node().has_error());
    }

    #[test]
    fn tolerates_incomplete_declaration() {
        // The spike: `List<Account> accou` while typing must still produce a
        // local_variable_declaration with a `type` field.
        let tree = parse("List<Account> accou");
        let root = tree.root_node();
        // Find the local_variable_declaration anywhere in the tree.
        let mut cursor = root.walk();
        let mut found_type = None;
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == "local_variable_declaration" {
                if let Some(t) = n.child_by_field_name("type") {
                    found_type = Some(t.utf8_text("List<Account> accou".as_bytes()).unwrap().to_string());
                }
            }
            for i in 0..n.child_count() {
                stack.push(n.child(i as u32).unwrap());
            }
        }
        let _ = &mut cursor;
        assert_eq!(found_type.as_deref(), Some("List<Account>"));
    }

    #[test]
    fn node_at_offset_lands_in_token() {
        let src = "Integer x = 1;";
        let tree = parse(src);
        // offset at the start of `x`
        let off = src.find('x').unwrap();
        let node = node_at_offset(&tree, off);
        assert!(node.kind() == "identifier");
    }

    #[test]
    fn find_ancestor_walks_up() {
        let src = "void m() { Integer x = 1; }";
        let tree = parse(src);
        let off = src.find("x =").unwrap();
        let node = node_at_offset(&tree, off);
        let decl = find_ancestor(node, &["local_variable_declaration"]);
        assert!(decl.is_some());
        assert_eq!(
            node_text(decl.unwrap().child_by_field_name("type").unwrap(), src),
            "Integer"
        );
    }
}
