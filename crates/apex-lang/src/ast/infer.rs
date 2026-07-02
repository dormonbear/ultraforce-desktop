//! Expression type inference (Phase 4). Infers the result [`Type`] of an [`Expr`]
//! from the in-scope bindings (Phase 3), the type model (Phase 2), and the org
//! symbol table ([`Ost`]). Best-effort: anything unresolved is [`Type::Unknown`].

use super::scope::Binding;
use super::tree::Expr;
use super::types::{Primitive, Type};
use crate::resolve::{find_method, find_property};
use crate::symbols::Ost;

/// What inference reads: the in-scope names, the symbol table, and the enclosing
/// class name (for `this`).
pub struct InferCtx<'a> {
    pub bindings: &'a [Binding],
    pub ost: &'a Ost,
    pub this_type: &'a str,
}

/// Infer the result type of `expr`.
pub fn infer(expr: &Expr, ctx: &InferCtx) -> Type {
    match expr {
        Expr::Lit(kind, _) => lit_type(*kind),
        Expr::Name(n, _) => name_type(n, ctx),
        Expr::This(_) => Type::Named(ctx.this_type.to_string()),
        Expr::Super(_) => Type::Unknown,
        Expr::Paren(e, _) => infer(e, ctx),
        Expr::Cast { ty, .. } => Type::parse(ty),
        Expr::New { ty, .. } => Type::parse(ty),
        Expr::Index { target, .. } => infer(target, ctx)
            .element_type()
            .cloned()
            .unwrap_or(Type::Unknown),
        Expr::Member { target, name, .. } => member_type(&infer(target, ctx), name, false, ctx),
        Expr::Call { callee, .. } => match &**callee {
            // `recv.method(...)` → the method's return type on recv.
            Expr::Member { target, name, .. } => member_type(&infer(target, ctx), name, true, ctx),
            // `method(...)` → a method on the current class.
            Expr::Name(name, _) => {
                member_type(&Type::Named(ctx.this_type.to_string()), name, true, ctx)
            }
            _ => Type::Unknown,
        },
        Expr::Unary { op, operand, .. } => match op.as_str() {
            "!" => Type::Primitive(Primitive::Boolean),
            _ => infer(operand, ctx), // -x / +x / x++ / x--
        },
        Expr::Binary { op, lhs, rhs, .. } => binary_type(op, lhs, rhs, ctx),
        Expr::Assign { value, .. } => infer(value, ctx),
        Expr::Ternary { then, els, .. } => {
            let t = infer(then, ctx);
            if t == Type::Unknown {
                infer(els, ctx)
            } else {
                t
            }
        }
        Expr::Error(_) => Type::Unknown,
    }
}

fn lit_type(kind: super::tree::LitKind) -> Type {
    use super::tree::LitKind::*;
    match kind {
        Int => Type::Primitive(Primitive::Integer),
        Long => Type::Primitive(Primitive::Long),
        Decimal => Type::Primitive(Primitive::Decimal),
        Str => Type::Primitive(Primitive::String),
        Bool => Type::Primitive(Primitive::Boolean),
        Null => Type::Unknown,
    }
}

/// A bare name: a local/param/field, else a type name (static reference), else unknown.
fn name_type(name: &str, ctx: &InferCtx) -> Type {
    if let Some(t) = super::scope::resolve(ctx.bindings, name) {
        return t.clone();
    }
    // The class being edited, used statically (`ClassName.staticMember`).
    if name.eq_ignore_ascii_case(ctx.this_type) {
        return Type::Named(name.to_string());
    }
    // A type name used statically (`String.valueOf`, `Math`, an org type).
    if matches!(Type::parse(name), Type::Primitive(_))
        || ctx.ost.org_type(name).is_some()
        || ctx.ost.type_in("System", name).is_some()
    {
        return Type::Named(name.to_string());
    }
    Type::Unknown
}

/// The type of member `name` on receiver `recv` (`is_call` distinguishes a method
/// call from a field/property access).
fn member_type(recv: &Type, name: &str, is_call: bool, ctx: &InferCtx) -> Type {
    match recv {
        Type::List(_) | Type::Set(_) | Type::Map(_, _) => collection_member(recv, name),
        Type::Primitive(p) => {
            // Primitives resolve against the System namespace (e.g. String.length()).
            ost_member(ctx.ost, ctx.ost.type_in("System", p.name()), name, is_call)
        }
        Type::Named(n) => {
            let at = ctx.ost.org_type(n).or_else(|| ctx.ost.type_in("System", n));
            ost_member(ctx.ost, at, name, is_call)
        }
        _ => Type::Unknown,
    }
}

