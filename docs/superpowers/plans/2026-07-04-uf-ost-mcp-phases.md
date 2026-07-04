# uf-ost — Phase Plan & Session Handoff

> **For the executing session (fresh, in this repo):** Read the spec FIRST —
> `docs/superpowers/specs/2026-07-04-uf-ost-mcp-design.md` (all 10 locked
> decisions; do not re-litigate them). This document adds the execution order,
> per-phase verification gates, and facts learned in the origin session that
> this repo cannot tell you. Turn each phase into a detailed task plan
> (superpowers:writing-plans) before implementing; phases land independently.

**Goal:** SQLite OST persistence (Phase 1) → `uf-ost` MCP server bin (Phase 2)
→ omni-stack workspace migration (Phase 3, happens outside this repo).

## Global constraints

- NEVER `git push` — local commits only; pushing is the user's job.
- Commits: this repo's conventional style; `--no-gpg-sign` is authorized
  (1Password signing fails non-interactively; per-invocation flag, never touch
  `.git` config).
- License MIT (repo-wide). New deps: `rusqlite` (bundled) in Phase 1, `rmcp`
  (pin exact pre-1.0 version) in Phase 2. Nothing else.
- Org snapshots key by **sf alias**; root = `default_index_root()`, overridable
  by `--root` / `UF_OST_ROOT`.
- Never commit snapshot data or anything containing org describe output.

## Facts from the origin session (not derivable from this repo)

1. **Measured perf (SFDC_Staging, large managed org):** `index.json` 42 MB,
   11 326 org_types; cold parse 86 ms; full field scan 8 ms; rich describes
   4 145 files / 130 MB, largest single object 3.7 MB. SQLite's win is WAL
   concurrency + FTS + resident memory — NOT speed. Don't build perf machinery.
2. **`fetch_apex_symbols` timeout flake:** `SELECT Name, SymbolTable FROM
   ApexClass` takes ~145 s / ~70 MB on that org; the default 120 s invoker
   timeout kills it. Workaround currently in `crates/features/src/bin/ost-index.rs`
   (invoker `.with_timeout(300s)`, commit 87d6fff). Phase 1 fixes it properly in
   `apex-lang/src/acquire.rs` (give it `run_raw_with_timeout` like its siblings:
   completions 300 s, describe 180 s) and the bin workaround is then removed
   along with the bin itself (absorbed into `uf-ost index`).
3. **stdlib silently empty:** on SFDC_Staging the completions Tooling call errors
   on a managed package's bad `@AuraEnabled` (`sfdc_surveys.ChildQuestion`) and
   `parse_stdlib` yields empty namespaces with no error surfaced. Phase 1 makes
   this fail-loud into `meta.stdlib_error`.
4. **Key-shape trap that motivated Rust-native:** the per-object describe JSON on
   disk is raw SF **camelCase** (`type`, `referenceTo`, `picklistValues`,
   `defaultValue`, `keyPrefix`) while `Ost`/`index.json` is snake_case. The Node
   prototype shipped a bug from assuming one shape. In Rust, reading/writing the
   typed structs kills this bug class — keep everything going through the structs.
5. **57 MB raw-cache pollution:** `OstStore` persists raw fetch responses (e.g.
   `<api>/apex-ost/org_types.json`) inside the org dir. In SQLite this moves to
   the `raw_cache` blobs table, out of any query surface.
6. **Oracle for Phase 3 diffing:** the Node prototype lives at
   `/Users/dormonzhou/Projects/omni-stack/scripts/ost.mjs` → wait, exact path:
   `/Users/dormonzhou/Projects/omni-stack/scripts/ost/ost.mjs`, reading
   `/Users/dormonzhou/Projects/omni-stack/db/ost/<alias>/`. A verified JSON
   snapshot for SFDC_Staging exists there (built 2026-07-03) — usable as ground
   truth for differential tests without re-indexing.

## Phase 1 — SQLite persistence (+ two upstream fixes)

**Touches:** `crates/apex-lang/src/snapshot.rs` (save/load), `crates/sf-schema/src/store.rs`
(SchemaStore), `crates/apex-lang/src/acquire.rs` (fixes #2/#3), callers as needed.
In-memory structs (`Ost`, `ApexType`, `SObjectSchema`) and their consumers
(desktop app, completions) stay unchanged — load = SELECT into the same structs.

Schema (refine in the detailed plan): `meta` (schema_version, org alias, org_id,
api_version, indexed_at watermark, generation, stdlib_error), `apex_types`,
`apex_members`, `objects`, `fields` (picklist/reference_to as JSON columns),
`raw_cache`, FTS5 `fields_fts` + `apex_fts`. One DB per org:
`<root>/<alias>/index.db`, WAL mode. Full reindex = one transaction.
Migration: none — if `index.db` absent, reindex (snapshots are derived data);
old JSON snapshots are simply ignored.

**Gate:** existing crate tests green; desktop app indexes an org into SQLite and
completions work; `sync_org` delta round-trips (watermark advances, upserts,
delete-reconcile only when both name lists non-empty — preserve that guard);
stdlib_error populated on an erroring org instead of silent empty.

## Phase 2 — `uf-ost` crate (bin + MCP)

**New:** `crates/uf-ost/` single bin, subcommands `serve` (MCP stdio via rmcp) /
`index --org <alias> [--sync]` (absorbs `crates/features/src/bin/ost-index.rs` —
delete the old bin) / `status`. 8 tools per spec §5: `ost_object`, `ost_field`,
`ost_picklist`, `ost_apex`, `ost_search` (FTS5), `ost_status`, `ost_sync`
(synchronous delta), `ost_reindex` (async global singleton: spawn detached
`uf-ost index`, return started/already_running, progress on `ost_status`).
Every response stamped with org + snapshot age. Skill at `skills/ost/SKILL.md`
per spec §6; README section (storage location, org-IP sensitivity, reindex API
consumption note).

**Gate:** `uf-ost index --org SFDC_Staging` full-builds into SQLite; all 8 tools
answer over MCP stdio (test with a scripted client or `rmcp` test harness);
reindex singleton proven (second `ost_reindex` returns already_running); org+age
stamp present on every response.

## Phase 3 — omni-stack migration (outside this repo; coordinate with the user)

In `/Users/dormonzhou/Projects/omni-stack`: point `.mcp.json` at `uf-ost serve`;
rewrite `.claude/skills/ost/SKILL.md` to the MCP version (copy of this repo's
`skills/ost/SKILL.md`); differential check — same org, `ost.mjs` (JSON) vs MCP
(SQLite) query outputs agree; switch launchd `com.dormon.ost-sync` to
`uf-ost index --sync` per org; retire `db/ost` and the `scripts/ost/` prototype
(keep `ost.mjs` until the diff check passes). Org list for launchd stays in the
wrapper script.

**Gate:** the user's daily agent workflow answers a field/picklist/drift question
via `mcp__ultraforce__ost_*` with correct org+age stamps; launchd log shows a
successful delta run; prototype removed.

## Deferred (do not build)

GUI panel, job-id system, benchmarks, multi-client presets, marketplace/registry
listings, drift alerting — see spec §9.
