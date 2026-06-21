//! AST-backed, type-aware completion (Phase 6a). Ties the whole pipeline
//! together: parse → locate the enclosing method → if the cursor is after `.`,
//! infer the receiver's type and list its members; otherwise list in-scope names.

use super::infer::{infer, InferCtx};
use super::lexer::{lex_code, Tok};
use super::parser::{parse, parse_expression};
use super::scope::bindings_at;
use super::tree::*;
use super::types::Type;
use crate::symbols::{ApexType, Ost};

/// Kind of completion candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateKind {
    Field,
    Method,
    Variable,
}

/// A completion candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub label: String,
    pub kind: CandidateKind,
    pub detail: Option<String>,
}

/// Type-aware completions for `src` at byte offset `cursor`, using the org
/// symbol table `ost`. Empty when the cursor isn't inside a method body.
pub fn complete(src: &str, cursor: usize, ost: &Ost) -> Vec<Candidate> {
    let cu = parse(src);
    let Some((class, method)) = enclosing_method(&cu, cursor) else {
        return Vec::new();
    };
    let bindings = bindings_at(class, method, cursor);
    let partial = partial_at(src, cursor);

    // Member access — the char before the partial is a `.`.
    if let Some(receiver) = receiver_before_dot(src, cursor, partial.len()) {
        let ctx = InferCtx {
            bindings: &bindings,
            ost,
            this_type: &class.name,
        };
        let recv_expr = parse_expression(&receiver);
        // `super.` → the superclass's members (the OST already flattens the
        // parent's own inheritance, mirroring that plugin's resolved member set).
        if matches!(&recv_expr, Some(Expr::Super(_))) {
            let mems = class
                .extends
                .as_deref()
                .map(|p| members_of(&Type::Named(p.to_string()), ost, false))
                .unwrap_or_default();
            return finish(mems, partial);
        }
        // Static context: the receiver is a bare type name, not a value/variable.
        let static_ctx = matches!(&recv_expr, Some(Expr::Name(n, _))
            if super::scope::resolve(&bindings, n).is_none()
                && type_name_known(n, ost, &class.name));
        let ty = recv_expr
            .as_ref()
            .map(|e| infer(e, &ctx))
            .unwrap_or(Type::Unknown);
        // The class being edited isn't in the OST — complete its own members from
        // the AST, plus members inherited from its `extends` (resolved via OST).
        let mems = if matches!(&ty, Type::Named(n) if n.eq_ignore_ascii_case(&class.name)) {
            let mut m = own_members(class, static_ctx);
            if let Some(parent) = &class.extends {
                m.extend(members_of(&Type::Named(parent.clone()), ost, static_ctx));
            }
            m
        } else {
            members_of(&ty, ost, static_ctx)
        };
        return finish(mems, partial);
    }

    // Bare position — in-scope names + the class's own methods (callable unqualified).
    let mut seen = std::collections::HashSet::new();
    let mut cands = Vec::new();
    for b in bindings.iter().rev() {
        if seen.insert(b.name.to_ascii_lowercase()) {
            cands.push(Candidate {
                label: b.name.clone(),
                kind: CandidateKind::Variable,
                detail: Some(b.ty.display()),
            });
        }
    }
    cands.extend(own_members(class, false));
    cands.extend(own_members(class, true));
    // Inherited instance members are callable unqualified too.
    if let Some(parent) = &class.extends {
        cands.extend(members_of(&Type::Named(parent.clone()), ost, false));
    }
    finish(cands, partial)
}

