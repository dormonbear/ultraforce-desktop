//! Typed Apex AST subsystem (Phase 1 of LSP-grade completion).
//!
//! Independent of the heuristic completion path (`crate::lexer`/`parser`/
//! `complete`/`resolve`), which still ships. Built up incrementally:
//! lexer → tree → declaration parser → statement/expression parser.

pub mod lexer;
