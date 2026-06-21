# Apex AST — Phase 6c (diagnostics → editor markers) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crates: features, desktop
> Phase 6 (part c) of `2026-06-21-lsp-apex-completion-design.md`. Surfaces the Phase-5 AST
> diagnostics in the editor.

## Goal

Show the AST diagnostics (duplicate variables, unknown field access on populated org types) as
Monaco markers in the Apex editor — additive alongside the existing SOQL-in-Apex markers.

## Design

- **features** (`apex_complete.rs`): `ApexCompleter::diagnostics(org_id, src) -> Vec<ApexDiagnostic>`
  — parse the source, flatten top-level + nested types, run `ast::diagnostics::diagnose` against
  the **in-memory** OST (no IO: uses the cached index if the org is indexed, else an empty OST so
  duplicate-variable checks still run). `ApexDiagnostic { message, start, end, severity }` shares
  the SOQL diagnostic DTO's JSON shape.
- **desktop** (`lib.rs`): `apex_diagnostics(src)` Tauri command → `state.apex.diagnostics`.
- **desktop** (`ApexPanel.tsx`): the debounced diagnostics effect now sets two marker owners —
  `apex-soql` (existing) and `apex-ast` (new) — each refreshing independently. Reuses
  `SoqlDiagnosticDto` (identical shape).

Non-blocking by design: diagnostics never trigger an OST build, so typing stays responsive; the
unknown-field check simply doesn't fire until the org is indexed.

## Testing

- features: `apex_diagnostics_flags_duplicate_and_unknown_field` — an installed OST + source with a
  duplicate local and an unknown field yields both diagnostics.
- desktop: tauri crate builds the new command; tsc clean; Playwright e2e green (apex panel still
  works, `apex_diagnostics` mocked to `[]`).
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`.

## Remaining (future)

A full completion cutover (AST primary, heuristic retired) after on-org validation; richer
diagnostics (unresolved names, arity) once the symbol model deepens.
