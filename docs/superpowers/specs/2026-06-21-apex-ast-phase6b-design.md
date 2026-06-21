# Apex AST — Phase 6b (live integration) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: features
> Phase 6 (part b) of `2026-06-21-lsp-apex-completion-design.md`. Wires the AST engine (6a) into
> the shipping completion path.

## Goal

Make editor completion benefit from the AST engine **without regressing** the heuristic that
ships today. Strategy: **additive merge**, not a cutover.

## Design (`features/apex_complete.rs`)

`ApexCompleter::complete` keeps the heuristic (`ost_complete`) as the baseline and now appends the
AST engine's type-aware candidates via `merge_ast`:

- `merge_ast(src, cursor, ost, base)` runs `apex_lang::ast::complete::complete` and appends any
  candidate whose label isn't already present (case-insensitive). The heuristic always wins on a
  collision. AST `CandidateKind` maps to the heuristic's: `Field → Property`, `Method → Method`,
  `Variable → LocalVar`.
- Applied at the **indexed/base** return path (the common case). The pre-index on-demand-fetch
  branches stay heuristic-only (niche first-completion path).
- The AST engine needs full-source input with the cursor inside a method body — which is exactly
  what the editor sends. For bare snippets it finds no enclosing method and contributes nothing,
  so nothing changes there.

The win: chain/collection-aware members the heuristic can't infer, e.g. `list.get(0).Owner.` →
the element's relationship members.

## Why additive (not replace)

The heuristic has accumulated edge-case handling (on-demand type acquisition, stdlib, SOQL-in-Apex)
and ships today. Replacing it wholesale is a behaviour migration with real regression surface that
deserves explicit review. Merging delivers the AST value immediately with the heuristic intact as
the safety net; a full cutover can follow once the AST path is validated on real orgs.

## Testing

- New: `ast_engine_adds_collection_chain_member_completion` — full-source `ls.get(0).Owner.`
  completes `Email` through the live `ApexCompleter` (only the AST engine can infer this).
- No regression: all existing `apex_complete` tests pass (contains-style assertions); desktop
  Playwright apex-completion e2e green.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`.

## Remaining (future)

A full cutover (AST as the primary engine, heuristic retired) after on-org validation; static
member completion; AST diagnostics surfaced as editor markers (the Phase-5 engine is ready —
wiring it to a Tauri command + Monaco markers is the next additive step).
