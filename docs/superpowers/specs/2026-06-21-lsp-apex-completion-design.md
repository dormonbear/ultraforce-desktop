# LSP-grade semantic Apex completion — Design (heavy tier, spec only)

> Date: 2026-06-21 · Status: Spec (implementation deferred — multi-week) · Crates: apex-lang,
> features, desktop. Roadmap item #5.

## Goal

Move Apex completion from the current heuristic (name/receiver-chain resolution + on-demand OST
acquisition) to a semantic model: full scope resolution, local-variable & parameter types,
control-flow-aware type inference, method-overload selection, and accurate diagnostics
(unresolved symbol/type/method) across a file and its dependencies.

## Why it's large

The current `apex-lang` is a pragmatic parser + symbol table, deliberately string-name-first
(see `2026-06-19-apex-lang-design.md`, which defers full inference). A true LSP-grade engine needs:
- a complete Apex grammar (statements, generics, SOQL/SOSL literals, triggers, inner types),
- a real type system (inheritance, interfaces, generics, primitives, sObjects, system namespace),
- scope/binding resolution (locals, params, fields, static vs instance, shadowing),
- flow-sensitive inference for chained expressions and overload resolution,
- incremental reanalysis for editor latency.
Each is a substantial subsystem; together this is weeks, not a slice.

## Phased plan (each phase its own spec + plan when scheduled)

1. **Grammar completeness** — full statement/expression parse into a typed AST (replace parse-lite).
2. **Type model** — represent Apex types + the system namespace; load org types lazily (reuse the
   existing OST acquisition).
3. **Scope & binding** — resolve identifiers to declarations; locals/params/fields.
4. **Inference & overloads** — flow-sensitive expression typing; pick method overloads.
5. **Diagnostics** — unresolved symbol/type/method, arity/type mismatches.
6. **Editor integration** — incremental analysis, completion + diagnostics wired to Monaco.

## Recommendation

Schedule phases 1–2 first; they unlock the rest and are independently useful. Reassess scope after
phase 2 against real editor latency on a large org.

## Out of scope (even when built)

Cross-file refactors, rename, go-to-definition across the org (separate features).
