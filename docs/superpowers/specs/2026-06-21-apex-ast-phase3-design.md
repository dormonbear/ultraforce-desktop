# Apex AST — Phase 3 (scope & binding) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: apex-lang
> Phase 3 of `2026-06-21-lsp-apex-completion-design.md`, builds on Phase 1 (AST) + Phase 2 (types).

## Goal

Given a byte offset inside a method body, compute the names in scope and their [`Type`]s:
class fields/properties, method parameters, and locals declared textually before the cursor in
enclosing blocks. Nearer declarations shadow outer ones. This is what completion (Phase 6) needs
to answer "what can I type here, and what type is it".

## Design (`ast/scope.rs`)

- `Binding { name, ty }` and `bindings_at(class, method, cursor) -> Vec<Binding>` ordered
  outer → inner.
- `resolve(bindings, name) -> Option<&Type>` — nearest (last) match wins (shadowing).
- Block-scoped walk: a declaration is visible only if its statement starts strictly before the
  cursor and its enclosing block contains the cursor. Recurses into `if`/`while`/`for`/`for-each`
  bodies, `try`/`catch`/`finally` blocks, and nested blocks; for-each and catch introduce their
  loop/exception variable scoped to their body.
- Added `Stmt::span()` to `tree.rs`.

## Testing

- fields + params visible & typed; local visible only after its declaration; for-each var scoped
  to its body; nested-block local invisible outside; nearer declaration shadows a field; catch
  variable visible in the catch block.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`; desktop e2e green.

## Out of scope (Phase 3)

Expression-result type inference (Phase 4), member resolution against the OST, diagnostics.
