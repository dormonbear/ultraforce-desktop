//! Completion candidate types shared across the wiring layer and the desktop
//! IPC (`dto.rs` serializes `CandidateKind` to the strings the frontend
//! `types.ts` expects — do not change variants without updating both).

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
