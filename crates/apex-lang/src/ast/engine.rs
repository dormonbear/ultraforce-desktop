//! The single wiring-facing completion entry, built entirely on the AST stack.
//! Routes by [`super::context`] classification, delegates member/scope
//! completion to [`super::complete`] (wrapping bare anonymous-Apex snippets in
//! a synthetic class/method so the parser sees a method body), and adds the
//! static candidate tables (types, keywords, annotations) plus declarator name
//! suggestions.

use super::complete::{complete as ast_complete, CandidateKind as AstKind};
use super::context::{context_at, CursorContext, Segment};
use crate::candidate::{Candidate, CandidateKind};
use crate::symbols::{ApexType, Ost};

/// Completions for `src` at byte offset `cursor` against the org symbol table.
/// Accepts both full class sources and bare anonymous-Apex snippets.
pub fn complete_source(src: &str, cursor: usize, ost: &Ost) -> Vec<Candidate> {
    let cursor = cursor.min(src.len());
    match context_at(src, cursor) {
        CursorContext::Annotation { prefix } => {
            let ann_prefix = format!("@{prefix}");
            let mut out = Vec::new();
            for a in ANNOTATIONS {
                push_if_matches(&mut out, &ann_prefix, a, CandidateKind::Keyword);
            }
            sort_and_dedupe(out)
        }
        CursorContext::DeclaratorName { type_text, prefix } => {
            let mut out = Vec::new();
            push_if_matches(
                &mut out,
                &prefix,
                &default_var_name(&type_text),
                CandidateKind::LocalVar,
            );
            out
        }
        CursorContext::TypeOnly { prefix } => {
            let mut out = Vec::new();
            push_types(&mut out, &prefix, ost, CandidateKind::Constructor);
            sort_and_dedupe(out)
        }
        CursorContext::Member { chain, prefix } => {
            let mut out = engine_candidates(src, cursor, ost);
            if out.is_empty() {
                out = static_member_fallback(ost, &chain, &prefix);
            }
            sort_and_dedupe(out)
        }
        CursorContext::Bare { prefix } => {
            let mut out = Vec::new();
            push_types(&mut out, &prefix, ost, CandidateKind::Type);
            for kw in KEYWORDS {
                push_if_matches(&mut out, &prefix, kw, CandidateKind::Keyword);
            }
            // In-scope names + own/inherited members from the AST engine
            // (already prefix-filtered by the engine).
            out.extend(engine_candidates(src, cursor, ost));
            sort_and_dedupe(out)
        }
        CursorContext::Unknown => Vec::new(),
    }
}

/// Run the AST member/scope engine on `src` directly; when the cursor is not
/// inside a method body (bare anonymous-Apex snippets), retry with the snippet
/// wrapped as a class body, then as a method body.
fn engine_candidates(src: &str, cursor: usize, ost: &Ost) -> Vec<Candidate> {
    let direct = ast_complete(src, cursor, ost);
    if !direct.is_empty() {
        return to_wire(direct);
    }
    // Snippet of class members (e.g. `void m(){ … }`): wrap as a class body.
    let class_prefix = "class __Anon {\n";
    let wrapped = format!("{class_prefix}{src}\n}}");
    let as_members = ast_complete(&wrapped, cursor + class_prefix.len(), ost);
    if !as_members.is_empty() {
        return to_wire(as_members);
    }
    // Bare statements (anonymous Apex): wrap as a method body.
    let method_prefix = "class __Anon {\nvoid __anon() {\n";
    let wrapped = format!("{method_prefix}{src}\n}}\n}}");
    to_wire(ast_complete(&wrapped, cursor + method_prefix.len(), ost))
}

fn to_wire(cands: Vec<super::complete::Candidate>) -> Vec<Candidate> {
    cands
        .into_iter()
        .map(|c| Candidate {
            label: c.label,
            kind: match c.kind {
                AstKind::Field => CandidateKind::Property,
                AstKind::Method => CandidateKind::Method,
                AstKind::Variable => CandidateKind::LocalVar,
            },
            detail: c.detail,
            params: c.params,
        })
        .collect()
}