/// Resolve a member on an [`crate::symbols::ApexType`] from the OST, walking the
/// `parent_class` chain and `interfaces` for inherited members.
fn ost_member(ost: &Ost, at: Option<&crate::symbols::ApexType>, name: &str, is_call: bool) -> Type {
    let Some(at) = at else {
        return Type::Unknown;
    };
    if is_call {
        find_method(ost, at, name)
            .map(|m| Type::parse(&m.return_type))
            .unwrap_or(Type::Unknown)
    } else {
        find_property(ost, at, name)
            .map(|p| Type::parse(&p.prop_type))
            .unwrap_or(Type::Unknown)
    }
}

/// Built-in members on List/Set/Map collections.
fn collection_member(recv: &Type, name: &str) -> Type {
    let elem = recv.element_type().cloned().unwrap_or(Type::Unknown);
    let n = name.to_ascii_lowercase();
    match recv {
        Type::List(_) | Type::Set(_) => match n.as_str() {
            "size" => Type::Primitive(Primitive::Integer),
            "isempty" | "contains" | "add" | "remove" if matches!(recv, Type::Set(_)) => {
                Type::Primitive(Primitive::Boolean)
            }
            "isempty" | "contains" => Type::Primitive(Primitive::Boolean),
            "get" | "remove" => elem,
            "clone" | "deepclone" => recv.clone(),
            _ => Type::Unknown,
        },
        Type::Map(k, v) => match n.as_str() {
            "size" => Type::Primitive(Primitive::Integer),
            "isempty" | "containskey" | "containsvalue" => Type::Primitive(Primitive::Boolean),
            "get" | "put" | "remove" => (**v).clone(),
            "keyset" => Type::Set(k.clone()),
            "values" => Type::List(v.clone()),
            "clone" | "deepclone" => recv.clone(),
            _ => Type::Unknown,
        },
        _ => Type::Unknown,
    }
}

fn binary_type(op: &str, lhs: &Expr, rhs: &Expr, ctx: &InferCtx) -> Type {
    match op {
        "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "instanceof" => {
            Type::Primitive(Primitive::Boolean)
        }
        "+" => {
            let l = infer(lhs, ctx);
            let r = infer(rhs, ctx);
            // String concatenation if either side is a String.
            if l == Type::Primitive(Primitive::String) || r == Type::Primitive(Primitive::String) {
                Type::Primitive(Primitive::String)
            } else {
                numeric_result(&l, &r)
            }
        }
        "-" | "*" | "/" | "%" => numeric_result(&infer(lhs, ctx), &infer(rhs, ctx)),
        _ => Type::Unknown, // bitwise & | ^ — rare in Apex
    }
}

