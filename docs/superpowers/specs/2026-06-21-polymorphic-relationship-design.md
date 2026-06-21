# Polymorphic relationship completion — Design

> Date: 2026-06-21 · Status: Approved · Crates: soql-lang (pure), features (IO)
> Feasible-tier item #2 of `2026-06-21-remaining-work-roadmap.md`.

## Goal

A polymorphic relationship field points at more than one object (`Task.WhoId` →
`[Contact, Lead]`, `Event.WhatId` → many). Today completion/diagnostics use
`reference_to.first()` only, so `Who.` offers only Contact's fields and a field that exists
only on Lead is wrongly flagged unknown. Union all targets of the **final** hop.

## Design

Only the **last** relationship in a path (the one being completed) unions its targets;
intermediate hops still take `reference_to.first()` (a path like `Who.Account.Name` is rare
and the ambiguity would compound).

### soql-lang (pure)
- `complete`: replace `resolve_chain` (single schema) with `resolve_chain_targets` returning
  **every** schema the final hop can resolve to (intermediate hops: first target). Push fields
  from all; `finish_candidates` already dedups by label, so overlapping fields collapse.
- `diagnostics` `resolve_field`: walk intermediate relationships via first target, then for the
  last relationship try the field on **each** target, returning the first match. So a field
  present on any target is "known"; operator type checks use that field's type.

### features (IO)
- `resolve_related`: at the **final** hop fetch **all** `reference_to` targets into the map
  (intermediate hops unchanged); so the pure resolver can see every polymorphic target.

## Testing
- soql-lang unit: a field with `reference_to = [Contact, Lead]`; `Who.` unions a Contact-only
  and a Lead-only field; a field on only the second target is NOT flagged; a field on neither
  IS flagged.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`.

## Out of scope
- Unioning intermediate (non-final) polymorphic hops.