/// Last-resort member completion: the receiver's trailing segment names a type
/// → its static members (covers namespace-qualified receivers like
/// `Schema.DescribeSObjectResult.` and sources the AST cannot parse).
fn static_member_fallback(ost: &Ost, chain: &[Segment], prefix: &str) -> Vec<Candidate> {
    let last = match chain.last() {
        Some(s) if !s.is_call => s,
        _ => return Vec::new(),
    };
    let Some(at) = crate::symbols::resolve_type(ost, &last.name) else {
        return Vec::new();
    };
    to_wire(super::complete::apex_type_members(ost, at, true))
        .into_iter()
        .filter(|c| starts_with_ci(&c.label, prefix))
        .collect()
}

fn push_types(candidates: &mut Vec<Candidate>, prefix: &str, ost: &Ost, kind: CandidateKind) {
    for ty in all_types(ost) {
        push_if_matches(candidates, prefix, &ty.name, kind.clone());
    }
    for p in PRIMITIVES {
        push_if_matches(candidates, prefix, p, kind.clone());
    }
    for b in BUILTIN_TYPES {
        push_if_matches(candidates, prefix, b, kind.clone());
    }
}

fn all_types(ost: &Ost) -> Vec<&ApexType> {
    ost.org_types
        .iter()
        .chain(
            ost.namespaces
                .iter()
                .flat_map(|namespace| namespace.types.iter()),
        )
        .collect()
}

/// Suggest a variable name for a declared type: `Account` -> `account`,
/// `List<Account>`/`Set<Account>` -> `accounts`, `Map<..>` -> `map` of base.
fn default_var_name(type_text: &str) -> String {
    let t = type_text.trim();
    if let Some(lt) = t.find('<') {
        let outer = t[..lt].trim().rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let inner = &t[lt + 1..t.rfind('>').unwrap_or(t.len())];
        if (outer == "list" || outer == "set") && !inner.contains(',') {
            let elem = inner.trim().trim_end_matches("[]").rsplit('.').next().unwrap_or(inner).trim();
            if !elem.is_empty() {
                return format!("{}s", decapitalize(elem));
            }
        }
        let base = t[..lt].trim().rsplit('.').next().unwrap_or(t);
        return decapitalize(base);
    }
    let base = t.trim_end_matches("[]").rsplit('.').next().unwrap_or(t);
    decapitalize(base)
}

/// Lower-case the first character, keep the rest.
fn decapitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_ascii_lowercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

fn starts_with_ci(label: &str, prefix: &str) -> bool {
    label
        .to_ascii_lowercase()
        .starts_with(&prefix.to_ascii_lowercase())
}

fn push_if_matches(
    candidates: &mut Vec<Candidate>,
    prefix: &str,
    label: &str,
    kind: CandidateKind,
) {
    if starts_with_ci(label, prefix) {
        candidates.push(Candidate {
            label: label.to_string(),
            kind,
            detail: None,
            params: None,
        });
    }
}

fn sort_and_dedupe(mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    candidates.sort_by(|a, b| a.label.cmp(&b.label).then(a.kind.cmp(&b.kind)));
    candidates.dedup_by(|a, b| a.label == b.label);
    candidates
}

const KEYWORDS: &[&str] = &[
    "abstract",
    "break",
    "catch",
    "class",
    "continue",
    "do",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "for",
    "global",
    "if",
    "implements",
    "instanceof",
    "interface",
    "new",
    "override",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch on",
    "this",
    "throw",
    "transient",
    "trigger",
    "try",
    "virtual",
    "void",
    "webservice",
    "while",
    "with sharing",
    "without sharing",
    "inherited sharing",
    "when",
    "insert",
    "update",
    "delete",
    "upsert",
    "merge",
    "undelete",
    "select",
    "null",
    "true",
    "false",
];

const PRIMITIVES: &[&str] = &[
    "Blob", "Boolean", "Date", "Datetime", "Decimal", "Double", "Id", "Integer", "Long", "Object",
    "String", "Time",
];

/// Built-in generic collection / interface types. Always completable,
/// independent of whether the org stdlib OST has been warmed.
const BUILTIN_TYPES: &[&str] = &["List", "Map", "Set", "Iterable", "Iterator", "SObject"];

