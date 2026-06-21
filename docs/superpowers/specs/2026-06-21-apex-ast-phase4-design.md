# Apex AST — Phase 4 (expression type inference) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: apex-lang
> Phase 4 of `2026-06-21-lsp-apex-completion-design.md`. Builds on Phases 1-3 + the OST.

## Goal

Infer the result [`Type`] of any expression, flowing types through member/method/index chains.
This is what completion (Phase 6) needs to answer "the cursor is after `acc.Owner.` — what type
is `acc.Owner`, so what members can follow".

## Design (`ast/infer.rs`)

`infer(expr, ctx) -> Type` with `InferCtx { bindings, ost, this_type }`:

- Literals → primitive (`Null` → `Unknown`); `Name` → scope binding, else a static type name,
  else `Unknown`; `this` → the enclosing class.
- `Member`/`Call` → resolve the member on the inferred receiver type:
  - collections (List/Set/Map) via a built-in table (`get`/`size`/`values`/`keySet`/… with the
    right element/value types),
  - primitives via the `System` namespace in the OST (e.g. `String.length()`),
  - named types via `Ost::org_type` / `System` namespace → method return / property type.
- `Index` → the collection's element type; `new`/`Cast` → the written type; `Paren`/`Assign` →
  inner; `Ternary` → the `then` branch (falls back to `els` if unknown).
- Binary: comparisons/logical/`instanceof` → `Boolean`; `+` → `String` if either side is a
  String, else numeric; arithmetic → wider of operands (Decimal > Double > Long > Integer).

Pure and best-effort — unresolved subexpressions yield `Unknown`, never panic.

## Testing

- literals + arithmetic widening + string concat + boolean ops; local/param names; relationship
  chains through the OST (`acc.Owner.Email` → String, `.getName()` → String); collections
  (`List.get`/`[i]`/`size`, `Map.get`/`values`); `new`/cast/`this`; unresolved → Unknown.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`; desktop e2e green.

## Out of scope (Phase 4)

Method-overload selection by argument types, full numeric promotion rules, user-defined generics,
sObject field-type lookup from the schema (Phase 5 / integration), diagnostics.