/// The wider of two numeric operand types (Decimal > Double > Long > Integer).
fn numeric_result(l: &Type, r: &Type) -> Type {
    let rank = |t: &Type| match t {
        Type::Primitive(Primitive::Decimal) => 4,
        Type::Primitive(Primitive::Double) => 3,
        Type::Primitive(Primitive::Long) => 2,
        Type::Primitive(Primitive::Integer) => 1,
        _ => 0,
    };
    let (lr, rr) = (rank(l), rank(r));
    if lr == 0 && rr == 0 {
        return Type::Unknown;
    }
    if lr >= rr {
        l.clone()
    } else {
        r.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::parser::parse;
    use crate::ast::scope::{bindings_at, Binding};
    use crate::ast::tree::{Member, Stmt};
    use crate::symbols::{ApexType, Method, Namespace, Property, TypeKind};

    fn ost() -> Ost {
        let account = ApexType {
            name: "Account".to_string(),
            kind: TypeKind::Class,
            methods: vec![],
            properties: vec![Property {
                name: "Owner".to_string(),
                prop_type: "User".to_string(),
                is_static: false,
            }],
            parent_class: None,
            interfaces: vec![],
            enum_values: vec![],
        };
        let user = ApexType {
            name: "User".to_string(),
            kind: TypeKind::Class,
            methods: vec![Method {
                name: "getName".to_string(),
                return_type: "String".to_string(),
                params: vec![],
                is_static: false,
            }],
            properties: vec![Property {
                name: "Email".to_string(),
                prop_type: "String".to_string(),
                is_static: false,
            }],
            parent_class: None,
            interfaces: vec![],
            enum_values: vec![],
        };
        // Subclass linked to Account only via `parent_class` (no flattened members).
        let sub = ApexType {
            name: "Sub".to_string(),
            kind: TypeKind::Class,
            parent_class: Some("Account".to_string()),
            interfaces: vec![],
            methods: vec![],
            properties: vec![],
            enum_values: vec![],
        };
        Ost {
            namespaces: vec![Namespace {
                name: "System".to_string(),
                types: vec![],
            }],
            org_types: vec![account, user, sub],
        }
    }

    /// Infer the type of the initializer expression of the local named `x` in the
    /// single method `m`, against `ost()` with a scope from before `x`.
    fn infer_init(src: &str) -> Type {
        let cu = parse(src);
        let class = &cu.types[0];
        let method = class
            .members
            .iter()
            .find_map(|m| match m {
                Member::Method(m) if m.name == "m" => Some(m),
                _ => None,
            })
            .unwrap();
        // Find `x = <expr>;` and infer <expr> with the scope just before it.
        let body = method.body.as_ref().unwrap();
        let (init, at) = body
            .stmts
            .iter()
            .find_map(|s| match s {
                Stmt::LocalVar { decls, span, .. } => decls
                    .iter()
                    .find(|(n, _)| n == "x")
                    .and_then(|(_, e)| e.as_ref())
                    .map(|e| (e, span.start)),
                _ => None,
            })
            .expect("local x with init");
        let bindings: Vec<Binding> = bindings_at(class, method, at);
        let ctx = InferCtx {
            bindings: &bindings,
            ost: &ost(),
            this_type: &class.name,
        };
        infer(init, &ctx)
    }

    #[test]
    fn literals_and_arithmetic() {
        assert_eq!(
            infer_init("class C { void m() { Object x = 1 + 2; } }"),
            Type::Primitive(Primitive::Integer)
        );
        assert_eq!(
            infer_init("class C { void m() { Object x = 1 + 2.5; } }"),
            Type::Primitive(Primitive::Decimal)
        );
        assert_eq!(
            infer_init("class C { void m() { Object x = 'a' + 1; } }"),
            Type::Primitive(Primitive::String)
        );
        assert_eq!(
            infer_init("class C { void m() { Object x = 1 < 2; } }"),
            Type::Primitive(Primitive::Boolean)
        );
    }

    #[test]
    fn local_and_param_names() {
        assert_eq!(
            infer_init("class C { void m(Account acc) { Object x = acc; } }"),
            Type::Named("Account".to_string())
        );
    }

    #[test]
    fn relationship_chain_through_ost() {
        // acc.Owner : User, .Email : String, .getName() : String.
        assert_eq!(
            infer_init("class C { void m(Account acc) { Object x = acc.Owner.Email; } }"),
            Type::Primitive(Primitive::String)
        );
        assert_eq!(
            infer_init("class C { void m(Account acc) { Object x = acc.Owner.getName(); } }"),
            Type::Primitive(Primitive::String)
        );
    }

    #[test]
    fn inherited_member_resolves_through_parent_class_chain() {
        // Sub extends Account (via parent_class); Owner is declared on Account.
        assert_eq!(
            infer_init("class C { void m(Sub s) { Object x = s.Owner.Email; } }"),
            Type::Primitive(Primitive::String)
        );
    }

    #[test]
    fn collection_inference() {
        assert_eq!(
            infer_init("class C { void m(List<Account> ls) { Object x = ls.get(0); } }"),
            Type::Named("Account".to_string())
        );
        assert_eq!(
            infer_init("class C { void m(List<Account> ls) { Object x = ls[0]; } }"),
            Type::Named("Account".to_string())
        );
        assert_eq!(
            infer_init("class C { void m(List<Account> ls) { Object x = ls.size(); } }"),
            Type::Primitive(Primitive::Integer)
        );
        assert_eq!(
            infer_init("class C { void m(Map<Id, Account> mp) { Object x = mp.get(k); } }"),
            Type::Named("Account".to_string())
        );
        assert_eq!(
            infer_init("class C { void m(Map<Id, Account> mp) { Object x = mp.values(); } }"),
            Type::List(Box::new(Type::Named("Account".to_string())))
        );
    }

    #[test]
    fn new_and_cast_and_this() {
        assert_eq!(
            infer_init("class C { void m() { Object x = new Account(); } }"),
            Type::Named("Account".to_string())
        );
        assert_eq!(
            infer_init("class C { void m(Object o) { Object x = (Account) o; } }"),
            Type::Named("Account".to_string())
        );
        assert_eq!(
            infer_init("class C { void m() { Object x = this; } }"),
            Type::Named("C".to_string())
        );
    }

    #[test]
    fn unresolved_is_unknown() {
        assert_eq!(
            infer_init("class C { void m() { Object x = mystery.thing; } }"),
            Type::Unknown
        );
    }
}
