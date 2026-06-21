# Apex AST — Phase 1 (grammar → typed AST) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: apex-lang
> Phase 1 of `2026-06-21-lsp-apex-completion-design.md`. Foundation for LSP-grade completion.

## Goal

A real, typed Apex AST to replace the heuristic parse-lite (`parser.rs`) over time. Phase 1
delivers the parsing foundation; later phases add the type model, scope resolution, inference,
and diagnostics.

## Coexistence (do not break shipping code)

The current heuristic completion (`lexer.rs` + `parser.rs` + `complete.rs` + `resolve.rs`) ships
and is tested. The AST work lives in a **new, independent** subtree `apex-lang/src/ast/` and does
not touch the existing path. The completion engine switches to the AST only at Phase 6, once the
AST path is at parity. Until then both compile side by side.

## Increments (each its own commit, TDD)

1. **AST lexer** (`ast/lexer.rs`) — ✅ DONE. Full operator set
   (`= == != < <= > >= && || ! + - * / % ++ -- += -= *= /= & | ^ =>`), all punctuation
   (`. , ; : ? ( ) { } [ ] @`), comments (`//`, `/* */`), and proper literals (int, long `L`,
   decimal, string with escapes, `true`/`false`, `null`). Tokens carry `kind` + byte span.
2. **AST types** (`ast/tree.rs`) — ✅ DONE. Spanned typed nodes: compilation unit, type decl
   (class/interface/enum) with modifiers/annotations, member decls (field/method/property/nested).
3. **Declaration parser** (`ast/parser.rs`) — ✅ DONE. Parses a compilation unit's structure: type
   decls, members, signatures; bodies as spans; error recovery, never panics.
4. **Statement & expression parser** — ✅ DONE. Method bodies: local-var decls, if/else,
   C-style + for-each, while/do-while, return/throw/break/continue, try/catch/finally, DML;
   expressions with full operator precedence, ternary, assignment, member/call/index chains,
   `new`, casts, pre/post inc-dec. An end-to-end test parses a realistic class with zero errors.

**Phase 1 is complete** — increments 1–4 parse representative Apex into a spanned AST. Type
resolution, inference, and diagnostics are Phases 2–5 (see the LSP design doc).

## Design notes

- Lexer stores `kind` + `start`/`end` only (no per-token `String`); text is `&input[start..end]`.
  Recovers on unterminated strings/comments (lex to EOF) — never panics.
- Parser is hand-written recursive descent with error recovery (collect errors, synthesize
  missing nodes) so a half-typed editor buffer still yields a usable tree.

## Testing

- `ast/lexer.rs`: operator/punctuation/comment/literal coverage; spans; unterminated string &
  block comment recover; keyword case-insensitivity.
- Later increments: parser round-trip on representative classes; error-recovery cases.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`.

## Out of scope (Phase 1)

Type system, scope/binding, inference, diagnostics, editor wiring, triggers (added incrementally
later). SOQL/SOSL literals are lexed as a bracketed run; their internals stay with `soql-lang`.
