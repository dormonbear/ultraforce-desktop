//! Scope & binding resolution (Phase 3). Given a cursor offset inside a method
//! body, computes which names are in scope — class fields/properties, method
//! params, and locals declared (textually before the cursor) in enclosing
//! blocks — and their [`Type`]s. Nearer declarations shadow outer ones.

use super::tree::*;
use super::types::Type;

/// A name visible in scope with its declared type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub name: String,
    pub ty: Type,
}

/// Bindings visible at byte offset `cursor` inside `method` of `class`, ordered
/// outer → inner (so the last match in [`resolve`] is the nearest declaration).
pub fn bindings_at(class: &TypeDecl, method: &MethodDecl, cursor: usize) -> Vec<Binding> {
    let mut out = Vec::new();

    // Class fields + properties.
    for m in &class.members {
        match m {
            Member::Field(f) => out.push(Binding {
                name: f.name.clone(),
                ty: Type::parse(&f.ty),
            }),
            Member::Property(p) => out.push(Binding {
                name: p.name.clone(),
                ty: Type::parse(&p.ty),
            }),
            _ => {}
        }
    }

    // Method parameters.
    for p in &method.params {
        out.push(Binding {
            name: p.name.clone(),
            ty: Type::parse(&p.ty),
        });
    }

    // Locals declared before the cursor in enclosing blocks.
    if let Some(body) = &method.body {
        collect_block(body, cursor, &mut out);
    }
    out
}

/// The type bound to `name` here — the nearest (last-declared) binding wins.
pub fn resolve<'a>(bindings: &'a [Binding], name: &str) -> Option<&'a Type> {
    bindings
        .iter()
        .rev()
        .find(|b| b.name.eq_ignore_ascii_case(name))
        .map(|b| &b.ty)
}

fn contains(span: Span, cursor: usize) -> bool {
    span.start <= cursor && cursor <= span.end
}

fn collect_block(block: &Block, cursor: usize, out: &mut Vec<Binding>) {
    for stmt in &block.stmts {
        // A statement starting at or after the cursor isn't in scope yet (a decl
        // is not visible within or before itself).
        if stmt.span().start >= cursor {
            break;
        }
        collect_stmt(stmt, cursor, out);
    }
}

fn collect_stmt(stmt: &Stmt, cursor: usize, out: &mut Vec<Binding>) {
    match stmt {
        Stmt::LocalVar { ty, decls, .. } => {
            for (name, _) in decls {
                out.push(Binding {
                    name: name.clone(),
                    ty: Type::parse(ty),
                });
            }
        }
        Stmt::Block(b) => {
            if contains(b.span, cursor) {
                collect_block(b, cursor, out);
            }
        }
        Stmt::If { then, els, .. } => {
            if contains(then.span(), cursor) {
                collect_stmt(then, cursor, out);
            }
            if let Some(e) = els {
                if contains(e.span(), cursor) {
                    collect_stmt(e, cursor, out);
                }
            }
        }
        Stmt::While { body, .. } | Stmt::DoWhile { body, .. } => {
            if contains(body.span(), cursor) {
                collect_stmt(body, cursor, out);
            }
        }
        Stmt::For {
            init, body, span, ..
        } => {
            if contains(*span, cursor) {
                if let Some(init) = init {
                    collect_stmt(init, cursor, out); // the loop variable
                }
                if contains(body.span(), cursor) {
                    collect_stmt(body, cursor, out);
                }
            }
        }
        Stmt::ForEach {
            ty,
            name,
            body,
            span,
            ..
        } => {
            if contains(*span, cursor) {
                out.push(Binding {
                    name: name.clone(),
                    ty: Type::parse(ty),
                });
                if contains(body.span(), cursor) {
                    collect_stmt(body, cursor, out);
                }
            }
        }
        Stmt::Try {
            block,
            catches,
            finally,
            ..
        } => {
            if contains(block.span, cursor) {
                collect_block(block, cursor, out);
            }
            for c in catches {
                if contains(c.block.span, cursor) {
                    out.push(Binding {
                        name: c.name.clone(),
                        ty: Type::parse(&c.ty),
                    });
                    collect_block(&c.block, cursor, out);
                }
            }
            if let Some(f) = finally {
                if contains(f.span, cursor) {
                    collect_block(f, cursor, out);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::super::parser::parse;
    use super::super::types::Primitive;
    use super::*;

    /// Parse one class with one method `m`, returning (class, method) and the
    /// byte offset of the `|` marker in `src` (with the marker stripped).
    fn at(src: &str) -> (TypeDecl, MethodDecl, usize) {
        let cursor = src.find('|').expect("marker");
        let cleaned = src.replacen('|', "", 1);
        let cu = parse(&cleaned);
        let class = cu.types[0].clone();
        let method = class
            .members
            .iter()
            .find_map(|m| match m {
                Member::Method(m) if m.name == "m" => Some(m.clone()),
                _ => None,
            })
            .expect("method m");
        (class, method, cursor)
    }

    fn names(b: &[Binding]) -> Vec<&str> {
        b.iter().map(|x| x.name.as_str()).collect()
    }

    #[test]
    fn fields_and_params_are_visible() {
        let (c, m, cur) = at("class C { Integer total; void m(String arg) { |return; } }");
        let b = bindings_at(&c, &m, cur);
        assert!(names(&b).contains(&"total"));
        assert!(names(&b).contains(&"arg"));
        assert_eq!(
            resolve(&b, "total"),
            Some(&Type::Primitive(Primitive::Integer))
        );
        assert_eq!(
            resolve(&b, "arg"),
            Some(&Type::Primitive(Primitive::String))
        );
    }

    #[test]
    fn local_visible_only_after_its_declaration() {
        let before = at("class C { void m() { |Account a; } }");
        assert!(!names(&bindings_at(&before.0, &before.1, before.2)).contains(&"a"));
        let after = at("class C { void m() { Account a; |} }");
        let b = bindings_at(&after.0, &after.1, after.2);
        assert!(names(&b).contains(&"a"));
        assert_eq!(resolve(&b, "a"), Some(&Type::Named("Account".to_string())));
    }

    #[test]
    fn for_each_var_scoped_to_body() {
        let inside = at("class C { void m() { for (Account a : accts) { |a.x; } } }");
        assert!(names(&bindings_at(&inside.0, &inside.1, inside.2)).contains(&"a"));
        let outside = at("class C { void m() { for (Account a : accts) { a.x; } |} }");
        assert!(!names(&bindings_at(&outside.0, &outside.1, outside.2)).contains(&"a"));
    }

    #[test]
    fn nested_block_local_not_visible_outside() {
        let (c, m, cur) =
            at("class C { void m() { if (b) { Integer inner = 1; } |Integer outer; } }");
        let b = bindings_at(&c, &m, cur);
        assert!(!names(&b).contains(&"inner"), "{:?}", names(&b));
    }

    #[test]
    fn nearer_declaration_shadows() {
        // The local `x` shadows the field `x`.
        let (c, m, cur) = at("class C { String x; void m() { Integer x = 1; |x.toString(); } }");
        let b = bindings_at(&c, &m, cur);
        assert_eq!(resolve(&b, "x"), Some(&Type::Primitive(Primitive::Integer)));
    }

    #[test]
    fn catch_var_visible_in_catch_block() {
        let (c, m, cur) =
            at("class C { void m() { try { risky(); } catch (DmlException e) { |log(e); } } }");
        let b = bindings_at(&c, &m, cur);
        assert_eq!(
            resolve(&b, "e"),
            Some(&Type::Named("DmlException".to_string()))
        );
    }
}
