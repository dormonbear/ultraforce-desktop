# Incremental Index Update (Phase 2) — Design

**Date:** 2026-06-21
**Status:** Approved, ready for planning

## Problem

The offline symbol table (Phase 1) builds a full local OST once, then serves
completion 100% offline. But the only way to pick up an org change (an edited
Apex class, a new custom field) is a full **Reindex** — ~15 min on a large
managed-package org. After the one-time index, refreshing a single changed
class should be cheap. Phase 2 adds an **incremental delta sync** that patches
only what changed.

A second, related gap: selecting an already-indexed org currently re-runs the
**full** `index_org` every time (no "already indexed?" guard) — it re-assembles
from the warm disk cache and never picks up changes. Phase 2 fixes the
org-select entry to *load the snapshot + delta sync* instead.

## Decisions (locked with user)

- **Trigger:** org-select only (auto, background). No periodic timer, no
  separate manual Sync button — the existing full **Reindex** button stays as
  the escape hatch.
- **Scope:** both **Apex classes** and **sObjects** (incl. custom fields).
- **Deletions:** reconciled — a delta also drops OST entries that no longer
  exist in the org.
- **Feedback:** silent when nothing changed; a toast `Synced N updates` when a
  delta actually patched something.
- **Watermark:** the snapshot manifest's `indexed_at` (now real RFC3339 UTC,
  e.g. `2026-06-21T12:00:00Z`) is the `LastModifiedDate >` comparison value —
  directly SOQL-compatible.

## Architecture

### Entry point (Tauri `index_org`, made smart)

On org-select the frontend already fire-and-forgets `index_org`. The command
becomes:

1. `api = api_version_for(org)`; `load_snapshot(root, org, api)`:
   - **Some(ost, manifest)** → `install_index(org, ost)` immediately
     (completion is ready at once, since `apex_complete` reads the same state
     concurrently), then run `sync_org(since = manifest.indexed_at)`. If the
     sync patched anything, `install_index(org, patched)` and emit a
     `sync-result` event.
   - **None** → run the full `index::index_org` (the existing Phase-1 path).

No frontend change is needed for the entry (still fire-and-forget); the only
new frontend wiring is the `sync-result` toast.

### Delta sync (`features::index::sync_org`)

`sync_org(invoker, root, org_id, &mut on_progress) -> Result<SyncOutcome, SfError>`:

1. `load_snapshot(root, org_id, api)` → `(ost, manifest)`; `since =
   manifest.indexed_at`. (If no snapshot, caller never calls sync — guaranteed
   by the entry logic.) Capture `started_at = now` for the new watermark.
2. **Changed Apex classes** — `fetch_changed_apex_classes(invoker, org, since)`
   = `SELECT Name, SymbolTable FROM ApexClass WHERE LastModifiedDate > <since>`
   → `parse_org_types` → **upsert** into `ost.org_types` (replace any same-name,
   case-insensitive; else append).
3. **Changed sObjects** — `fetch_changed_entities(invoker, org, since)` =
   distinct `QualifiedApiName` from the union of two Tooling queries:
   - `SELECT QualifiedApiName FROM EntityDefinition WHERE LastModifiedDate > <since>`
   - `SELECT EntityDefinition.QualifiedApiName FROM CustomField WHERE LastModifiedDate > <since>`

   For each affected entity, re-describe via `SchemaStore` (force-refresh, see
   below) → `schema_to_apex_type` → upsert into `ost.org_types`.
4. **Deletion reconcile** — fetch the full current name sets: class names
   (`fetch_apex_class_names`) ∪ sObject names (`list_sobject_names`). Retain
   only `ost.org_types` whose `name` is in that union (case-insensitive). This
   needs **no per-type origin marker** — surviving on a match to *either* list
   is correct (a deleted class/object is in neither → removed).
5. Persist: `save_snapshot(root, patched_ost, manifest')` where `manifest'`
   bumps `indexed_at = started_at` and recomputes counts. Return
   `SyncOutcome { added, updated, removed }`.

