//! Typed Apex AST subsystem — the single parse/completion stack:
//! lexer → tree → declaration parser → statement/expression parser →
//! scope/inference → completion ([`engine`] is the wiring-facing entry).

pub mod complete;
pub mod context;
pub mod diagnostics;
pub mod engine;
pub mod infer;
pub mod lexer;
pub mod parser;
pub mod scope;
pub mod tree;
pub mod types;
