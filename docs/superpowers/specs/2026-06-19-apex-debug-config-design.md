# Apex debug-config row (DebugLevel / TraceFlag) — design

> Date: 2026-06-19 · Status: Proposed (design) · Crate: `crates/features` (new module `debug_config`) + `desktop/` · Depends on: sf-core, anon_apex
> Reference: the established Salesforce IDE plugin Anonymous Apex top row (Preset dropdown + 11 per-category log-level dropdowns). Explicitly deferred in `2026-06-19-lang-parity-design.md`; planned here.

## Goal & non-goals

**Goal.** Give the Apex panel a reference-plugin-style config row above the editor: a **Preset**
dropdown (e.g. "None", "Apex Only", "Full Debugging (Debug)") plus eleven
**per-category log-level** dropdowns (Apex Code, Apex Profiling, Callout, Data Access,
Database, NBA, System, Validation, Visualforce, Wave, Workflow). Applying a config
upserts the running user's `DebugLevel` + `TraceFlag` via the Tooling API so the next
anonymous-Apex run logs at the chosen verbosity.

**Non-goals.** No org-wide trace management UI, no log-retention policy, no Apex/SOQL
autocomplete, no streaming. We manage exactly one DEVELOPER_LOG TraceFlag for the
running user; we do not touch other users' trace flags. We do not delete trace flags.

## Mechanism — DebugLevel / TraceFlag via Tooling DML

**Status: VERIFIED against sf 2.127 on staging** (`sf data create/update record --help`;
the `update` help text even uses `TraceFlag` as its worked example).

Debug verbosity is governed by two Tooling sObjects:

- **DebugLevel** — carries the eleven category levels. Field API names:
  `ApexCode`, `ApexProfiling`, `Callout`, `Database`, `System`, `Validation`,
  `Visualforce`, `Workflow`, `Wave`, `Nba`, `DataAccess` (each a level string), plus a
  `DeveloperName` + `MasterLabel`.
- **TraceFlag** — binds a `DebugLevelId` to a `TracedEntityId` (the running user) for a
  window: `StartDate`, `ExpirationDate`, `LogType` (`DEVELOPER_LOG` for anonymous-Apex /
  Dev-Console-style runs).

Exact sf invocations (all confirmed flags):

```
# create:  sf data create record -t -s <Object> -v "F1=v1 F2=v2" [-o <user>] --json
# update:  sf data update record -t -s <Object> -i <id> -v "F1=v1" [-o <user>] --json
# query :  sf data query -q "<SOQL>" -t [-o <user>] --json
```

- `-t` / `--use-tooling-api` (REQUIRED — DebugLevel/TraceFlag are Tooling objects),
  `-s/--sobject`, `-v/--values` (space-separated `Field=value` pairs),
  `-i/--record-id`, `-w/--where`, `-o/--target-org`.
- Running user id comes from `sf org display --json` (`result.id` = the user Id, used as
  `TracedEntityId`). NOTE: confirm whether `org display` returns the *user* Id vs org Id
  on this CLI — **TODO** marked in the plan; fall back to
  `SELECT Id FROM User WHERE Username = '<connected user>'` if `org display` is the org Id.

Read-back uses Tooling SOQL: existing `TraceFlag` for the user + its `DebugLevel` row.

### Upsert algorithm (one TraceFlag per user, owned by this tool)

1. Query the user's current `DEVELOPER_LOG` TraceFlag (with its DebugLevel category fields).
2. If a tool-owned DebugLevel exists (`DeveloperName == "SF_TOOLKIT_DEBUG"`), `update` its
   eleven category fields; else `create` it.
3. If a TraceFlag pointing at it exists, `update` `ExpirationDate` (refresh the window);
   else `create` one (`TracedEntityId`, `DebugLevelId`, `LogType=DEVELOPER_LOG`,
   `ExpirationDate = now + 24h`).

Presets are predefined `category → level` maps held **Rust-side** (see below); selecting a
preset fills the eleven dropdowns and is what gets upserted.

## Category model + presets

```rust
pub enum LogLevel { None, Error, Warn, Info, Fine, Finer, Finest, Debug }  // sf strings: NONE..DEBUG
pub struct CategoryLevels {            // the eleven categories, serde rename = Tooling field name
    pub apex_code: LogLevel,           // ApexCode
    pub apex_profiling: LogLevel,      // ApexProfiling
    pub callout: LogLevel,             // Callout
    pub data_access: LogLevel,         // DataAccess
    pub database: LogLevel,            // Database
    pub nba: LogLevel,                 // Nba
    pub system: LogLevel,              // System
    pub validation: LogLevel,          // Validation
    pub visualforce: LogLevel,         // Visualforce
    pub wave: LogLevel,                // Wave
    pub workflow: LogLevel,            // Workflow
}
pub enum Preset { None, ApexOnly, FullDebugging, Custom }  // Custom = user-edited dropdowns
```

Preset maps (feature parity defaults; `Custom` carries an explicit `CategoryLevels`):

- **None** — every category `NONE`.
- **Apex Only** — `ApexCode=DEBUG`, `System=DEBUG`, everything else `NONE`.
- **Full Debugging (Debug)** — `ApexCode=FINEST, ApexProfiling=FINEST, Callout=FINEST,
  DataAccess=FINEST, Database=FINEST, Nba=FINE, System=FINE, Validation=INFO,
  Visualforce=FINER, Wave=FINER, Workflow=FINER` (the reference plugin's "Debug" preset; exact level map
  in code, single source of truth).

`LogLevel::as_sf(&self) -> &'static str` / `from_sf(&str)` bridge the enum to sf strings.

## Rust module design — `crates/features/src/debug_config.rs`

Mirrors `anon_apex` / `debug_log`: thin sf orchestration + pure preset logic, `target_org`
as the **last** parameter, MockRunner unit tests.

