# Apex AST — Phase 1 (grammar → typed AST) — Design

> Date: 2026-06-21 · Status: In progress · Crate: apex-lang
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

1. **AST lexer** (`ast/lexer.rs`) — a complete token stream: full operator set
   (`= == != < <= > >= && || ! + - * / % ++ -- += -= *= /= & | ^ =>`), all punctuation
   (`. , ; : ? ( ) { } [ ] @`), comments (`//`, `/* */`), and proper literals (int, long `L`,
   decimal, string with escapes, `true`/`false`, `null`). Tokens carry `kind` + byte span.
2. **AST types** (`ast/tree.rs`) — typed nodes: compilation unit, type decl (class/interface/enum)
   with modifiers, member decls (field/method/property/ctor), statements, expressions; every node
   carries a span.
3. **Declaration parser** (`ast/parser.rs`) — parse a compilation unit's structure: type decls,
   members, signatures (recover on errors; never panic).
4. **Statement & expression parser** — method bodies: var decls, if/for/while/try, return/throw,
   assignments, calls, member access, `new`, literals, operators with precedence.

Phase 1 ends when increments 1–4 parse representative Apex into a spanned AST. Type resolution,
inference, and diagnostics are Phases 2–5.

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
