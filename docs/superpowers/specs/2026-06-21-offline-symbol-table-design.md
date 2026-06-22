# Offline Symbol Table (reference-plugin-style full index) — Design

**Date:** 2026-06-21
**Status:** Drafted, pending review

## Problem

Code completion currently fetches symbols **lazily on first use** (stdlib OST
~140s on first warm; each org Apex class's full SymbolTable on first member
access; each sObject describe on first access), all disk-cached after. This
shows Monaco "Loading…" on cache misses during normal use. The user wants the
**the reference plugin model**: build a complete local offline symbol table once, then serve
completion 100% from the local table — no on-demand fetches, no Loading during
use.

## Decisions (locked with user)

- **Full eager index**: stdlib + ALL org Apex classes (full SymbolTables) + ALL
  sObject describes, indexed once.
- **One-time first index is acceptable** even if it takes minutes on a big org;
  show progress while it runs.
- **Manual reindex** afterward (refresh control).
- **Completion serves purely from the local table** once indexed (no blocking
  on-demand network).
- **Data stays first-party** — built from Salesforce endpoints (Tooling
  completions, Tooling `ApexClass.SymbolTable`, sObject describe). Never the reference plugin's
  bundled data. (Constraint unchanged: [[sf-toolkit-apex-data-first-party-only]].)
- **Phase 2 (optional, later): incremental auto-update** — detect changed
  objects/classes and patch the table in the background.

## Architecture

This reverses the prior "lazy on-demand for scalability" decision in favor of an
explicit, progress-shown, one-time background index (the reference plugin bargain). The bulk
machinery already exists: `fetch_apex_symbols` (all class SymbolTables, via
`OstSource::OrgTypes`), `list_sobject_names` (`sf sobject list --sobject all`),
`SchemaStore.get_or_fetch` (per-object describe), `run_raw_with_timeout` (300s).
The new work orchestrates these into one indexing job, persists the full table,
serves completion offline-only, and reports progress to the UI.

### 1. Index job (Rust, `features` crate)

New `features::index::OrgIndexer` (or extend `ApexCompleter`):
`index_org(invoker, org_id, on_progress)`:
1. **stdlib** — `OstStore::get_or_fetch(Stdlib)` (300s timeout) → `parse_stdlib`.
2. **org Apex classes** — `OstStore::get_or_fetch(OrgTypes)` =
   `fetch_apex_symbols` (long timeout) → `parse_org_types` (full SymbolTables,
   inner classes, inheritance flattening as today).
3. **sObjects** — `list_sobject_names` → describe each via `SchemaStore`,
   **concurrency-limited** (e.g. 8 in flight) to bound wall time without
   hammering the org → `schema_to_apex_type`.
4. **assemble** one full `Ost` (stdlib namespaces + org types + sObject types)
   and **persist** it (see §2). Emit `on_progress(phase, done, total)` at each
   phase and per sObject batch.

### 2. Persistence

- Persist the assembled `Ost` as a single snapshot `<root>/<org_id>/index.json`
  plus a manifest `index.meta.json` = `{ org_id, api_version, indexed_at,
  counts: { namespaces, classes, sobjects } }` (+ per-type `last_modified` map,
  reserved for Phase 2). Reuse the existing `~/.cache/ultraforce` root.
- On org-select / launch: if a manifest exists and its `api_version` matches →
  **load the snapshot into the in-memory cache** with no network. Else the org
  is "unindexed".

### 3. Completion serves offline-only

`ApexCompleter::complete` / `features::soql::complete_fields`:
- **Indexed** → query the in-memory OST only; never fetch on-demand. A symbol
  absent from the index simply yields no candidate (no block).
- **Unindexed** (before/while first index runs) → keep today's lazy on-demand
  path as a **graceful fallback**, so completion still works during indexing.
  Once the index loads, the fallback is never taken.

### 4. Tauri commands + events

- `index_org(org)` — runs the job; on org-select, auto-trigger **only if
  unindexed**, else load snapshot. Replaces the `warm_apex`/`warm_schema`
  fire-and-forget for the indexed case.
- `reindex_org(org)` — clear snapshot + caches, re-run (the manual refresh).
- **Progress events**: introduce Tauri events (new — none today). The job emits
  `index-progress` = `{ org, phase: "stdlib"|"classes"|"sobjects"|"done",
  done, total }` via `AppHandle::emit`. (Add `tauri::Emitter` import; no new
  capability needed for app-emitted events.)

### 5. Frontend

- Subscribe to `index-progress` via `@tauri-apps/api/event` (`listen`); show a
  status indicator in the top bar: "Indexing <org>… 240/1200 classes" with a
  spinner, hidden when `phase === "done"`.
- The existing schema-refresh control (`SchemaRefresh.tsx`) becomes
  **"Reindex org"** → calls `reindex_org`.

### 6. Phase 2 — incremental auto-update (optional, later)

No push from Salesforce to a desktop app, so this is **delta polling**:
- Store per-type `last_modified` in the manifest.
- On org-select (and/or a periodic timer), query Tooling
  `SELECT Id, Name, LastModifiedDate FROM ApexClass WHERE LastModifiedDate >
  :indexed_at` and the equivalent for `EntityDefinition`/custom objects →
  fetch only changed types → patch the OST + persist + bump manifest.
- Marked clearly as a follow-on; Phase 1 ships the full index + offline serve +
  manual reindex first.

## Scope & risk notes

- Full index reintroduces the O(org-size) cost the lazy design avoided — now as
  an explicit one-time job (user-accepted). Big production orgs: minutes +
  tens of MB on disk. The concurrency limit + long timeouts keep it bounded.
- The bulk `fetch_apex_symbols` payload can be very large; rely on
  `run_raw_with_timeout` and stream-parse if memory becomes an issue (defer
  unless measured).

## Testing

- Rust unit (mock `SfInvoker`): index assembly builds an OST containing stdlib +
  org types + sObject types; manifest written; reload-from-disk yields the same
  OST with no further fetches. Concurrency limiter respects the cap. Completion
  returns candidates with the invoker set to **panic on any call** when indexed
  (proves offline-only).
- Frontend: `event.listen` subscription unit (mock); e2e progress-indicator
  appears then clears (mock-emitted `index-progress`).

## Out of scope

- Per-namespace / managed-package index scoping (could come later; v1 indexes
  everything).
- Real-time push (unavailable); Phase 2 is delta polling only.