/// Members declared on `class` itself (the file being edited), filtered by
/// static-ness. Constructors are excluded.
fn own_members(class: &TypeDecl, want_static: bool) -> Vec<Candidate> {
    let is_static = |mods: &[String]| mods.iter().any(|m| m.eq_ignore_ascii_case("static"));
    let mut out = Vec::new();
    for m in &class.members {
        match m {
            Member::Field(f) if is_static(&f.modifiers) == want_static => out.push(Candidate {
                label: f.name.clone(),
                kind: CandidateKind::Field,
                detail: Some(f.ty.clone()),
            }),
            Member::Property(p) if is_static(&p.modifiers) == want_static => out.push(Candidate {
                label: p.name.clone(),
                kind: CandidateKind::Field,
                detail: Some(p.ty.clone()),
            }),
            Member::Method(me)
                if is_static(&me.modifiers) == want_static
                    && !me.name.eq_ignore_ascii_case(&class.name) =>
            {
                out.push(Candidate {
                    label: me.name.clone(),
                    kind: CandidateKind::Method,
                    detail: me.return_type.clone(),
                })
            }
            _ => {}
        }
    }
    out
}

/// Names of all bindings (class fields, params, locals) in scope at `cursor`.
/// Powers SOQL bind-variable (`:var`) completion inside `[ … ]` literals.
/// Empty when the cursor is not inside a method body.
pub fn scope_names_at(src: &str, cursor: usize) -> Vec<String> {
    let cu = parse(src);
    let Some((class, method)) = enclosing_method(&cu, cursor) else {
        return Vec::new();
    };
    bindings_at(class, method, cursor)
        .into_iter()
        .map(|b| b.name)
        .collect()
}

fn enclosing_method(cu: &CompilationUnit, cursor: usize) -> Option<(&TypeDecl, &MethodDecl)> {
    fn in_type(t: &TypeDecl, cursor: usize) -> Option<(&TypeDecl, &MethodDecl)> {
        for m in &t.members {
            match m {
                Member::Method(method) => {
                    if let Some(b) = &method.body {
                        if b.span.start <= cursor && cursor <= b.span.end {
                            return Some((t, method));
                        }
                    }
                }
                Member::Nested(n) => {
                    if let Some(r) = in_type(n, cursor) {
                        return Some(r);
                    }
                }
                _ => {}
            }
        }
        None
    }
    cu.types.iter().find_map(|t| in_type(t, cursor))
}

/// The in-progress identifier ending at `cursor`.
fn partial_at(src: &str, cursor: usize) -> &str {
    let b = src.as_bytes();
    let mut start = cursor;
    while start > 0 {
        let c = b[start - 1];
        if c.is_ascii_alphanumeric() || c == b'_' {
            start -= 1;
        } else {
            break;
        }
    }
    &src[start..cursor]
}

