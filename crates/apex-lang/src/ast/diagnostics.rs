//! AST-based diagnostics (Phase 5). Conservative by design — Apex symbol info is
//! often partial, so we only flag what we're confident is wrong:
//!   1. Duplicate variable declarations (pure AST, zero false positives).
//!   2. Unknown field/property access on a *populated* org type (gated to avoid
//!      stub/partial-symbol-table false positives; method calls are never flagged).

use std::collections::HashSet;

use super::infer::{infer, InferCtx};
use super::scope::bindings_at;
use super::tree::*;
use super::types::Type;
use crate::symbols::{ApexType, Ost};

/// Diagnostic severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

/// A diagnostic with a byte span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub message: String,
    pub span: Span,
    pub severity: Severity,
}

/// Diagnose every method of `class`.
pub fn diagnose(class: &TypeDecl, ost: &Ost) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for m in &class.members {
        if let Member::Method(method) = m {
            check_duplicate_decls(method, &mut out);
            check_unknown_members(class, method, ost, &mut out);
        }
    }
    out
}

// ---- 1. Duplicate variable declarations ----

fn check_duplicate_decls(method: &MethodDecl, out: &mut Vec<Diagnostic>) {
    // Base scope = parameters. (A local *may* shadow a field in Apex, so fields
    // are intentionally excluded.)
    let mut stack: Vec<HashSet<String>> = vec![method
        .params
        .iter()
        .map(|p| p.name.to_ascii_lowercase())
        .collect()];
    if let Some(body) = &method.body {
        for stmt in &body.stmts {
            dup_stmt(stmt, &mut stack, out);
        }
    }
}

fn declare(name: &str, span: Span, stack: &mut [HashSet<String>], out: &mut Vec<Diagnostic>) {
    let lname = name.to_ascii_lowercase();
    if stack.iter().any(|s| s.contains(&lname)) {
        out.push(Diagnostic {
            message: format!("Duplicate variable: {name}"),
            span,
            severity: Severity::Error,
        });
    } else if let Some(top) = stack.last_mut() {
        top.insert(lname);
    }
}

fn dup_block(block: &Block, stack: &mut Vec<HashSet<String>>, out: &mut Vec<Diagnostic>) {
    stack.push(HashSet::new());
    for stmt in &block.stmts {
        dup_stmt(stmt, stack, out);
    }
    stack.pop();
}

fn dup_stmt(stmt: &Stmt, stack: &mut Vec<HashSet<String>>, out: &mut Vec<Diagnostic>) {
    match stmt {
        Stmt::LocalVar { decls, span, .. } => {
            for (name, _) in decls {
                declare(name, *span, stack, out);
            }
        }
        Stmt::Block(b) => dup_block(b, stack, out),
        Stmt::If { then, els, .. } => {
            dup_stmt(then, stack, out);
            if let Some(e) = els {
                dup_stmt(e, stack, out);
            }
        }
        Stmt::While { body, .. } | Stmt::DoWhile { body, .. } => dup_stmt(body, stack, out),
        Stmt::For {
            init, body, span, ..
        } => {
            stack.push(HashSet::new());
            if let Some(init) = init {
                // `for (Integer i = 0; …)` declares i in the loop scope.
                if let Stmt::LocalVar { decls, .. } = &**init {
                    for (name, _) in decls {
                        declare(name, *span, stack, out);
                    }
                }
            }
            dup_stmt(body, stack, out);
            stack.pop();
        }
        Stmt::ForEach {
            name, body, span, ..
        } => {
            stack.push(HashSet::new());
            declare(name, *span, stack, out);
            dup_stmt(body, stack, out);
            stack.pop();
        }
        Stmt::Try {
            block,
            catches,
            finally,
            ..
        } => {
            dup_block(block, stack, out);
            for c in catches {
                stack.push(HashSet::new());
                declare(&c.name, c.block.span, stack, out);
                for s in &c.block.stmts {
                    dup_stmt(s, stack, out);
                }
                stack.pop();
            }
            if let Some(f) = finally {
                dup_block(f, stack, out);
            }
        }
        _ => {}
    }
}