const ANNOTATIONS: &[&str] = &[
    "@AuraEnabled",
    "@Deprecated",
    "@Future",
    "@HttpDelete",
    "@HttpGet",
    "@HttpPatch",
    "@HttpPost",
    "@HttpPut",
    "@InvocableMethod",
    "@InvocableVariable",
    "@IsTest",
    "@JsonAccess",
    "@NamespaceAccessible",
    "@ReadOnly",
    "@RemoteAction",
    "@SuppressWarnings",
    "@TestSetup",
    "@TestVisible",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Method, Namespace, Ost, Property, TypeKind};

    fn ost() -> Ost {
        Ost {
            namespaces: vec![Namespace {
                name: "System".to_string(),
                types: vec![
                    ApexType {
                        name: "String".to_string(),
                        kind: TypeKind::Class,
                        methods: vec![Method {
                            name: "valueOf".to_string(),
                            return_type: "String".to_string(),
                            params: vec!["Integer".to_string()],
                            is_static: true,
                        }],
                        properties: vec![],
                        parent_class: None,
                        interfaces: vec![],
                        enum_values: vec![],
                    },
                    ApexType {
                        name: "Database".to_string(),
                        kind: TypeKind::Class,
                        methods: vec![],
                        properties: vec![],
                        parent_class: None,
                        interfaces: vec![],
                        enum_values: vec![],
                    },
                ],
            }],
            org_types: vec![ApexType {
                name: "AccountService".to_string(),
                kind: TypeKind::Class,
                methods: vec![
                    Method {
                        name: "save".to_string(),
                        return_type: "void".to_string(),
                        params: vec!["Account".to_string()],
                        is_static: false,
                    },
                    Method {
                        name: "self_".to_string(),
                        return_type: "AccountService".to_string(),
                        params: vec![],
                        is_static: false,
                    },
                ],
                properties: vec![],
                parent_class: None,
                interfaces: vec![],
                enum_values: vec![],
            }],
        }
    }

    #[test]
    fn suppresses_types_in_variable_name_position() {
        let ost = ost();
        // `List<Account> accou` — naming a variable, not a type position.
        let src = "List<Account> accou";
        let cands = complete_source(src, src.len(), &ost);
        assert!(cands.iter().all(|c| c.kind != CandidateKind::Type));
        assert!(cands.iter().any(|c| c.label == "accounts"));
    }

    #[test]
    fn suggests_name_for_simple_type_declarator() {
        let ost = ost();
        let src = "Account acc";
        let cands = complete_source(src, src.len(), &ost);
        assert!(cands.iter().any(|c| c.label == "account"));
        assert!(cands.iter().all(|c| c.kind != CandidateKind::Type));
    }

    #[test]
    fn still_completes_types_in_expression_position() {
        let ost = ost();
        // After `new ` we still want type names, not name suggestions.
        let src = "new Stri";
        let cands = complete_source(src, src.len(), &ost);
        assert!(cands
            .iter()
            .any(|c| c.label == "String" && c.kind == CandidateKind::Constructor));
    }

    #[test]
    fn completes_builtin_collection_types() {
        let ost = ost();
        // `List` is not a primitive and may be absent from a cold stdlib OST, but
        // must always be offered (and sort above org classes like `ListBuilder`).
        let list = complete_source("List", 4, &ost);
        assert!(list
            .iter()
            .any(|c| c.label == "List" && c.kind == CandidateKind::Type));
        assert!(complete_source("Ma", 2, &ost).iter().any(|c| c.label == "Map"));
        assert!(complete_source("Se", 2, &ost).iter().any(|c| c.label == "Set"));
    }

    #[test]
    fn completes_top_level_and_member_access_against_ost() {
        let ost = ost();

        let top_level = complete_source("Stri", 4, &ost);
        assert!(top_level
            .iter()
            .any(|candidate| candidate.label == "String" && candidate.kind == CandidateKind::Type));
        assert!(!top_level
            .iter()
            .any(|candidate| candidate.label == "Database"));

        let static_members = complete_source("String.val", "String.val".len(), &ost);
        assert!(static_members.iter().any(
            |candidate| candidate.label == "valueOf" && candidate.kind == CandidateKind::Method
        ));

        let input = "AccountService svc; svc.sa";
        let instance_members = complete_source(input, input.len(), &ost);
        assert!(instance_members
            .iter()
            .any(|candidate| candidate.label == "save" && candidate.kind == CandidateKind::Method));
    }

    #[test]
    fn completes_annotations_from_at_prefix() {
        let ost = ost();

        let got = complete_source("@Aura", "@Aura".len(), &ost);

        assert!(
            got.iter().any(|candidate| candidate.label == "@AuraEnabled"
                && candidate.kind == CandidateKind::Keyword),
            "{got:?}"
        );
        assert!(got.iter().all(|candidate| candidate.label.starts_with('@')));
    }

    #[test]
    fn completes_primitives_at_top_level() {
        let ost = ost();

        let got = complete_source("Inte", "Inte".len(), &ost);

        assert!(
            got.iter()
                .any(|candidate| candidate.label == "Integer"
                    && candidate.kind == CandidateKind::Type),
            "{got:?}"
        );
    }

    #[test]
    fn completes_extended_keywords_at_top_level() {
        let ost = ost();

        let got = complete_source("glo", "glo".len(), &ost);

        assert!(
            got.iter()
                .any(|candidate| candidate.label == "global"
                    && candidate.kind == CandidateKind::Keyword),
            "{got:?}"
        );
    }

    #[test]
    fn member_context_does_not_include_keywords() {
        let ost = ost();
        let input = "AccountService svc; svc.s";

        let got = complete_source(input, input.len(), &ost);

        assert!(
            got.iter()
                .any(|candidate| candidate.label == "save"
                    && candidate.kind == CandidateKind::Method),
            "{got:?}"
        );
        assert!(got
            .iter()
            .all(|candidate| candidate.kind != CandidateKind::Keyword));
    }

    #[test]
    fn completes_member_access_through_a_call_chain() {
        let ost = ost();
        let input = "AccountService svc; svc.self_().sa";
        let got = complete_source(input, input.len(), &ost);
        // The legacy CST completer could not type call-chain receivers and
        // returned empty here; the AST engine resolves the chain.
        assert!(
            got.iter().any(|c| c.label == "save" && c.kind == CandidateKind::Method),
            "call-chain member completion: {got:?}"
        );
    }

    #[test]
    fn offers_types_after_new() {
        let ost = ost();
        let src = "Object o = new Stri";
        let cands = complete_source(src, src.len(), &ost);
        assert!(cands.iter().any(|c| c.label == "String" && c.kind == CandidateKind::Constructor));
        assert!(cands.iter().all(|c| c.kind != CandidateKind::LocalVar));
    }

    #[test]
    fn new_expression_offers_constructor_kind() {
        let ost = ost();
        let src = "Object o = new Stri";
        let cands = complete_source(src, src.len(), &ost);
        assert!(cands.iter().any(|c| c.label == "String" && c.kind == CandidateKind::Constructor));
        // Plain type positions are untouched.
        let bare = complete_source("Stri", 4, &ost);
        assert!(bare.iter().any(|c| c.label == "String" && c.kind == CandidateKind::Type));
    }

    #[test]
    fn member_access_inside_method_body_snippet_lists_members() {
        let ost = ost();
        // `acc` is an AccountService; `.sa` should surface its `save` method.
        let src = "void m(){ AccountService acc; acc.sa";
        let cands = complete_source(src, src.len(), &ost);
        assert!(cands.iter().any(|c| c.label == "save" && c.kind == CandidateKind::Method));
    }

    #[test]
    fn namespace_qualified_static_receiver_falls_back_to_type_lookup() {
        let described = ApexType {
            name: "DescribeSObjectResult".into(),
            kind: TypeKind::Class,
            methods: vec![Method {
                name: "getLabel".into(),
                return_type: "String".into(),
                params: vec![],
                is_static: true,
            }],
            properties: vec![],
            parent_class: None,
            interfaces: vec![],
            enum_values: vec![],
        };
        let ost = Ost {
            namespaces: vec![Namespace {
                name: "Schema".into(),
                types: vec![described],
            }],
            org_types: vec![],
        };
        let src = "Schema.DescribeSObjectResult.get";
        let got = complete_source(src, src.len(), &ost);
        assert!(
            got.iter().any(|c| c.label == "getLabel"),
            "namespace-qualified static member: {got:?}"
        );
    }

    #[test]
    fn method_candidates_carry_detail_and_params() {
        let ost = ost();
        let got = complete_source("String.val", "String.val".len(), &ost);
        let m = got.iter().find(|c| c.label == "valueOf").expect("valueOf offered");
        assert_eq!(m.detail.as_deref(), Some("String"));
        assert_eq!(m.params.as_deref(), Some(&["Integer".to_string()][..]));
    }
}
