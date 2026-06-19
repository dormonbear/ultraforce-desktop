//! soql-lang: pure, in-process SOQL completion + diagnostics (no IO).

pub mod complete;
pub mod diagnostics;
pub mod lexer;
pub mod parse;

pub use complete::{clause_at, complete, Candidate, CandidateKind, Clause};
pub use diagnostics::{diagnostics, Diagnostic, Severity};
pub use lexer::{lex, Token, TokenKind};
pub use parse::{outline, FieldRef, SoqlOutline};