`on_progress` reuses the Phase-1 `IndexProgress` shape but with delta-sized
totals; the entry does NOT drive the top progress bar for delta (it is fast).

### Force-refresh describe

A changed sObject's describe is already disk-cached (stale) from the full
index. The re-describe must bypass that cache. `SchemaStore` currently has
`clear()` (whole-org) — add a targeted `evict(api, object)` (remove one cached
file + memory entry) so a delta re-describes only the changed objects without
nuking the whole schema cache.

### New acquisition queries (`apex-lang::acquire`)

- `fetch_changed_apex_classes(invoker, org, since) -> Result<Vec<Value>, SfError>`
  — same tooling path as `fetch_apex_symbols`, with the `WHERE LastModifiedDate
  > <since>` clause. Returns the `records` array (feed to `parse_org_types`).
- `fetch_changed_entities(invoker, org, since) -> Result<Vec<String>, SfError>`
  — runs the two tooling queries, flattens to distinct `QualifiedApiName`
  strings. Tooling queries via the same invocation `fetch_apex_symbols` uses
  (ApexClass/EntityDefinition/CustomField are all Tooling objects).

`since` is interpolated as a bare SOQL datetime literal (no quotes):
`LastModifiedDate > 2026-06-21T12:00:00Z`.

## Error handling

- Every query is best-effort. If **any** step of the delta fails (network,
  parse), the loaded full snapshot stays installed (completion keeps working)
  and `indexed_at` is **not** advanced, so the next org-select retries the same
  window. Only a fully-successful sync persists the new watermark.
- A re-describe that fails for one entity is skipped (that entity keeps its old
  OST type); it is not treated as a deletion (it is still in the name list).

## Components & boundaries

- `apex-lang::acquire` — two new pure-ish fetch fns (I/O + parse), unit-tested
  with a mock invoker.
- `sf-schema::SchemaStore::evict` — targeted cache eviction, unit-tested.
- `features::index::sync_org` + `SyncOutcome` — orchestration, unit-tested with
  a mock invoker (upsert / re-describe / reconcile / no-op / partial-failure).
- `desktop/src-tauri` — smart `index_org` entry + `sync-result` event.
- `desktop/src` — `sync-result` listener → toast.

## Testing

- **Rust unit (mock invoker):**
  - changed class upserts (members updated, same name replaced).
  - changed entity re-describes and updates that sObject type's fields.
  - reconcile removes an OST type absent from the union name-list; keeps present ones.
  - no changes → OST unchanged, `SyncOutcome` all-zero, `indexed_at` advanced.
  - partial failure (entity query errors) → snapshot unchanged, watermark not advanced.
  - smart entry: snapshot present → `sync_org` path taken, full `index_org`
    (bulk `fetch_apex_symbols`) NOT called (panicking on the bulk query).
  - `SchemaStore::evict` removes one object's cache file, leaves siblings.
- **Real-org e2e (`#[ignore]`):** select an already-indexed org → `sync_org`
  returns quickly with zero changes and advances `indexed_at` in the manifest.
- **Frontend:** `sync-result` with `N>0` shows the toast; `N==0` shows nothing
  (driven via the `__ufEmit` test hook).

## Known limitations

- `parse_org_types` flattens superclass/interface members within its input set
  only. A delta that re-fetches a *changed child* whose *parent did not change*
  will not re-flatten the (unchanged) parent's members onto it — the child
  keeps its own + any parents that happen to be in the same delta. Inherited
  members from unchanged parents reappear on the next full Reindex. Accepted:
  rare, and only affects inherited-member completion on a just-edited subclass.

## Out of scope

- Periodic background polling (chose org-select trigger only).
- Standard-field change detection (standard objects don't change; custom-field
  changes are covered via `CustomField`).
- Batched composite describe (the "kill per-object process spawn" optimization)
  — that is a separate performance item, not part of the delta design.