// ---- 2. Unknown field/property access on a populated org type ----

fn is_populated(at: &ApexType) -> bool {
    !at.methods.is_empty() || !at.properties.is_empty() || !at.enum_values.is_empty()
}

fn check_unknown_members(
    class: &TypeDecl,
    method: &MethodDecl,
    ost: &Ost,
    out: &mut Vec<Diagnostic>,
) {
    // Use the full set of locals/params/fields for type lookup.
    let bindings = bindings_at(class, method, usize::MAX);
    let ctx = InferCtx {
        bindings: &bindings,
        ost,
        this_type: &class.name,
    };
    if let Some(body) = &method.body {
        for stmt in &body.stmts {
            mem_stmt(stmt, &ctx, out);
        }
    }
}

fn mem_stmt(stmt: &Stmt, ctx: &InferCtx, out: &mut Vec<Diagnostic>) {
    match stmt {
        Stmt::LocalVar { decls, .. } => {
            for (_, init) in decls {
                if let Some(e) = init {
                    mem_expr(e, ctx, out);
                }
            }
        }
        Stmt::Expr(e) | Stmt::Throw(e, _) | Stmt::Dml { expr: e, .. } => mem_expr(e, ctx, out),
        Stmt::Return(Some(e), _) => mem_expr(e, ctx, out),
        Stmt::If {
            cond, then, els, ..
        } => {
            mem_expr(cond, ctx, out);
            mem_stmt(then, ctx, out);
            if let Some(e) = els {
                mem_stmt(e, ctx, out);
            }
        }
        Stmt::While { cond, body, .. } | Stmt::DoWhile { body, cond, .. } => {
            mem_expr(cond, ctx, out);
            mem_stmt(body, ctx, out);
        }
        Stmt::For {
            cond, update, body, ..
        } => {
            if let Some(c) = cond {
                mem_expr(c, ctx, out);
            }
            if let Some(u) = update {
                mem_expr(u, ctx, out);
            }
            mem_stmt(body, ctx, out);
        }
        Stmt::ForEach { iter, body, .. } => {
            mem_expr(iter, ctx, out);
            mem_stmt(body, ctx, out);
        }
        Stmt::Block(b) => {
            for s in &b.stmts {
                mem_stmt(s, ctx, out);
            }
        }
        Stmt::Try {
            block,
            catches,
            finally,
            ..
        } => {
            for s in &block.stmts {
                mem_stmt(s, ctx, out);
            }
            for c in catches {
                for s in &c.block.stmts {
                    mem_stmt(s, ctx, out);
                }
            }
            if let Some(f) = finally {
                for s in &f.stmts {
                    mem_stmt(s, ctx, out);
                }
            }
        }
        _ => {}
    }
}

