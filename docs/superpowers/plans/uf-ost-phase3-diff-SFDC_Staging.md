# uf-ost Phase 3 — differential check result (SFDC_Staging)

**Date:** 2026-07-04
**Gate:** Phase 3 gate 3 — `ost.mjs` (JSON oracle) vs `uf-ost` MCP (SQLite) query outputs must agree.
**Verdict:** ✅ PASS — zero content divergence.

## Method

- Oracle: `omni-stack/db/ost/SFDC_Staging/{index.json, 67.0/*.json}` (built 2026-07-03, 4145 rich describes, 11326 org_types).
- Under test: `uf-ost serve` (release bin) reading `~/.cache/ultraforce/SFDC_Staging/index.db` (built 2026-07-04, gen 1, 11059 classes / 4144 sObjects).
- Harness drives the real MCP server over stdio (`ost_object`/`ost_picklist`/`ost_apex`/`ost_status`) and compares against the oracle's rich describes / `index.json`. Deterministic sample (key objects + every-Nth spread).

## Results

| Surface | Result |
|---|---|
| Objects (rich describe field sets) | **99/99** clean — 0 type mismatch, 0 referenceTo mismatch, 0 picklist-flag mismatch, 0 fields missing/added |
| Picklists (active label/value/default sets) | **25/25** exact match |
| Apex (method-name sets) | **32/32** clean |
| Apex coverage (oracle class found in MCP) | **150/150** |

Zero divergence despite the snapshots being a day apart — the SQLite rebuild faithfully reproduces the oracle's OST facts.

## Count reconciliation (not a bug)

- `index.meta.json` `classes: 7087` / `sobjects: 4922` are the raw SOQL/global-describe row counts at build time.
- `index.json` actually expands to **11326 org_types**; uf-ost stores **11059** apex classes (150/150 sampled coverage — no loss) and **4144** sObjects (= 4145 rich describe files minus the `apex-ost` non-object entry).

## Remaining Phase 3 (user-coordinated, outside this repo)

1. Commit omni-stack wiring (4 OST files) on a branch — never commit to `main` directly.
2. Index remaining orgs: SFOA_Staging (sandbox, safe); SFDC_Live / SFOA_Live (**PROD** — read-only describes but consume API, confirm first).
3. Switch launchd `com.dormon.ost-sync` → `uf-ost index --sync`; retire `db/ost/` + `scripts/ost/ost.mjs`.

Harness scripts: `$CLAUDE_JOB_DIR/tmp/ost-diff.mjs`, `apex-coverage.mjs` (ephemeral).
