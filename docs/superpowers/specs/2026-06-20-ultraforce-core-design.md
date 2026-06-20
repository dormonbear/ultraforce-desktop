# UltraForce Core Capabilities — Design Spec

**Date:** 2026-06-20
**Goal:** Close eight gaps in the SF·TOOLKIT desktop app and rebrand it to **UltraForce**: richer SOQL/Apex completion, offline-table refresh, tab rename + autosave, persistent run history, saved results, and a logging/metrics mechanism. Every feature ships with unit tests and a fixed (committed) e2e script.

## Architecture Decisions (recommended, locked)

- **Persistence backend:** `tauri-plugin-store` v2 (official, JSON, disk-backed in `appDataDir`). One store file `ultraforce.json`. Keys: `tabs.soql`, `tabs.apex`, `history`, `metrics`, `settings`. Chosen over sqlite (YAGNI) and over raw localStorage (we want disk durability + Rust access). Theme stays on its existing localStorage key (untouched, avoids breaking saved prefs).
- **Completion wire format:** unify SOQL onto the structured DTO Apex already uses. New shared shape `CompletionItem { label, kind, detail?, insert_text? }`. SOQL command return type changes `Vec<String>` → `Vec<CompletionItem>`. Monaco maps `kind` → `CompletionItemKind` for icons.
- **Logging/metrics:** Rust `tracing` + `tracing-subscriber` + `tracing-appender` → daily-rotating file `appDataDir/logs/ultraforce.log`. Frontend run events also recorded as lightweight metrics in the store (`metrics`: counters + last N durations). No external telemetry, no Prometheus (YAGNI).
- **OST refresh:** expose existing `SchemaStore::invalidate` + a new "rebuild current org schema cache" path via a Tauri command `refresh_schema_cache`; surface a refresh control in the UI. Refreshing the sObject list (for FROM completion) reuses the same command.

## Feature Designs

### 1. SOQL completion (context-aware)
`crates/soql-lang/src/complete.rs`: expand `CandidateKind` to `{ Field, Object, Keyword, Function, Relationship }`. Detect clause at cursor (SELECT / FROM / WHERE / ORDER BY / GROUP BY / HAVING / LIMIT / OFFSET). Emit:
- SELECT / WHERE / ORDER BY / GROUP BY: fields + aggregate/date functions + clause keywords.
- FROM: sObject names (from a provided list) + already-known object.
- Anywhere: clause keywords valid at that position.
Ship a static SOQL keyword list and the 21 that plugin function names (AVG, COUNT, COUNT_DISTINCT, MAX, MIN, SUM, CALENDAR_*, DAY_*, FISCAL_*, HOUR_IN_DAY, WEEK_*, CONVERTCURRENCY, CONVERTTIMEZONE, DISTANCE, FORMAT, GROUPING, TOLABEL, FIELDS). `complete()` gains an `objects: &[String]` param for FROM completion (caller passes cached sObject names; empty slice allowed).

### 2. Apex completion (richer keywords)
`crates/apex-lang/src/complete.rs`: replace the 10-keyword list with the full Apex keyword/modifier set, plus annotations (`@AuraEnabled`, `@isTest`, `@TestSetup`, `@future`, `@InvocableMethod`, `@RemoteAction`, `@SuppressWarnings`, `@Deprecated`, `@TestVisible`, `@ReadOnly`, `@HttpGet/Post/Put/Patch/Delete`) and primitive types (`Integer, String, Boolean, Decimal, Double, Long, Date, Datetime, Time, Id, Blob, Object`). Annotations emitted only in `TopLevel` context when prefix starts with `@`. Keep existing type/member/chain resolution.

### 3. Offline table refresh
New Tauri command `refresh_schema_cache(org) -> Result<usize>` that invalidates the org's cached schemas and re-lists sObjects. UI: a refresh icon button (Schema/data area; reuse OrgSelector row) with a toast on success/failure and a spinner while running.

### 4. Tab rename + autosave
- Rename: double-click a tab title → inline `<input>`; Enter/blur commits via `patch(id,{title})`; Esc cancels. Add `renamed?: boolean` so autonumber titles stay live until user renames.
- Autosave: `useTabs` serializes `{tabs, activeId}` (per tool) to the store, debounced 400ms. On mount, hydrate from store; fall back to one fresh tab. Results are part of the tab shape so they persist with the tab.

### 5. Run history (persistent)
On each SOQL/Apex run, append a `HistoryEntry { id, tool, org, text, status, durationMs, rowCount?, at }` to `history` (cap 200, FIFO). History drawer (⌘K-reachable + a clock icon) lists entries; clicking one opens a new tab pre-filled with the text. Result snapshots are referenced by the originating tab, not duplicated, except small metadata (rowCount/status).

### 6. Saved results
Covered by #4 (results live in the tab and persist). Additionally, the most recent result per tab is restored on hydrate so reopening the app shows the last grid without rerunning.

### 7. Logging / metrics
Rust: init `tracing` subscriber at startup (file appender + level from `ULTRAFORCE_LOG`/default info). Instrument command handlers (run_soql, run_apex, completion, schema refresh) with spans + durations. Frontend: a tiny `metrics.ts` that, on each run, increments counters and pushes the duration into `metrics` (last 50). A debug "Metrics" view (optional, behind ⌘K) renders counts. Failures always logged at warn/error.

### 8. Rebrand → UltraForce
Apply the rename table (package names, crate lib name + import in main.rs, tauri productName/identifier/title, index.html title, App wordmark, cache-dir `sf-toolkit`→`ultraforce`, debug level developer name, anon-apex temp filename). Cache-dir change: no migration — caches auto-refetch (acceptable). Bundle identifier `com.sftoolkit.desktop`→`com.ultraforce.desktop` (pre-release, no signed installs to preserve).

## Testing strategy
- **Rust unit tests** colocated: soql-lang completion (keywords per clause, functions, FROM objects), apex-lang keyword/annotation emission, store invalidate.
- **Frontend unit (vitest):** store serialization/hydration, tab rename reducer, history cap FIFO, metrics counters.
- **E2E (committed/fixed):** a Playwright script under `desktop/e2e/` with mocked Tauri IPC + a fixtures file, asserting: SOQL keyword completion appears, Apex annotation completion appears, tab rename persists across reload, history entry appears after run + reopens, schema refresh toast, brand text reads "ULTRAFORCE". Script + fixtures committed; runnable via `pnpm e2e`.

## Out of scope
LSP-grade semantic Apex completion, sqlite, cloud telemetry, signed-release update migration.
