# Apex AST — Phase 6a (AST-backed completion) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: apex-lang
> Phase 6 (part a) of `2026-06-21-lsp-apex-completion-design.md`. The payoff of Phases 1-5.

## Goal

A single `complete(src, cursor, ost)` that produces type-aware completion candidates from the AST
pipeline — the type-aware replacement for the heuristic completion. Phase 6a is the pure
apex-lang function; Phase 6b wires it into `features` + the desktop editor.

## Design (`ast/complete.rs`)

`complete(src, cursor, ost) -> Vec<Candidate>` (`Candidate { label, kind, detail }`):

1. Parse → locate the `TypeDecl` + `MethodDecl` whose body span contains the cursor.
2. Scope bindings at the cursor (Phase 3).
3. **Member access** (`receiver.<partial>`): a backward token walk extracts the receiver chain
   (idents, dots, balanced `()`/`[]`, rooted at an ident / `this` / `super` / `new …`),
   `parse_expression` builds it, infer (Phase 4) gives its type, and `members_of` lists members:
   - named/primitive types → methods + properties + enum values from the OST,
   - List/Set/Map → built-in members with element-typed `get`/`values`/etc.
4. **Bare position**: in-scope names (locals/params/fields), nearest binding per name.
5. Prefix-filter by the partial, sort, dedup.

Added `parser::parse_expression` (parse a standalone expression).

## Testing

- members of a named type; relationship chain (no leak); partial filtering; collection built-ins
  (`get` typed to the element); member through index + call (`ls.get(0).Owner.`, `ls[0].`);
  bare-position scope listing + partial filter; outside-method empty.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`; desktop e2e green.

## Out of scope (6a)

Static-member completion (`String.valueOf`), `this.`/`super.` member tables beyond what infer
already resolves, and the features/desktop wiring (Phase 6b).
