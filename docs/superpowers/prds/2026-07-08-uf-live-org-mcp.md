# PRD: uf-ost MCP Live-Org Expansion — Replace Raw `sf` CLI for Agent Workflows

**Date:** 2026-07-08
**Status:** Decisions locked via grilling session; ready for spec/planning
**Owner:** Dormon
**Execution note:** Coding tasks are delegated to Opus agents; Fable does analysis/review only.

## Problem — Evidence from Session History

Analysis of 1,018 local Claude Code sessions (~887 MB, report:
`sf-usage-analysis/sf-usage-report.md` in session scratchpad):

- **3,534 raw `sf` CLI calls**; official Salesforce MCP tools used **zero** times.
  Top: `sf data query` 1541, `sf project deploy` 659, `sf apex run` 565,
  `sf project retrieve` 137, `sf sobject describe` 134, `sf data update` 63.
- **326 failures (9.2%), 256 retry streaks.** ~70% of failures are NOT Salesforce
  errors but JSON post-processing breakage: `--json | python3` pipelines polluted
  by oclif update warnings (125× JSONDecodeError), `KeyError: 'result'` masking
  real org errors as Python tracebacks (58×), jq failures (44×). Worst case:
  9 consecutive blind query reformulations.
- 134 describe-before-query round-trips (3–4 wasted tool calls each).
- 18 two-minute Bash timeouts (apex run 7, deploy 5, query 4).
- 91.4% of usage in omni-stack; dominant workflow is SFDC/SFOA Live-vs-Staging
  comparison loops.

**Primary value proposition:** MCP tools return clean structured JSON natively —
the fragile `--json | python3 | jq` pipeline disappears, eliminating ~70% of the
historical failure surface. Offline pre-validation and safety rails are secondary.

## Locked Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Scope | **Anti-fumble query layer for agent high-frequency interactions** — not a full sf CLI replacement. SOQL, record read/write, anonymous Apex, plus a deploy safety gate. |
| 2 | Auth | **Reuse sf CLI auth** via existing `sf-core::OrgRegistry::auth_info` (`sf org display --json`). No new OAuth. |
| 3 | Writes | **Read + controlled writes.** Single/small-batch DML with safety rails; bulk DML stays out (belongs to sf CLI/scripts with fail-loud ceremony). |
| 4 | Live query × OST index | **Mandatory offline pre-validation before REST execution** (reuse `ost_soql` logic; did-you-mean locally, zero org round-trip on typos). Must degrade to pass-through when index missing/stale — block only on certain errors. Plus: enrich org errors (INVALID_FIELD etc.) with index-derived fix suggestions. |
| 5 | Deploy | **In scope as a mandatory team-safety gate**, not a deploy engine. `deploy` tool internally runs precheck and refuses unless clean or explicitly confirmed; execution shells out to `sf project deploy start`. Precheck: (a) target components' org LastModifiedBy vs current user — warn on overwrite risk; (b) org-version vs local diff for expectation check; (c) production double-confirm. Deploy tools take a project path (isolated tool domain; rest of MCP stays org-bound). |
| 6 | Prod detection | **Auto-detect**: `SELECT IsSandbox FROM Organization` once per org, cached permanently. Query failure ⇒ treat as prod until proven otherwise. Never infer from alias names. |
| 7 | Telemetry | **Log ALL tool invocations** (not just failures) to a separate SQLite file (e.g. `~/.ultraforce/telemetry.db` — NOT index.db, which schema-version guard may rebuild). Fields: timestamp, tool, org, truncated params, outcome, duration; full error text on failure. Size-based rotation (~50MB). Query via sqlite3 directly; no dedicated query tool. |
| 8 | Migration/enforcement | **Phased.** v1: ship MCP + update CLAUDE.md rules; measure replacement rate via telemetry. **Exception: raw `sf project deploy` is hook-blocked from day one** (the gate is worthless if bypassable). Harden query/DML/apex classes to hook-blocking once MCP proves stable (~2 weeks of telemetry). |

## v1 Tool Surface (adds to existing 11 offline `ost_*` tools)

| Domain | Tool | Notes |
|--------|------|-------|
| Read | `soql_query(org, query, tooling?)` | Pre-validate → REST execute → clean JSON, pagination, row cap |
| Read | `record_get(org, object, id)` | Full record, all fields |
| Write | `record_create/update/delete(org, …)` | Prod requires `confirm: true`; single/small-batch only |
| Write | `apex_run(org, code)` | No 2-min hard timeout; structured result + trimmed debug log; prod requires `confirm` |
| Deploy | `deploy_precheck(org, projectPath, paths)` | LastModifiedBy check + org-vs-local diff |
| Deploy | `deploy(org, projectPath, paths, confirm?)` | Gate + shell out to sf CLI |
| Escape | `rest_request(org, method, path, body?)` | Generic REST escape hatch so agents never fall back to curl/CLI |

**Deliberately excluded:** `sf org open` (no pain), `sf project retrieve`
(workspace domain), live describe (offline `ost_object` + `ost_sync` covers it —
describe-before-query is the pattern being eliminated), `soql_diff` cross-org
comparison tool (two `soql_query` calls suffice; revisit if telemetry shows
round-trip waste), bulk DML, real-time anomaly detection in telemetry (add after
data accumulates).

## Reuse Map

- `features::soql::run_query_rest` — REST query + pagination
- `features::anon_apex` — anonymous Apex execution
- `crates/uf-ost/src/soql.rs` — offline SOQL validation (pre-validation step)
- `sf-core::{SfInvoker, OrgRegistry, AuthInfo}` — auth/token
- `sf-schema::puller` — describe/composite REST patterns
