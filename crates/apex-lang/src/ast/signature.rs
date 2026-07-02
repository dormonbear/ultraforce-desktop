//! Signature help: locate the innermost unclosed call before the caret, count
//! top-level commas for the active parameter, resolve the callee's overloads —
//! OST-backed receivers via the same inference path as completion, bare calls
//! against the edited class's own AST methods.

use super::complete::{enclosing_method, receiver_before_dot};
use super::infer::{infer, InferCtx};
use super::lexer::{lex_code, Tok};
use super::parser::{parse, parse_expression};
use super::scope::bindings_at;
use super::tree::{Member, TypeDecl};
use super::types::Type;
use crate::symbols::{supertype_chain, Ost};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub label: String,
    pub params: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureHelp {
    pub signatures: Vec<Signature>,
    pub active_signature: usize,
    pub active_parameter: usize,
}

/// The innermost unclosed call before `cursor`.
struct Call {
    name: String,
    name_end: usize,
    name_len: usize,
    arg_index: usize,
}

pub fn signature_help(src: &str, cursor: usize, ost: &Ost) -> Option<SignatureHelp> {
    let cursor = cursor.min(src.len());
    let call = enclosing_call(src, cursor)?;
    // The call at the caret is, by definition, unclosed. `parse`'s argument-list
    // recovery hunts forward for a `)` and, finding none before EOF, consumes
    // any enclosing `}` along the way — corrupting the method body span that
    // `enclosing_method` relies on. Synthesize the missing closer(s) right at
    // the caret so the parse sees a balanced call; every offset callers care
    // about (including `cursor` itself) is to the left of the insertion, so it
    // stays valid.
    let cu = parse(&balanced_for_parse(src, cursor));
    let (class, method) = enclosing_method(&cu, cursor)?;
    let bindings = bindings_at(class, method, cursor);

    let signatures = match receiver_before_dot(src, call.name_end, call.name_len) {
        Some(receiver) => {
            let ctx = InferCtx { bindings: &bindings, ost, this_type: &class.name };
            let ty = parse_expression(&receiver)
                .map(|e| infer(&e, &ctx))
                .unwrap_or(Type::Unknown);
            ost_overloads(ost, &ty, &call.name)
        }
        None => own_overloads(class, &call.name),
    };
    if signatures.is_empty() {
        return None;
    }
    let active_signature = signatures
        .iter()
        .position(|s| s.params.len() > call.arg_index)
        .unwrap_or(0);
    Some(SignatureHelp { signatures, active_signature, active_parameter: call.arg_index })
}

/// Scan back from the caret for an unmatched `(`; commas at depth 0 count the
/// active parameter. Statement boundaries (`;`, `{`, `}`) at depth 0 end the
/// search. ponytail: token-level scan — an unclosed `[SELECT …` before the call
/// isn't special-cased; the parse simply yields no signature.
fn enclosing_call(src: &str, cursor: usize) -> Option<Call> {
    let toks = lex_code(&src[..cursor]);
    let mut depth = 0i32;
    let mut commas = 0usize;
    for i in (0..toks.len()).rev() {
        let t = &toks[i];
        match t.kind {
            Tok::RParen | Tok::RBracket => depth += 1,
            Tok::LBracket if depth > 0 => depth -= 1,
            Tok::LParen => {
                if depth > 0 {
                    depth -= 1;
                    continue;
                }
                let callee = toks.get(i.checked_sub(1)?)?;
                if callee.kind != Tok::Ident {
                    return None;
                }
                return Some(Call {
                    name: callee.text(src).to_string(),
                    name_end: callee.end,
                    name_len: callee.end - callee.start,
                    arg_index: commas,
                });
            }
            Tok::Comma if depth == 0 => commas += 1,
            Tok::Semi | Tok::LBrace | Tok::RBrace if depth == 0 => return None,
            _ => {}
        }
    }
    None
}

/// `parse`'s argument-list recovery has no bound on how far it hunts for a
/// closing `)` — an unclosed call swallows tokens up to EOF, including any
/// enclosing `}`, which corrupts block spans (see `signature_help`'s comment).
/// Count still-open `(` up to `cursor` and insert that many synthetic `)` right
/// at `cursor`, so the caret's own unclosed call parses as balanced. A no-op
/// (returns `src` unchanged) when nothing is unclosed there.
fn balanced_for_parse(src: &str, cursor: usize) -> String {
    let depth = lex_code(&src[..cursor]).iter().fold(0i32, |d, t| match t.kind {
        Tok::LParen => d + 1,
        Tok::RParen => d - 1,
        _ => d,
    });
    if depth <= 0 {
        return src.to_string();
    }
    let mut out = String::with_capacity(src.len() + depth as usize);
    out.push_str(&src[..cursor]);
    out.extend(std::iter::repeat(')').take(depth as usize));
    out.push_str(&src[cursor..]);
    out
}

