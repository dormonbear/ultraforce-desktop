use crate::parser::{context_at, outline, CursorContext};
use crate::resolve::{resolve_receiver_type, resolve_type};
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
            for ty in all_types(ost) {
                push_if_matches(&mut candidates, &prefix, &ty.name, CandidateKind::Type);
            }
            for keyword in KEYWORDS {
                push_if_matches(&mut candidates, &prefix, keyword, CandidateKind::Keyword);
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
        CursorContext::ChainMember { .. } => Vec::new(),
        CursorContext::Unknown => Vec::new(),
    }
}

const KEYWORDS: &[&str] = &[
    "class", "for", "if", "new", "private", "public", "return", "static", "void", "while",
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
                methods: vec![Method {
                    name: "save".to_string(),
                    return_type: "void".to_string(),
                    params: vec!["Account".to_string()],
                    is_static: false,
                }],
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
}
