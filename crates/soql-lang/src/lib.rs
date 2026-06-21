//! soql-lang: pure, in-process SOQL completion + diagnostics (no IO).

pub mod complete;
pub mod diagnostics;
pub mod lexer;
pub mod parse;

pub use complete::{clause_at, complete, relationship_chain_at, Candidate, CandidateKind, Clause};
pub use diagnostics::{diagnostics, Diagnostic, Severity};
pub use lexer::{lex, Token, TokenKind};
pub use parse::{outline, where_conditions, Condition, FieldRef, SoqlOutline};
