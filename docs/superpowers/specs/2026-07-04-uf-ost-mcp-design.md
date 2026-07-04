# uf-ost — SQLite OST Storage + MCP Server — Design

Date: 2026-07-04
Status: approved-pending-spec-review
Decisions locked via grilling session (10 questions); supersedes the JSON-storage
variant sketched in the omni-stack prototype.

## 1. Goal & positioning

Expose ultraforce's org index (OST: sObject schema + Apex symbols) to AI coding
agents through a native MCP server, and move the index's persistence from
JSON-files to SQLite.

- **Positioning (grill Q1 = B): self-use first, published as-is.** Differentiators
  vs Salesforce's official DX MCP: token-lean line-filtered output, offline Apex
  SymbolTable index (nobody wants the ~145s ApexClass query live), and shipped
  agent retrieval discipline (the skill). No benchmarks, no support commitments,
  no multi-client docs in v0.
- **Dogfood (Q2 = A):** the author's private workspace (omni-stack) migrates to
  this MCP — query side first, generation side once `ost_reindex` is stable. Its
  Node prototype (`ost.mjs`) serves as a differential-test oracle during
  migration, then dies.

## 2. Locked decisions (grill summary)

| # | Decision |
|---|---|
| Q1 | Self-use first, publish as-is (MIT, existing repo) |
| Q2 | omni-stack migrates; ost.mjs = diff oracle then deleted |
| Q3 | Single bin `uf-ost`, subcommands `serve` / `index` / `status`; existing `ost-index` bin absorbed, old name dropped |
| Q4* | 6 query tools + 2 refresh tools (user-amended: two refresh modes, see §5) |
| Q5 | Per-response stamping (org + snapshot age); WAL replaces the tmp-rename/lockfile machinery (superseded by SQLite) |
| Q6 | Both upstream fixes in scope: fetch_apex_symbols timeout; stdlib fail-loud |
| Q7 | Machine-wide snapshot root = app's `default_index_root()`; org key = **sf alias**; `--root`/env override; omni-stack `db/ost` retired |
| Q8 | bin `uf-ost` (crate `crates/uf-ost/`), MCP server name `ultraforce`, tools `ost_*` |
| Q9 | Skill ships in-repo at `skills/ost/SKILL.md` (skills-CLI installable) |
| Q10 | Phased: storage first, MCP second (see §7) |
| — | **SQLite in scope** (user override): canonical storage, both app + MCP |
| — | Out: GUI panel, job-id system, benchmarks, multi-client presets, marketplace, drift alerting |

## 3. Storage: SQLite replaces the JSON snapshot (Phase 1)

**Why (honest basis):** measured JSON perf is fine (42 MB index.json parses in
86 ms, full field scan 8 ms) — the win is NOT speed. SQLite buys: (a) WAL
concurrency — readers see a consistent snapshot while a background reindex
writes; full reindex commits in one transaction (no mixed-generation reads, no
lockfile/tmp-rename machinery); (b) low resident memory for the MCP server
(page cache instead of ~100–200 MB of parsed structs); (c) FTS5 → `ost_search`
for free; (d) no 4–5k small files per org.

**Layout:** one DB per org under the shared root: `<root>/<alias>/index.db`
(`default_index_root()` = e.g. `~/.cache/ultraforce/`). Per-org lifecycle stays
trivial: reindex = rebuild rows in one transaction; drop org = delete file.

**Schema (v1 — plan refines details):**
- `meta` — schema_version, org alias, org_id, api_version, indexed_at
  (watermark), generation, `stdlib_error` (nullable text; fail-loud carrier)
- `apex_types` — name, kind, namespace (NULL = org type, else stdlib namespace),
  parent_class, interfaces JSON, enum_values JSON
- `apex_members` — type rowid, member kind (method/property), name, return/prop
  type, params JSON, is_static
- `objects` — name, label, label_plural, key_prefix, custom
- `fields` — object rowid, name, label, type, custom, nillable, reference_to
  JSON, relationship_name, picklist JSON (`[{label,value,active,defaultValue}]`)
- `raw_cache` — blobs table for OstStore's raw fetch responses (the 57 MB
  `org_types.json` moves here, out of any query surface)
- FTS5: `fields_fts(object_name, field_name, field_label)` +
  `apex_fts(type_name)` — powers `ost_search`

**What changes in existing code:** `apex-lang/src/snapshot.rs`
(save/load_snapshot) and `sf-schema/src/store.rs` (SchemaStore read/write) gain
SQLite backends; the in-memory `Ost`/`SObjectSchema` structs and all callers
(desktop app, completions) are unchanged — load = SELECT into the same structs.
`rusqlite` (bundled) is the only new dependency.

**Migration:** snapshots are rebuildable derived data. If `index.db` is absent
and an old JSON snapshot exists, treat as absent → reindex. No importer.

**Upstream fixes folded into Phase 1 (Q6):**
1. `fetch_apex_symbols` (acquire.rs) gets its own extended timeout via
   `run_raw_with_timeout` (like its siblings: completions 300s, describe 180s) —
   removes the bin-level 300s workaround; the desktop app benefits too.
