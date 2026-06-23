//! Local variable / parameter declarations harvested from the CST, used to
//! resolve a receiver name to its declared type during completion. Simpler than
//! true scoping: every local_variable_declaration and formal_parameter in the
//! file is collected (good enough for single-method anonymous Apex).

use tree_sitter::Tree;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CstLocal {
    pub name: String,
    pub declared_type: String,
}

/// Collect all local var + parameter declarations in the tree.
pub fn locals(tree: &Tree, src: &str) -> Vec<CstLocal> {
    let mut out = Vec::new();
    let root = tree.root_node();
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "local_variable_declaration" | "formal_parameter" => {
                if let (Some(ty), Some(name)) =
                    (n.child_by_field_name("type"), declared_name(n))
                {
                    out.push(CstLocal {
                        name: text(name, src),
                        declared_type: text(ty, src),
                    });
                }
            }
            _ => {}
        }
        for i in 0..n.child_count() {
            stack.push(n.child(i as u32).unwrap());
        }
    }
    out
}

fn declared_name(n: tree_sitter::Node) -> Option<tree_sitter::Node> {
    // formal_parameter has a `name` field directly; local_variable_declaration
    // wraps a variable_declarator whose `name` field is the identifier.
    if let Some(name) = n.child_by_field_name("name") {
        return Some(name);
    }
    // Seed DFS with direct children only — avoids re-processing `n` itself
    // and prevents returning a wrong nested name from deeper subtrees.
    let mut stack: Vec<tree_sitter::Node> = (0..n.child_count())
        .map(|i| n.child(i as u32).unwrap())
        .collect();
    while let Some(c) = stack.pop() {
        if c.kind() == "variable_declarator" {
            // Return immediately on the first declarator found.
            return c.child_by_field_name("name");
        }
        for i in 0..c.child_count() {
            stack.push(c.child(i as u32).unwrap());
        }
    }
    None
}

fn text(node: tree_sitter::Node, src: &str) -> String {
    node.utf8_text(src.as_bytes()).unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cst::parse;

    #[test]
    fn collects_local_and_param_types() {
        let src = "void m(Account a) { List<Account> rows = null; }";
        let locs = locals(&parse(src), src);
        assert!(locs.iter().any(|l| l.name == "a" && l.declared_type == "Account"));
        assert!(locs
            .iter()
            .any(|l| l.name == "rows" && l.declared_type == "List<Account>"));
    }
}