/// If the cursor sits in member-access position (`receiver.<partial>`), return the
/// receiver expression text. Walks back over a postfix chain (idents, dots, and
/// balanced `()`/`[]` groups) rooted at an ident or `this`/`super`/`new …`.
fn receiver_before_dot(src: &str, cursor: usize, partial_len: usize) -> Option<String> {
    let dot_pos = cursor.checked_sub(partial_len + 1)?;
    if *src.as_bytes().get(dot_pos)? != b'.' {
        return None;
    }
    let head = &src[..dot_pos];
    let toks = lex_code(head);
    if toks.is_empty() {
        return None;
    }

    let mut i = toks.len();
    let mut depth = 0i32;
    let mut start = None;
    while i > 0 {
        let t = toks[i - 1];
        match t.kind {
            Tok::RParen | Tok::RBracket => {
                depth += 1;
                start = Some(t.start);
                i -= 1;
            }
            Tok::LParen | Tok::LBracket => {
                if depth == 0 {
                    break; // unmatched opener — chain boundary
                }
                depth -= 1;
                start = Some(t.start);
                i -= 1;
            }
            _ if depth > 0 => {
                start = Some(t.start);
                i -= 1;
            }
            Tok::Ident | Tok::Dot => {
                start = Some(t.start);
                i -= 1;
            }
            Tok::Keyword
                if matches!(
                    t.text(head).to_ascii_lowercase().as_str(),
                    "this" | "super" | "new"
                ) =>
            {
                start = Some(t.start);
                break; // chain root
            }
            _ => break,
        }
    }

    let start = start?;
    let text = src[start..dot_pos].trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// Whether `n` names a known type (for static-access detection).
fn type_name_known(n: &str, ost: &Ost, this: &str) -> bool {
    matches!(Type::parse(n), Type::Primitive(_))
        || n.eq_ignore_ascii_case(this)
        || ost.org_type(n).is_some()
        || ost.type_in("System", n).is_some()
}

/// The members offered on a receiver of type `ty`. `static_ctx` selects static
/// members + enum constants (a `TypeName.` receiver) vs instance members.
fn members_of(ty: &Type, ost: &Ost, static_ctx: bool) -> Vec<Candidate> {
    match ty {
        Type::Named(n) => ost
            .org_type(n)
            .or_else(|| ost.type_in("System", n))
            .map(|at| apex_type_members(at, static_ctx))
            .unwrap_or_default(),
        Type::Primitive(p) => ost
            .type_in("System", p.name())
            .map(|at| apex_type_members(at, static_ctx))
            .unwrap_or_default(),
        // Collections expose only instance members.
        Type::List(_) | Type::Set(_) | Type::Map(_, _) if !static_ctx => collection_members(ty),
        _ => Vec::new(),
    }
}

fn apex_type_members(at: &ApexType, want_static: bool) -> Vec<Candidate> {
    let mut out = Vec::new();
    for m in &at.methods {
        if m.is_static == want_static {
            out.push(Candidate {
                label: m.name.clone(),
                kind: CandidateKind::Method,
                detail: Some(m.return_type.clone()),
            });
        }
    }
    for p in &at.properties {
        if p.is_static == want_static {
            out.push(Candidate {
                label: p.name.clone(),
                kind: CandidateKind::Field,
                detail: Some(p.prop_type.clone()),
            });
        }
    }
    // Enum constants are static (`Color.RED`).
    if want_static {
        for v in &at.enum_values {
            out.push(Candidate {
                label: v.clone(),
                kind: CandidateKind::Field,
                detail: Some(at.name.clone()),
            });
        }
    }
    out
}

/// Built-in members of List/Set/Map (label + return-type hint).
fn collection_members(ty: &Type) -> Vec<Candidate> {
    let elem = ty.element_type().map(|e| e.display()).unwrap_or_default();
    let m = |label: &str, detail: &str| Candidate {
        label: label.to_string(),
        kind: CandidateKind::Method,
        detail: Some(detail.to_string()),
    };
    match ty {
        Type::List(_) => vec![
            m("size", "Integer"),
            m("isEmpty", "Boolean"),
            m("add", "void"),
            m("get", &elem),
            m("set", "void"),
            m("remove", &elem),
            m("contains", "Boolean"),
            m("clear", "void"),
            m("clone", &ty.display()),
        ],
        Type::Set(_) => vec![
            m("size", "Integer"),
            m("isEmpty", "Boolean"),
            m("add", "Boolean"),
            m("remove", "Boolean"),
            m("contains", "Boolean"),
            m("clear", "void"),
        ],
        Type::Map(k, v) => vec![
            m("size", "Integer"),
            m("isEmpty", "Boolean"),
            m("get", &v.display()),
            m("put", &v.display()),
            m("remove", &v.display()),
            m("containsKey", "Boolean"),
            m("keySet", &format!("Set<{}>", k.display())),
            m("values", &format!("List<{}>", v.display())),
        ],
        _ => Vec::new(),
    }
}

fn finish(mut cands: Vec<Candidate>, partial: &str) -> Vec<Candidate> {
    let p = partial.to_ascii_lowercase();
    cands.retain(|c| c.label.to_ascii_lowercase().starts_with(&p));
    cands.sort_by_key(|c| c.label.to_ascii_lowercase());
    cands.dedup_by(|a, b| a.label.eq_ignore_ascii_case(&b.label));
    cands
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Method, Namespace, Property, TypeKind};

    fn ost() -> Ost {
        let account = ApexType {
            name: "Account".to_string(),
            kind: TypeKind::Class,
            methods: vec![],
            properties: vec![
                Property {
                    name: "Name".to_string(),
                    prop_type: "String".to_string(),
                    is_static: false,
                },
                Property {
                    name: "Owner".to_string(),
                    prop_type: "User".to_string(),
                    is_static: false,
                },
            ],
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
            enum_values: vec![],
        };
        let string_ty = ApexType {
            name: "String".to_string(),
            kind: TypeKind::Class,
            methods: vec![
                Method {
                    name: "valueOf".to_string(),
                    return_type: "String".to_string(),
                    params: vec!["Object".to_string()],
                    is_static: true,
                },
                Method {
                    name: "length".to_string(),
                    return_type: "Integer".to_string(),
                    params: vec![],
                    is_static: false,
                },
            ],
            properties: vec![],
            enum_values: vec![],
        };
        let color = ApexType {
            name: "Color".to_string(),
            kind: TypeKind::Enum,
            methods: vec![],
            properties: vec![],
            enum_values: vec!["RED".to_string(), "GREEN".to_string()],
        };
        // A base class (the OST already flattens its own inheritance at index time).
        let base = ApexType {
            name: "Base".to_string(),
            kind: TypeKind::Class,
            methods: vec![Method {
                name: "baseMethod".to_string(),
                return_type: "Integer".to_string(),
                params: vec![],
                is_static: false,
            }],
            properties: vec![Property {
                name: "baseField".to_string(),
                prop_type: "String".to_string(),
                is_static: false,
            }],
            enum_values: vec![],
        };
        Ost {
            namespaces: vec![Namespace {
                name: "System".to_string(),
                types: vec![string_ty],
            }],
            org_types: vec![account, user, color, base],
        }
    }

    /// Run completion at the `|` marker (stripped from the source).
    fn at(src: &str) -> Vec<Candidate> {
        let cursor = src.find('|').unwrap();
        let cleaned = src.replacen('|', "", 1);
        complete(&cleaned, cursor, &ost())
    }

    fn labels(c: &[Candidate]) -> Vec<&str> {
        c.iter().map(|x| x.label.as_str()).collect()
    }

    #[test]
    fn completes_members_of_a_named_type() {
        let c = at("class C { void m(Account a) { a.| } }");
        assert!(labels(&c).contains(&"Name"));
        assert!(labels(&c).contains(&"Owner"));
    }

    #[test]
    fn completes_through_a_relationship_chain() {
        let c = at("class C { void m(Account a) { a.Owner.| } }");
        assert!(labels(&c).contains(&"Email"));
        assert!(labels(&c).contains(&"getName"));
        assert!(
            !labels(&c).contains(&"Name"),
            "Account members must not leak: {:?}",
            labels(&c)
        );
    }

    #[test]
    fn filters_members_by_partial() {
        let c = at("class C { void m(Account a) { a.Ow| } }");
        assert_eq!(labels(&c), vec!["Owner"]);
    }

    #[test]
    fn completes_collection_builtins() {
        let c = at("class C { void m(List<Account> ls) { ls.| } }");
        assert!(labels(&c).contains(&"size"));
        assert!(labels(&c).contains(&"get"));
        // `get` returns the element type.
        let get = c.iter().find(|x| x.label == "get").unwrap();
        assert_eq!(get.detail.as_deref(), Some("Account"));
    }

    #[test]
    fn member_through_index_and_call() {
        // ls.get(0).Owner.| → Account's Owner is User; complete User members.
        let c = at("class C { void m(List<Account> ls) { ls.get(0).Owner.| } }");
        assert!(labels(&c).contains(&"Email"));
        let c2 = at("class C { void m(List<Account> ls) { ls[0].| } }");
        assert!(labels(&c2).contains(&"Name"));
    }

    #[test]
    fn bare_position_lists_scope() {
        let c = at("class C { Integer field; void m(Account acc) { Account local; |  } }");
        let l = labels(&c);
        assert!(l.contains(&"field"));
        assert!(l.contains(&"acc"));
        assert!(l.contains(&"local"));
    }

    #[test]
    fn bare_partial_filters_scope() {
        let c = at("class C { void m(Account account, Integer other) { acc| } }");
        assert_eq!(labels(&c), vec!["account"]);
    }

    #[test]
    fn outside_method_is_empty() {
        assert!(complete("class C { Integer x; }", 5, &ost()).is_empty());
    }

    #[test]
    fn static_context_lists_static_members_only() {
        // `String.` (a type name, not a variable) → static members only.
        let c = at("class C { void m() { String.| } }");
        assert!(
            labels(&c).contains(&"valueOf"),
            "static method: {:?}",
            labels(&c)
        );
        assert!(
            !labels(&c).contains(&"length"),
            "instance method must not show in static context: {:?}",
            labels(&c)
        );
    }

    #[test]
    fn instance_context_lists_instance_members_only() {
        // A String *variable* → instance members only.
        let c = at("class C { void m(String s) { s.| } }");
        assert!(labels(&c).contains(&"length"));
        assert!(
            !labels(&c).contains(&"valueOf"),
            "static must not show: {:?}",
            labels(&c)
        );
    }

    #[test]
    fn enum_constants_complete_on_the_type() {
        let c = at("class C { void m() { Color.| } }");
        assert!(labels(&c).contains(&"RED"));
        assert!(labels(&c).contains(&"GREEN"));
    }

    #[test]
    fn this_completes_own_class_members() {
        let c = at("class C { Integer count; void doIt() {} void m() { this.| } }");
        assert!(labels(&c).contains(&"count"), "own field: {:?}", labels(&c));
        assert!(labels(&c).contains(&"doIt"), "own method: {:?}", labels(&c));
    }

    #[test]
    fn bare_position_includes_own_methods() {
        let c = at("class C { void helper() {} void m() { hel| } }");
        assert_eq!(labels(&c), vec!["helper"]);
    }

    #[test]
    fn super_completes_superclass_members() {
        let c = at("class C extends Base { void m() { super.| } }");
        assert!(labels(&c).contains(&"baseMethod"), "{:?}", labels(&c));
        assert!(labels(&c).contains(&"baseField"));
    }

    #[test]
    fn this_includes_inherited_members() {
        let c = at("class C extends Base { Integer own; void m() { this.| } }");
        let l = labels(&c);
        assert!(l.contains(&"own"), "own member: {l:?}");
        assert!(l.contains(&"baseMethod"), "inherited member: {l:?}");
    }

    #[test]
    fn bare_position_includes_inherited_members() {
        let c = at("class C extends Base { void m() { base| } }");
        let l = labels(&c);
        assert!(l.contains(&"baseMethod"));
        assert!(l.contains(&"baseField"));
    }

    #[test]
    fn own_class_static_members_via_class_name() {
        let c = at("class C { static Integer total; Integer inst; void m() { C.| } }");
        assert!(
            labels(&c).contains(&"total"),
            "static field: {:?}",
            labels(&c)
        );
        assert!(
            !labels(&c).contains(&"inst"),
            "instance field must not show in static context: {:?}",
            labels(&c)
        );
    }

    #[test]
    fn scope_names_at_lists_fields_params_and_locals() {
        let src = "class C { Integer field1; void m(Id pId) { Integer localX; | } }";
        let cursor = src.find('|').unwrap();
        let cleaned = src.replacen('|', "", 1);
        let names = scope_names_at(&cleaned, cursor);
        assert!(names.contains(&"field1".to_string()), "{names:?}");
        assert!(names.contains(&"pId".to_string()), "{names:?}");
        assert!(names.contains(&"localX".to_string()), "{names:?}");
    }
}
