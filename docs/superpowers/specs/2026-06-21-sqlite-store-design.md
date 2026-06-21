# SQLite-backed schema/index store — Design (heavy tier, spec only)

> Date: 2026-06-21 · Status: Spec (implementation deferred) · Crates: sf-schema, apex-lang,
> features, desktop (tauri-plugin-sql or rusqlite). Roadmap item #6.

## Goal

Replace the current on-disk JSON cache (per-object schema files + OST snapshot/manifest) with a
single SQLite database per org, for faster partial reads, atomic delta writes, and simpler cache
invalidation.

## Current state

- `SchemaStore`: `<cache>/<org>/<api>/<object>.json` files + in-memory map.
- `apex-lang`: OST snapshot + manifest persisted to disk (`load_snapshot`).
Both work and are tested; this is an optimization, not a fix.

## Design sketch

- One DB `<cache>/<org>.sqlite` with tables: `sobject(api, name, json, fetched_at)`,
  `apex_type(api, name, json)`, `meta(key, value)` (api version, last sync token).
- `rusqlite` in a blocking task (tokio `spawn_blocking`) or `tauri-plugin-sql`. Prefer `rusqlite`
  in the `sf-schema`/`features` layer so the cache stays backend-owned and testable without Tauri.
- Migrate-on-open: if JSON cache exists and DB doesn't, import once, then use the DB.
- Delta sync writes become single transactions (upsert changed, delete removed) instead of
  many file writes — removes the partial-write window.

## Why deferred

The JSON store meets current performance needs (batched composite describe already fixed the slow
first index). SQLite adds a dependency and a migration; do it when index size or write contention
becomes a measured problem.

## Testing (when implemented)

- sf-schema unit: open/upsert/get round-trip on a temp DB; JSON→DB migration import.
- features: index/sync against the DB store; parity with the JSON-store tests.
- Gates: workspace tests, clippy, fmt.