fn mem_expr(e: &Expr, ctx: &InferCtx, out: &mut Vec<Diagnostic>) {
    match e {
        // Method call: validate the receiver chain, but never flag the method name
        // itself (overloads / inherited methods are easy to miss).
        Expr::Call { callee, args, .. } => {
            match &**callee {
                Expr::Member { target, .. } => mem_expr(target, ctx, out),
                other => mem_expr(other, ctx, out),
            }
            for a in args {
                mem_expr(a, ctx, out);
            }
        }
        // Field / property access — flag if missing on a *populated* org type.
        Expr::Member { target, name, span } => {
            mem_expr(target, ctx, out);
            if let Type::Named(tn) = infer(target, ctx) {
                if let Some(at) = ctx.ost.org_type(&tn) {
                    if is_populated(at) && at.member(name).is_none() {
                        out.push(Diagnostic {
                            message: format!("Unknown member '{name}' on {tn}"),
                            span: *span,
                            severity: Severity::Error,
                        });
                    }
                }
            }
        }
        Expr::Binary { lhs, rhs, .. }
        | Expr::Assign {
            target: lhs,
            value: rhs,
            ..
        } => {
            mem_expr(lhs, ctx, out);
            mem_expr(rhs, ctx, out);
        }
        Expr::Unary { operand, .. } => mem_expr(operand, ctx, out),
        Expr::Paren(inner, _) | Expr::Cast { expr: inner, .. } => mem_expr(inner, ctx, out),
        Expr::Index { target, index, .. } => {
            mem_expr(target, ctx, out);
            mem_expr(index, ctx, out);
        }
        Expr::Ternary {
            cond, then, els, ..
        } => {
            mem_expr(cond, ctx, out);
            mem_expr(then, ctx, out);
            mem_expr(els, ctx, out);
        }
        Expr::New { args, .. } => {
            for a in args {
                mem_expr(a, ctx, out);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::parser::parse;
    use crate::symbols::{ApexType, Property, TypeKind};

    fn class_of(src: &str) -> TypeDecl {
        parse(src).types.into_iter().next().unwrap()
    }

    fn empty_ost() -> Ost {
        Ost::default()
    }

    #[test]
    fn flags_duplicate_local() {
        let c = class_of("class C { void m() { Integer x = 1; String x = 'a'; } }");
        let d = diagnose(&c, &empty_ost());
        assert_eq!(d.len(), 1, "{d:?}");
        assert!(d[0].message.contains("Duplicate variable: x"));
    }

    #[test]
    fn flags_local_colliding_with_param() {
        let c = class_of("class C { void m(Integer x) { Integer x = 1; } }");
        let d = diagnose(&c, &empty_ost());
        assert_eq!(d.len(), 1, "{d:?}");
    }

    #[test]
    fn flags_local_colliding_with_enclosing_block() {
        let c = class_of("class C { void m() { Integer x; if (b) { Integer x = 1; } } }");
        let d = diagnose(&c, &empty_ost());
        assert_eq!(d.len(), 1, "{d:?}");
    }

    #[test]
    fn sibling_blocks_may_reuse_a_name() {
        let c = class_of("class C { void m() { if (a) { Integer x; } if (b) { Integer x; } } }");
        assert!(diagnose(&c, &empty_ost()).is_empty());
    }

    #[test]
    fn local_may_shadow_a_field() {
        // A field and a local of the same name is legal in Apex.
        let c = class_of("class C { Integer x; void m() { Integer x = 1; } }");
        assert!(diagnose(&c, &empty_ost()).is_empty());
    }

    fn account_ost() -> Ost {
        Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Account".to_string(),
                kind: TypeKind::Class,
                methods: vec![],
                properties: vec![Property {
                    name: "Name".to_string(),
                    prop_type: "String".to_string(),
                    is_static: false,
                }],
                enum_values: vec![],
            }],
        }
    }

    #[test]
    fn flags_unknown_field_on_populated_type() {
        let c = class_of("class C { void m(Account a) { String s = a.Bogus; } }");
        let d = diagnose(&c, &account_ost());
        assert_eq!(d.len(), 1, "{d:?}");
        assert!(d[0].message.contains("Unknown member 'Bogus' on Account"));
    }

    #[test]
    fn known_field_is_clean() {
        let c = class_of("class C { void m(Account a) { String s = a.Name; } }");
        assert!(diagnose(&c, &account_ost()).is_empty());
    }

    #[test]
    fn method_calls_are_not_flagged() {
        // Method names aren't checked (overloads/inheritance) — no false positive.
        let c = class_of("class C { void m(Account a) { a.someMethod(); } }");
        assert!(diagnose(&c, &account_ost()).is_empty());
    }

    #[test]
    fn unknown_field_on_stub_type_not_flagged() {
        // A name-only (stub) org type has no members → don't flag (avoid FPs).
        let stub = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Account".to_string(),
                kind: TypeKind::Class,
                methods: vec![],
                properties: vec![],
                enum_values: vec![],
            }],
        };
        let c = class_of("class C { void m(Account a) { String s = a.Anything; } }");
        assert!(diagnose(&c, &stub).is_empty());
    }
}