fn ost_overloads(ost: &Ost, ty: &Type, name: &str) -> Vec<Signature> {
    let at = match ty {
        Type::Named(n) => ost.org_type(n).or_else(|| ost.type_in("System", n)),
        Type::Primitive(p) => ost.type_in("System", p.name()),
        _ => None,
    };
    let Some(at) = at else { return Vec::new() };
    let mut out = Vec::new();
    for t in supertype_chain(ost, at) {
        for m in &t.methods {
            if m.name.eq_ignore_ascii_case(name) {
                out.push(sig(&m.name, &m.params, &m.return_type));
            }
        }
    }
    out
}

fn own_overloads(class: &TypeDecl, name: &str) -> Vec<Signature> {
    class
        .members
        .iter()
        .filter_map(|m| match m {
            Member::Method(me) if me.name.eq_ignore_ascii_case(name) => {
                let params: Vec<String> =
                    me.params.iter().map(|p| format!("{} {}", p.ty, p.name)).collect();
                let ret = me.return_type.clone().unwrap_or_else(|| "void".into());
                Some(sig(&me.name, &params, &ret))
            }
            _ => None,
        })
        .collect()
}

fn sig(name: &str, params: &[String], ret: &str) -> Signature {
    Signature {
        label: format!("{name}({}) : {ret}", params.join(", ")),
        params: params.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Method, Namespace, Ost, TypeKind};

    fn ost() -> Ost {
        Ost {
            namespaces: vec![Namespace {
                name: "System".into(),
                types: vec![ApexType {
                    name: "String".into(),
                    kind: TypeKind::Class,
                    methods: vec![
                        Method { name: "valueOf".into(), return_type: "String".into(), params: vec!["Integer".into()], is_static: true },
                        Method { name: "valueOf".into(), return_type: "String".into(), params: vec!["Long".into(), "Integer".into()], is_static: true },
                    ],
                    properties: vec![], parent_class: None, interfaces: vec![], enum_values: vec![],
                }],
            }],
            org_types: vec![],
        }
    }

    fn wrap(body: &str) -> (String, usize) {
        let prefix = "class C { void m() { ";
        (format!("{prefix}{body} }} }}"), prefix.len() + body.len())
    }

    #[test]
    fn resolves_a_static_call_with_overloads() {
        let (src, cur) = wrap("String.valueOf(");
        let h = signature_help(&src, cur, &ost()).expect("signature help");
        assert_eq!(h.signatures.len(), 2);
        assert_eq!(h.signatures[0].label, "valueOf(Integer) : String");
        assert_eq!(h.active_parameter, 0);
        assert_eq!(h.active_signature, 0);
    }

    #[test]
    fn comma_advances_the_active_parameter_and_signature() {
        let (src, cur) = wrap("String.valueOf(1, ");
        let h = signature_help(&src, cur, &ost()).unwrap();
        assert_eq!(h.active_parameter, 1);
        // First overload (1 param) can't fit arg index 1 → the 2-param one is active.
        assert_eq!(h.active_signature, 1);
    }

    #[test]
    fn nested_calls_resolve_the_innermost() {
        let (src, cur) = wrap("outer(String.valueOf(");
        let h = signature_help(&src, cur, &ost()).unwrap();
        assert!(h.signatures[0].label.starts_with("valueOf"));
    }

    #[test]
    fn own_class_methods_resolve_from_the_ast() {
        let src = "class C { void run(Integer count, String name) {} void m() { run( } }";
        let cur = src.find("run( ").unwrap() + 4;
        let h = signature_help(src, cur, &ost()).unwrap();
        assert_eq!(h.signatures[0].label, "run(Integer count, String name) : void");
        assert_eq!(h.signatures[0].params, vec!["Integer count", "String name"]);
    }

    #[test]
    fn closed_or_absent_calls_yield_none() {
        let (src, cur) = wrap("String.valueOf(1); ");
        assert!(signature_help(&src, cur, &ost()).is_none());
        let (src2, cur2) = wrap("Integer x = 1; ");
        assert!(signature_help(&src2, cur2, &ost()).is_none());
    }
}