```rust
pub fn preset_levels(p: Preset) -> CategoryLevels;             // pure
impl CategoryLevels { pub fn values_arg(&self) -> String; }    // "ApexCode=DEBUG System=DEBUG ..."

pub struct DebugConfig { pub trace_flag_id: Option<String>, pub debug_level_id: Option<String>, pub levels: CategoryLevels }

// read the running user's current tool-owned config (None levels if absent)
pub async fn get_debug_config(invoker: &SfInvoker, target_org: Option<&str>) -> Result<DebugConfig, SfError>;

// upsert DebugLevel + TraceFlag for the running user; returns the resulting DebugConfig
pub async fn set_debug_config(invoker: &SfInvoker, levels: &CategoryLevels, target_org: Option<&str>) -> Result<DebugConfig, SfError>;
```

`get_debug_config`: `org display` → user Id; Tooling SOQL for the user's TraceFlag +
DebugLevel; map fields → `CategoryLevels`. `set_debug_config`: the upsert algorithm above,
using `run_json` for each Tooling DML (each returns `{ id, success }`). All sf args append
`--target-org` when `Some` (identical to the existing convention).

## Tauri commands — `desktop/src-tauri/src/lib.rs`

```rust
#[derive(serde::Serialize)] struct DebugConfigDto { trace_flag_id: Option<String>, levels: CategoryLevelsDto }
#[derive(serde::Serialize, serde::Deserialize)] struct CategoryLevelsDto { /* 11 string fields, camelCase to match React */ }

#[tauri::command] async fn get_debug_config(state) -> Result<DebugConfigDto, String>;   // current_org → features::debug_config::get_debug_config
#[tauri::command] async fn set_debug_config(levels: CategoryLevelsDto, state) -> Result<DebugConfigDto, String>; // map DTO → CategoryLevels → set
```

Preset → levels resolution happens React-side (fills the eleven dropdowns), so the command
takes explicit `levels`; this keeps the command stateless and the preset list in one place
(Rust `preset_levels`, surfaced to React via a third command or a static TS mirror — plan
chooses the static TS mirror to avoid an extra round-trip, with a Rust test asserting parity).
Mapping lives in `dto.rs` alongside the existing DTO mappers.

## React UI — collapsible config row in `ApexPanel`

A new `DebugConfigRow` component rendered above the Monaco editor inside `ApexPanel`:

- Collapsed by default: a single line showing the active preset (e.g. "Debug Levels: Apex Only")
  + a chevron (icon affordance, not color-only) to expand.
- Expanded: a **Preset** dropdown then eleven compact category dropdowns, each labelled
  with its `micro-label`. Reuses the **OrgSelector dropdown pattern** (button + menu,
  `focus-accent`, `nav-state-active` on current value, keyboard nav, `aria-label`).
- Selecting a preset fills all eleven dropdowns; editing any dropdown switches preset to
  `Custom`. On change (debounced ~300ms) → `invoke("set_debug_config", { levels })`; a tiny
  status affordance ("applied" / spinner / error).
- Tokens only: `accent`, `red`, `hair`, `surface`, `text-dim`, `micro-label`, `tnum`. No new tokens.
- Loads current config on mount via `get_debug_config`.

## Error / permission handling

- A user lacking **"View All Data" / ModifyAllData / Author Apex**-style permission gets a
  Tooling DML failure (`INSUFFICIENT_ACCESS` / `INVALID_FIELD`). The command maps `SfError`
  → `String`; the row shows an inline error affordance ("cannot set debug levels — check org
  permissions") and **does not crash**. The editor/run flow stays fully usable.
- Stale TraceFlag (expired) is treated as absent and re-created.
- `set_debug_config` is best-effort, surfaced loud: on partial failure (DebugLevel created
  but TraceFlag DML fails) the returned error names which step failed; no silent success.

## Scope decision — applies to Apex panel only

The TraceFlag is per running-user and org-wide by nature, but conceptually scoped to "what
the Apex panel run will log". We do **not** auto-clear it on panel close (matches the reference plugin: the
trace flag persists until expiry). Default `ExpirationDate = now + 24h`. Documented in the
row's tooltip so the user understands it affects all of their org's debug logs until expiry.

## Testing strategy

- **Rust (MockRunner, no live sf):**
  - `preset_levels` purity: each preset → expected `CategoryLevels` (incl. the Debug map).
  - `CategoryLevels::values_arg` formats the eleven `Field=LEVEL` pairs with Tooling field names.
  - `set_debug_config` create-path: MockRunner returns "no existing TraceFlag" then captures
    args → asserts `-t --sobject DebugLevel`, `-t --sobject TraceFlag`, `--target-org` when `Some`.
  - `set_debug_config` update-path: existing ids → asserts `update record -i <id>`.
  - `get_debug_config` maps Tooling SOQL rows → `CategoryLevels`; absent → all `None`.
  - permission-failure envelope (`status:1`) → `Err(SfError::Command)` propagated.
- **e2e (gated `#[ignore]`):** real sf against staging — `set_debug_config(ApexOnly)` then
  `get_debug_config` round-trips the levels. Run with `--ignored` post-merge.
- **Frontend:** `pnpm build` (tsc + vite) green; TS preset mirror parity asserted Rust-side.

## Dependency / module boundaries

- `debug_config` is a new self-contained `features` module; only cross-crate dependency is
  `sf-core` (`SfInvoker`, `SfError`) — same as `anon_apex`. No new crates.
- `DebugConfigRow` is an independent React component (DTO in / callback out), testable in isolation.
- `dto.rs` owns the `CategoryLevels ↔ CategoryLevelsDto` mapping; the preset map has a single
  source of truth in Rust with a TS mirror guarded by a parity test.
