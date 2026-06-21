//! soql-lang: pure, in-process SOQL completion + diagnostics (no IO).

pub mod complete;
pub mod diagnostics;
pub mod lexer;
pub mod parse;

pub use complete::{
    clause_at, complete, relationship_chain_at, subquery_at, Candidate, CandidateKind, Clause,
    Subquery,
};
pub use diagnostics::{diagnostics, missing_limit, Diagnostic, Severity};
pub use lexer::{lex, Token, TokenKind};
pub use parse::{outline, subquery_groups, where_conditions, Condition, FieldRef, SoqlOutline};
