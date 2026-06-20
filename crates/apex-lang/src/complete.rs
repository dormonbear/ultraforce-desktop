use crate::parser::{context_at, outline, CursorContext};
use crate::resolve::{resolve_expr_type, resolve_receiver_type, resolve_type};
use crate::symbols::{ApexType, Ost};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum CandidateKind {
    Type,
    Keyword,
    LocalVar,
    Method,
    Property,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub label: String,
    pub kind: CandidateKind,
}

pub fn complete(input: &str, cursor: usize, ost: &Ost) -> Vec<Candidate> {
    let outline = outline(input);
    match context_at(input, cursor) {
        CursorContext::TopLevel { prefix } => {
            let mut candidates = Vec::new();
            if prefix.starts_with('@') {
                for annotation in ANNOTATIONS {
                    push_if_matches(&mut candidates, &prefix, annotation, CandidateKind::Keyword);
                }
                return sort_and_dedupe(candidates);
            }
            for ty in all_types(ost) {
                push_if_matches(&mut candidates, &prefix, &ty.name, CandidateKind::Type);
            }
            for keyword in KEYWORDS {
                push_if_matches(&mut candidates, &prefix, keyword, CandidateKind::Keyword);
            }
            for primitive in PRIMITIVES {
                push_if_matches(&mut candidates, &prefix, primitive, CandidateKind::Type);
            }
            for local in &outline.locals {
                push_if_matches(
                    &mut candidates,
                    &prefix,
                    &local.name,
                    CandidateKind::LocalVar,
                );
            }
            sort_and_dedupe(candidates)
        }
        CursorContext::StaticMember { type_name, prefix } => resolve_type(ost, &type_name)
            .map(|ty| member_candidates(ty, &prefix, true))
            .unwrap_or_default(),
        CursorContext::InstanceMember { receiver, prefix } => {
            resolve_receiver_type(ost, &outline, &receiver)
                .map(|ty| member_candidates(ty, &prefix, false))
                .unwrap_or_default()
        }
        CursorContext::ChainMember { chain, prefix } => resolve_expr_type(ost, &outline, &chain)
            .map(|ty| member_candidates(ty, &prefix, false))
            .unwrap_or_default(),
        CursorContext::Unknown => Vec::new(),
    }
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

fn member_candidates(ty: &ApexType, prefix: &str, want_static: bool) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    for method in &ty.methods {
        if method.is_static == want_static {
            push_if_matches(&mut candidates, prefix, &method.name, CandidateKind::Method);
        }
    }
    for property in &ty.properties {
        if property.is_static == want_static {
            push_if_matches(
                &mut candidates,
                prefix,
                &property.name,
                CandidateKind::Property,
            );
        }
    }
    sort_and_dedupe(candidates)
}

fn push_if_matches(
    candidates: &mut Vec<Candidate>,
    prefix: &str,
    label: &str,
    kind: CandidateKind,
) {
    if label
        .to_ascii_lowercase()
        .starts_with(&prefix.to_ascii_lowercase())
    {
        candidates.push(Candidate {
            label: label.to_string(),
            kind,
        });
    }
}

fn sort_and_dedupe(mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    candidates.sort_by(|a, b| a.label.cmp(&b.label).then(a.kind.cmp(&b.kind)));
    candidates.dedup_by(|a, b| a.label == b.label);
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Method, Namespace, Ost, TypeKind};

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
                        enum_values: vec![],
                    },
                    ApexType {
                        name: "Database".to_string(),
                        kind: TypeKind::Class,
                        methods: vec![],
                        properties: vec![],
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
                enum_values: vec![],
            }],
        }
    }

    #[test]
    fn completes_top_level_and_member_access_against_ost() {
        let ost = ost();

        let top_level = complete("Stri", 4, &ost);
        assert!(top_level
            .iter()
            .any(|candidate| candidate.label == "String" && candidate.kind == CandidateKind::Type));
        assert!(!top_level
            .iter()
            .any(|candidate| candidate.label == "Database"));

        let static_members = complete("String.val", "String.val".len(), &ost);
        assert!(static_members.iter().any(
            |candidate| candidate.label == "valueOf" && candidate.kind == CandidateKind::Method
        ));

        let input = "AccountService svc; svc.sa";
        let instance_members = complete(input, input.len(), &ost);
        assert!(instance_members
            .iter()
            .any(|candidate| candidate.label == "save" && candidate.kind == CandidateKind::Method));

        assert_eq!(complete(" ", 1, &ost), Vec::new());
    }

    #[test]
    fn completes_annotations_from_at_prefix() {
        let ost = ost();

        let got = complete("@Aura", "@Aura".len(), &ost);

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

        let got = complete("Inte", "Inte".len(), &ost);

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

        let got = complete("glo", "glo".len(), &ost);

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

        let got = complete(input, input.len(), &ost);

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
        let got = complete(input, input.len(), &ost);
        assert!(
            got.iter()
                .any(|c| c.label == "save" && c.kind == CandidateKind::Method),
            "{got:?}"
        );
    }
}
