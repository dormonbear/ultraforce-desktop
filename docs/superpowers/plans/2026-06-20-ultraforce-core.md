# UltraForce Core Capabilities — Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with build/test verification. Backend integration tasks share files — respect the wave ordering to avoid conflicts.

**Goal:** Ship the 8 gaps from the spec and rebrand to UltraForce, each with tests + a committed e2e script.

**Architecture:** `tauri-plugin-store` for persistence; unified structured completion DTO; `tracing` file logging + store-based metrics. See `docs/superpowers/specs/2026-06-20-ultraforce-core-design.md`.

**Tech Stack:** Rust workspace, Tauri 2, React 19, Vite, Tailwind v4, Monaco, TanStack Table, Playwright, vitest.

## Global Constraints
- Brand name everywhere user-facing: **UltraForce** / wordmark `ULTRAFORCE`.
- Completion DTO shape (shared): `CompletionItem { label: String, kind: String, detail: Option<String>, insert_text: Option<String> }`; TS `{ label; kind; detail?; insertText? }`.
- Store file: `ultraforce.json` in appDataDir. Keys: `tabs.soql`, `tabs.apex`, `history`, `metrics`, `settings`.
- All Rust crates must pass `cargo fmt --check`, `cargo clippy`, `cargo test`. Frontend: `pnpm tsc --noEmit`, `pnpm build`, `pnpm vitest run`.

---

## Wave 1 — Isolated language crates (parallel, no shared files)

### Task 1: SOQL context-aware completion (`crates/soql-lang`)
**Files:** Modify `crates/soql-lang/src/complete.rs`; add tests in same file.
**Interfaces — Produces:**
`pub enum CandidateKind { Field, Object, Keyword, Function, Relationship }`
`pub struct Candidate { pub label: String, pub kind: CandidateKind, pub detail: Option<String> }`
`pub fn complete(input: &str, cursor: usize, schema: &SObjectSchema, objects: &[String]) -> Vec<Candidate>`
- Detect clause at cursor: SELECT / FROM / WHERE / ORDER BY / GROUP BY / HAVING / LIMIT / OFFSET / none.
- SELECT/WHERE/ORDER BY/GROUP BY/HAVING → fields (kind Field) + functions (kind Function) + valid clause keywords (kind Keyword).
- FROM → `objects` filtered by prefix (kind Object) + the already-known object.
- Provide `const SOQL_KEYWORDS` and `const SOQL_FUNCTIONS` (21 that plugin names). Filter all by the backward-extracted prefix, case-insensitive, dedup, sort.
- Tests: keyword appears after `SELECT Id `→ expect `FROM` in FROM-position test; `SELECT ` → fields+functions; `FROM ` with objects → object names; prefix filtering; empty objects slice safe.

### Task 2: Apex richer keywords (`crates/apex-lang`)
**Files:** Modify `crates/apex-lang/src/complete.rs`; tests same file.
- Replace 10-item `KEYWORDS` with full Apex keyword + modifier set.
- Add `const ANNOTATIONS` (@AuraEnabled, @isTest, @TestSetup, @future, @InvocableMethod, @InvocableVariable, @RemoteAction, @HttpGet, @HttpPost, @HttpPut, @HttpPatch, @HttpDelete, @SuppressWarnings, @Deprecated, @TestVisible, @ReadOnly, @JsonAccess, @NamespaceAccessible) and `const PRIMITIVES` (Integer, Long, Double, Decimal, String, Boolean, Date, Datetime, Time, Id, Blob, Object).
- In `TopLevel { prefix }`: if prefix starts with `@` emit ANNOTATIONS (kind Keyword) matching; else emit types + keywords + primitives + locals.
- Tests: prefix `@Aura` → @AuraEnabled; prefix `Inte` → Integer present; keyword `trigger`/`global` present; member-context unaffected.

---

## Wave 2 — Rebrand sweep (after Wave 1 merges; mechanical, build-verified)