2. stdlib fetch fail-loud: a Tooling error (e.g. a managed package's bad
   `@AuraEnabled`) no longer silently yields empty namespaces — the error is
   recorded in `meta.stdlib_error` and surfaced by `ost_status` / the app.

## 4. `uf-ost` bin (Phase 2)

New crate `crates/uf-ost/` — single binary, three subcommands:
- `uf-ost serve` — MCP server over stdio (official `rmcp` SDK, version pinned;
  pre-1.0 API churn accepted). Resident: opens per-org DBs lazily read-only.
- `uf-ost index --org <alias> [--sync] [--root <dir>] [--policy all]` — headless
  indexer (absorbs the old `ost-index` bin): full `index_org` or watermark
  `sync_org`, writing SQLite. Used by launchd/cron and by `ost_reindex`'s spawn.
- `uf-ost status [--org <alias>]` — meta table dump (freshness, counts,
  stdlib_error, running-reindex state).

Root resolution: `--root` flag > `UF_OST_ROOT` env > `default_index_root()`.

## 5. MCP tool surface (8 tools, server name `ultraforce`)

Every response is stamped with `org` + `snapshot age` (from `meta.indexed_at`) —
staleness defense lives in the tool, not only the skill.

**Query (synchronous, read-only, ms-level):**
| Tool | Returns |
|---|---|
| `ost_object(org, object)` | fields: name, type, referenceTo, picklist flag, custom |
| `ost_field(field, org?)` | which objects/orgs carry the field + type (omit org = all orgs; drift check) |
| `ost_picklist(org, object, field)` | active picklist values (label = value, default flag) |
| `ost_apex(org, name)` | Apex class/interface/enum member signatures (org types; stdlib best-effort per `stdlib_error`) |
| `ost_search(query, org?)` | FTS5 fuzzy match over object/field names + labels, and Apex type names — for when the agent doesn't know the exact API name |
| `ost_status(org?)` | per-org freshness, counts, stdlib_error, reindex-in-progress |

**Refresh (user-designed two-mode split):**
- `ost_sync(org)` — **synchronous** watermark delta (`sync_org`): catches changed
  classes/objects, returns `{added, updated, removed}`. Seconds; the agent waits.
- `ost_reindex(org)` — **async, global singleton**: spawns `uf-ost index --org …`
  detached and returns `started` | `already_running` immediately (singleton via
  a lock row/file; no job-id system). Progress surfaces on `ost_status`. The
  skill instructs agents to fall back to live `sf` CLI queries while it runs.

## 6. Skill (`skills/ost/SKILL.md`, in-repo, skills-CLI installable)

Content contract: when to consult OST (before SOQL/Apex, field/object
verification, cross-org drift) — and the retrieval discipline:
1. Trust but verify freshness: check the response's snapshot-age stamp;
   `ost_status` when in doubt.
2. On contradiction with observed reality: `ost_sync` first (cheap), re-query.
3. If sync doesn't reconcile or staleness is broad: `ost_reindex`, then use live
   `sf` CLI for the interim — do not wait on the reindex.
4. stdlib misses are expected when `stdlib_error` is set — org types and
   sObjects are unaffected.

omni-stack's private skill is rewritten to this content at migration.

## 7. Phasing (Q10 = A: storage first, MCP second)

1. **Phase 1 — SQLite persistence** in `apex-lang` + `sf-schema` (+ the two
   upstream fixes). Verified by: existing crate tests green, desktop app
   indexes + completes against SQLite, `uf-ost`-precursor CLI round-trip.
2. **Phase 2 — `uf-ost` crate**: subcommands + 8 MCP tools on SQLite; skill file;
   README section ("Use your org in your AI agent", storage-location and org-IP
   sensitivity note, API-consumption note for reindex).
3. **Phase 3 — omni-stack migration** (private workspace, not in this repo):
   `.mcp.json` points at `uf-ost serve`; skill swapped; differential check
   `ost.mjs` vs MCP on the same org; launchd switches to `uf-ost index --sync`;
   `db/ost` retired.

Each phase lands independently; Phase 2 never reads JSON (no throwaway reader).

## 8. Open/known items

- App-vs-CLI org-key consistency: the desktop app may key snapshots by username
  rather than alias — v0 convention is "operate by alias"; unification is a
  follow-up alignment item.
- `rmcp` pre-1.0: pin exact version; expect breaking bumps.
- Multi-org confusion is a real hazard (agent reads sandbox schema, writes prod
  code) — mitigated by mandatory org stamping on every response.
- Reindex API consumption (~4–5k describes + the heavy ApexClass query) — noted
  in README.

## 9. Out of scope (deferred until external demand exists)

GUI toggle/panel, job-id system (superseded by singleton design), benchmark
table, multi-client presets, marketplace/registry listings, scheduled drift
alerting (passive cross-org queries via `ost_field` already cover the need).
