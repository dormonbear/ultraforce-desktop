# Batched Composite Describe — Design

**Date:** 2026-06-21
**Status:** Approved

## Problem

A full offline index of a managed-package org (`index_org`) takes ~926s
(~15.5 min) even at 8-way concurrency. The bottleneck is **one `sf` node
process spawned per sObject describe** (`sf sobject describe -s <obj> --json`):
hundreds of objects × node startup dominates wall time. Raising concurrency
does not scale — it doesn't remove the per-process cost and is capped by org
rate limits and local process limits.

## Goal

Cut the per-process spawn count by describing sObjects in batches via the
Salesforce **Composite REST API**: one `sf api request rest .../composite`
call describes up to 25 objects. Spawn count drops from `N` to `N/25`.

## Approach

Composite REST (`POST /services/data/vXX/composite`) with up to 25
`GET /sobjects/{name}/describe` subrequests per call. Chosen over
`/composite/batch` (equivalent, less common) and over "just raise concurrency"
(rejected — doesn't remove the per-process cost).

## Scope

Both bulk-describe paths route through the new batched primitive:
- `features::index::index_org` — the full-index path (the ~15 min cost).
- `features::index::sync_org` — re-describing changed entities on delta sync.

The single-object on-demand describe path (`apex_complete`) is unchanged — a
composite of one object has no benefit.

## Components

### 1. Pure primitives — `crates/sf-schema/src/puller.rs`

- `build_composite_request(api_version: &str, names: &[String]) -> serde_json::Value`
  builds `{"compositeRequest":[{"method":"GET","url":"/services/data/v{api}/sobjects/{name}/describe","referenceId":"r{i}"}, ...]}`.
- `parse_composite_response(raw: &str) -> Vec<SObjectSchema>` deserializes the
  `compositeResponse` envelope, keeps entries with `httpStatusCode == 200`,
  parses each `body` into `SObjectSchema`. Each describe body carries its own
  `name`, so no referenceId→name remapping is needed. Non-200 entries skipped.
- `describe_objects(invoker, org, api_version, names: &[String]) -> Result<Vec<SObjectSchema>, SfError>`
  — one composite call for `names` (caller guarantees `names.len() <= 25`).
  Runs `sf api request rest /services/data/v{api}/composite --method POST
  --body <json>`, pinned to `org` via `with_target`, through
  `run_raw_with_timeout(DESCRIBE_BATCH_TIMEOUT)`. The `api request rest` beta
  command rejects `--json`, so it uses raw stdout + `serde_json` parse (mirrors
  `apex_lang::acquire::fetch_completions`).

`with_target` helper (append `--target-org <org>` unless org empty/"default")
is duplicated minimally in this crate or imported — see Plan. `const
COMPOSITE_MAX: usize = 25;` and `const DESCRIBE_BATCH_TIMEOUT: Duration =
Duration::from_secs(180);`.

### 2. Cache layer — `crates/sf-schema/src/store.rs`

`SchemaStore::get_or_fetch_many(&mut self, invoker, api_version, names: &[String],
on_progress: &mut dyn FnMut(usize, usize)) -> Vec<(String, SObjectSchema)>`:

1. Partition `names`: mem hit → collect; else disk hit (`load_disk`) → collect;
   else → `missing`.
2. Describe `missing` in waves: chunk into `COMPOSITE_MAX` (25) groups, run up
   to `COMPOSITE_CONCURRENCY = 4` groups concurrently via `tokio::task::JoinSet`
   (each `describe_objects` call is independent and self-contained).
3. After each wave joins, **serially** `persist` each schema + `mem.insert`,
   then call `on_progress(done, total)`.
4. Return all `(name, schema)` pairs (cached + freshly described).

A whole composite call that errors (process failure / non-JSON) drops that
wave's objects and continues — same semantics as today's per-object `.ok()`
drop, just batched. No per-batch single-describe fallback (YAGNI).

### 3. Wiring

- `index_org`: replace the per-object `JoinSet` loop with one
  `store.get_or_fetch_many(invoker, &api, &names, &mut on_progress_adapter)`
  call. The adapter emits `IndexProgress { phase: "sobjects", done, total }`.
  Then map each returned schema → `schema_to_apex_type`, push into `org_types`,
  count `sobjects`.
- `sync_org`: `invalidate` all changed entities first, then one
  `get_or_fetch_many(&entities, &mut |_, _| {})`, then `upsert` each returned
  schema's `schema_to_apex_type` (count added vs updated). Reconcile and
  watermark logic unchanged.

## Data Flow

`names` → cache partition → `missing` chunked 25 → ≤4 concurrent composite
POSTs → parse 200 bodies → persist + cache → `schema_to_apex_type` → OST.

## Error Handling

- Whole composite call fails → drop that wave's objects, continue indexing.
- Subrequest `httpStatusCode != 200` → skip that object.
- Neither aborts the index/sync.
- `with_target` pins composite describes to the selected org (the bulk path no
  longer hits the CLI default org). The pre-existing single-object
  `describe_object` still sends no `--target-org`; that is a separate latent
  issue and is **out of scope** here.

## Testing

- Unit (pure): `build_composite_request` (URLs, referenceIds, method),
  `parse_composite_response` (keeps 200, skips non-200, parses bodies).
- Unit (MockRunner): `describe_objects` sends one composite call with
  `--target-org` appended and parses the envelope into schemas.
- Unit (MockRunner): `get_or_fetch_many` — already-cached objects do not
  trigger a describe (counting runner), missing ones do, results persisted to
  disk and returned.
- Update existing `index_assembles_classes_and_sobjects_and_persists` mock to
  answer the composite POST (wrap the Account describe in a `compositeResponse`).
- Add a `sync_org` test where a changed entity triggers a composite describe
  and is upserted.
- Real-org e2e: re-run `e2e_index_org_offline` (`#[ignore]`) against the
  `ultraforce` dev org and **report the new wall time** vs the 926s baseline.
  Correctness assertions (stdlib + classes + Account present, snapshot reloads,
  offline completion) stay; the headline result is the wall-time drop.

## Out of Scope

- On-demand single-object describe (`apex_complete`) — no benefit at size 1.
- Fixing `describe_object`'s missing `--target-org` (pre-existing, separate).
- Per-batch single-describe fallback (YAGNI).
- Frontend — no changes; progress events unchanged.