### Task 3: Rename sf-toolkit → ultraforce
**Files (exact tokens from spec rename table):** `desktop/package.json`, `desktop/src-tauri/Cargo.toml` (bin + lib `ultraforce_desktop_lib`), `desktop/src-tauri/src/main.rs` (import), `desktop/src-tauri/tauri.conf.json` (productName, identifier `com.ultraforce.desktop`, title `ULTRAFORCE`), `desktop/index.html`, `desktop/src/App.tsx` (wordmark), `crates/sf-schema/src/store.rs` (`join("ultraforce")`), `crates/apex-lang/src/store.rs`, `crates/features/src/anon_apex.rs`, `crates/features/src/debug_config.rs` (`ULTRAFORCE_DEBUG`).
- Leave theme localStorage key as-is.
- Verify: `cargo build --workspace`, `pnpm -C desktop build`. Commit.

---

## Wave 3 — Persistence, logging, refresh, completion wiring

### Task 4: Store plugin + tracing + refresh command (backend; `desktop/src-tauri`)
**Files:** `desktop/src-tauri/Cargo.toml` (+`tauri-plugin-store`, `tracing`, `tracing-subscriber`, `tracing-appender`), `desktop/src-tauri/src/lib.rs` (register plugin, init tracing in `run()`, add `refresh_schema_cache` command + instrument run_soql/run_apex/completion with spans+duration), `desktop/src-tauri/src/dto.rs` (extend `CompletionDto` with `detail`, `insert_text`), `desktop/package.json` (+`@tauri-apps/plugin-store`).
- `refresh_schema_cache(org) -> Result<usize, String>`: invalidate cached schemas for org, re-list sObjects, return count.
- Tracing → daily file appender at `appDataDir/logs/ultraforce.log`, level from `ULTRAFORCE_LOG` else info.
- Wire SOQL completion to new `Vec<CompletionItem>`: `soql_complete` returns structured DTO; caller `features::soql::complete_fields` passes cached object names + maps `Candidate`→DTO.

### Task 5: Frontend store module + completion DTO consumption
**Files:** Create `desktop/src/store.ts` (typed wrapper over `@tauri-apps/plugin-store`: `loadStore()`, `getJson/setJson`, debounced `persist`); modify `desktop/src/monaco-soql.ts` (consume structured items, map kind→Monaco icon, use insertText), `desktop/src/monaco-apex.ts` (use detail/insertText if present), `desktop/src/types.ts` (CompletionItem TS type + HistoryEntry).

### Task 6: Tab rename + autosave/restore
**Files:** `desktop/src/tabs/types.ts` (+`renamed?`), `desktop/src/tabs/useTabs.ts` (hydrate from store on init, debounced persist on change, `rename(id,title)`), `desktop/src/tabs/TabStrip.tsx` (double-click title → inline input, Enter/blur commit, Esc cancel), panels pass a `storeKey`.
- Vitest: rename reducer, hydration fallback to one tab, persist debounce shape.

### Task 7: Run history + metrics
**Files:** Create `desktop/src/history.ts` (append capped 200 FIFO, list, clear), `desktop/src/metrics.ts` (counters + last-50 durations), modify `SoqlPanel.tsx`/`ApexPanel.tsx` (record HistoryEntry + metric on each run), new `desktop/src/components/HistoryDrawer.tsx` (list + click-to-open-tab), wire into `App.tsx` + CommandPalette (clock icon + ⌘K entry).
- Vitest: history cap FIFO, metrics increment.

### Task 8: OST refresh UI
**Files:** `desktop/src/org.tsx` or a new `desktop/src/components/SchemaRefresh.tsx` button invoking `refresh_schema_cache`, spinner + sonner toast; place near OrgSelector.

---

## Wave 4 — E2E (committed) + final verification

### Task 9: Fixed e2e harness
**Files:** Create `desktop/e2e/fixtures.ts` (mocked Tauri IPC responses incl. store), `desktop/e2e/ultraforce.spec.ts`, `desktop/playwright.config.ts`, `package.json` script `e2e`.
- Assert: SOQL keyword completion list contains FROM/WHERE; Apex `@` completion shows @AuraEnabled; tab rename persists across reload; run creates a history entry that reopens; schema refresh shows toast; brand reads ULTRAFORCE; light+dark screenshots saved.
- Run `pnpm -C desktop e2e`; commit script + fixtures.

### Task 10: Full verification + memory update
- `cargo fmt --check && cargo clippy && cargo test` (workspace); `pnpm -C desktop tsc --noEmit && pnpm -C desktop build && pnpm -C desktop vitest run && pnpm -C desktop e2e`.
- Update memory `sf-toolkit-build-state.md` with the rename + new subsystems.
