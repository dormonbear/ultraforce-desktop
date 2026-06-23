//! tree-sitter CST layer for Apex. The apex grammar's root is
//! `parser_output = repeat(statement)`, so the same entry parses anonymous
//! Apex (bare statements) and full class files. Error-tolerant: parse never
//! fails; incomplete input yields a tree with ERROR/MISSING nodes.

use tree_sitter::{Parser, Tree};

/// Parse Apex source into a CST. Never fails for non-cancelled parses.
pub fn parse(src: &str) -> Tree {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_sfapex::apex::LANGUAGE.into())
        .expect("load apex grammar");
    parser.parse(src, None).expect("apex parse returned None")
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
}
