# Apex AST — Phase 5 (diagnostics) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: apex-lang
> Phase 5 of `2026-06-21-lsp-apex-completion-design.md`. Builds on Phases 1-4.

## Goal

Flag real problems in a method body. Apex symbol info is often partial, so this is **conservative
by design** — false positives destroy trust in a linter. Two high-confidence checks:

1. **Duplicate variable declarations** — pure AST, zero false positives. A local that collides
   with a parameter, an enclosing-scope local, or an earlier sibling in the same block. (A local
   *may* shadow a field in Apex, so fields are excluded.)
2. **Unknown field/property access on a populated org type** — `a.Bogus` where `a` infers to a
   named org type that the OST lists *with members* and `Bogus` isn't one. Gated hard:
   - only when the org type is **populated** (has ≥1 member) — never flag against a name-only stub,
   - only **field/property** access — method calls are never flagged (overloads/inheritance).

## Design (`ast/diagnostics.rs`)

`diagnose(class, ost) -> Vec<Diagnostic>` over every method. `Diagnostic { message, span, severity }`.
- Duplicate check: a block-scoped walk with a stack of declared-name sets (params at the base);
  `for`/`for-each`/`catch` introduce their own scope.
- Unknown-member check: walks every expression, infers the receiver type (Phase 4), and flags a
  missing field/property on a populated org type. Method-call receivers are validated but the
  method name itself is never flagged.

## Testing

- duplicate local; local-vs-param; enclosing-block collision; sibling blocks may reuse a name;
  local may shadow a field; unknown field on populated type flagged; known field clean; method
  calls not flagged; stub type not flagged.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`; desktop e2e green.

## Out of scope (Phase 5)

Unresolved bare-name diagnostics (too many false positives from statics/enums/inner types),
method-arity/overload checks, unreachable-code, type-mismatch on assignment — deferred until the
symbol model is richer.
