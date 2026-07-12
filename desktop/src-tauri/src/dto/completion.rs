//! Editor language-service DTOs: Apex/SOQL completion candidates, signature
//! help, and the (shape-identical) Apex/SOQL diagnostics.

use apex_lang::candidate::{Candidate as ApexCandidate, CandidateKind as ApexCandidateKind};

/// One completion candidate for the React/Monaco side.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDto {
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
    pub params: Option<Vec<String>>,
}

fn candidate_kind_str(k: &ApexCandidateKind) -> &'static str {
    match k {
        ApexCandidateKind::Type => "type",
        ApexCandidateKind::Constructor => "constructor",
        ApexCandidateKind::Keyword => "keyword",
        ApexCandidateKind::LocalVar => "localVar",
        ApexCandidateKind::Method => "method",
        ApexCandidateKind::Property => "property",
    }
}

impl From<&ApexCandidate> for CandidateDto {
    fn from(c: &ApexCandidate) -> Self {
        CandidateDto {
            label: c.label.clone(),
            kind: candidate_kind_str(&c.kind).to_string(),
            detail: c.detail.clone(),
            params: c.params.clone(),
        }
    }
}

/// One SOQL completion candidate for the React/Monaco side.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDto {
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
}

fn soql_candidate_kind_str(k: &soql_lang::CandidateKind) -> &'static str {
    match k {
        soql_lang::CandidateKind::Field => "field",
        soql_lang::CandidateKind::Object => "object",
        soql_lang::CandidateKind::Keyword => "keyword",
        soql_lang::CandidateKind::Function => "function",
        soql_lang::CandidateKind::Relationship => "relationship",
    }
}

impl From<&soql_lang::Candidate> for CompletionDto {
    fn from(c: &soql_lang::Candidate) -> Self {
        CompletionDto {
            label: c.label.clone(),
            kind: soql_candidate_kind_str(&c.kind).to_string(),
            detail: c.detail.clone(),
        }
    }
}

/// One callable signature for the Monaco signature-help widget.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureDto {
    pub label: String,
    pub params: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelpDto {
    pub signatures: Vec<SignatureDto>,
    pub active_signature: usize,
    pub active_parameter: usize,
}

impl From<&apex_lang::ast::signature::SignatureHelp> for SignatureHelpDto {
    fn from(h: &apex_lang::ast::signature::SignatureHelp) -> Self {
        SignatureHelpDto {
            signatures: h
                .signatures
                .iter()
                .map(|s| SignatureDto {
                    label: s.label.clone(),
                    params: s.params.clone(),
                })
                .collect(),
            active_signature: h.active_signature,
            active_parameter: h.active_parameter,
        }
    }
}

/// One SOQL diagnostic for the editor (byte offsets into the query; severity as
/// a lowercase string). Adapter over `features::soql::SoqlDiagnostic`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoqlDiagnosticDto {
    pub message: String,
    pub start: usize,
    pub end: usize,
    pub severity: String,
}

impl From<features::soql::SoqlDiagnostic> for SoqlDiagnosticDto {
    fn from(d: features::soql::SoqlDiagnostic) -> Self {
        SoqlDiagnosticDto {
            message: d.message,
            start: d.start,
            end: d.end,
            severity: d.severity,
        }
    }
}

/// One Apex diagnostic for the editor. Same wire shape as [`SoqlDiagnosticDto`];
/// adapter over `features::apex_complete::ApexDiagnostic`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexDiagnosticDto {
    pub message: String,
    pub start: usize,
    pub end: usize,
    pub severity: String,
}

impl From<features::apex_complete::ApexDiagnostic> for ApexDiagnosticDto {
    fn from(d: features::apex_complete::ApexDiagnostic) -> Self {
        ApexDiagnosticDto {
            message: d.message,
            start: d.start,
            end: d.end,
            severity: d.severity,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_dto_maps_method_kind() {
        let candidate = apex_lang::candidate::Candidate {
            label: "valueOf".into(),
            kind: apex_lang::candidate::CandidateKind::Method,
            detail: None,
            params: None,
        };
        let dto = CandidateDto::from(&candidate);
        assert_eq!(dto.label, "valueOf");
        assert_eq!(dto.kind, "method");
    }

    #[test]
    fn candidate_dto_carries_detail_and_params() {
        let c = ApexCandidate {
            label: "debug".into(),
            kind: ApexCandidateKind::Method,
            detail: Some("void".into()),
            params: Some(vec!["Object".into()]),
        };
        let dto = CandidateDto::from(&c);
        assert_eq!(dto.detail.as_deref(), Some("void"));
        assert_eq!(dto.params, Some(vec!["Object".to_string()]));
    }

    #[test]
    fn signature_help_dto_maps_camel_case() {
        let h = apex_lang::ast::signature::SignatureHelp {
            signatures: vec![apex_lang::ast::signature::Signature {
                label: "debug(Object) : void".into(),
                params: vec!["Object".into()],
            }],
            active_signature: 0,
            active_parameter: 1,
        };
        let dto = SignatureHelpDto::from(&h);
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["activeParameter"], 1);
        assert_eq!(json["signatures"][0]["label"], "debug(Object) : void");
    }
}
