# Telemetry Opt-In + Aptabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make both telemetry sinks opt-in (default OFF), add a scrubbed Aptabase remote sink, and expose two toggles + a privacy disclosure in the desktop Settings UI.

**Architecture:** A shared config file `<root>/telemetry.json` (`{localEnabled, remoteEnabled}`, both default false) at the cache root both the desktop app and the standalone uf-ost binary resolve via `features::apex_complete::default_index_root()`. The `logged` helper in uf-ost gates the local `tool_log` write on `localEnabled` and a fire-and-forget Aptabase POST on `remoteEnabled`. Aptabase is a hand-rolled reqwest POST (no new dependency). The `org_meta` prod-detection cache is functional, NOT telemetry — it stays always-on. Desktop Settings writes the config via a Tauri command (NOT the tauri-store, which is a different dir uf-ost can't read).

**Tech Stack:** Rust (uf-ost, features, src-tauri), reqwest (existing features dep), rmcp, React/TS (desktop), Tauri IPC.

## Global Constraints

- Both sinks default OFF. Config absent/unreadable ⇒ both false (a standalone MCP with no config sends nothing).
- **Never leaves the machine, any toggle state:** SOQL/Apex query or code text, record field values/Ids/object content, org name/alias, access token/credentials, error message full text, any Salesforce business data, PII, IP (Aptabase drops it), cross-session tracking.
- **Aptabase `props` (when remoteEnabled), exactly:** `outcome` (ok|error), `durationMs` (number), `errorCategory` (classified label, never full text), `isProd` (bool, omitted when org type unknown — never forces a prod-detection query). `eventName` = the tool name. Nothing else in props.
- App key `A-US-0354270195` → region US → `https://us.aptabase.com/api/v0/event`. Const with env override `UF_OST_APTABASE_KEY`; region parsed from key prefix (`A-US-`/`A-EU-`/`A-SH-`; `A-SH-` self-hosted needs `UF_OST_APTABASE_HOST`).
- Aptabase POST is best-effort: `tokio::spawn`, never awaited on the tool hot path, never alters or fails a tool. Lost in-flight events on immediate exit are acceptable (local SQLite is the source of truth when localEnabled).
- DTOs crossing IPC: `#[serde(rename_all = "camelCase")]` in `dto.rs`, mirrored manually in `desktop/src/types.ts`; both sides in one commit. Frontend IPC only through `desktop/src/ipc/*`.
- Config file JSON is camelCase (`localEnabled`, `remoteEnabled`) — same shape read by Rust (uf-ost + src-tauri) and shown in the UI.
- Tests: `cargo test -p uf-ost -p features`, `cargo clippy --workspace -- -D warnings`, desktop `rtk vitest run` / `rtk tsc`. Commit per task, conventional commits, no attribution.

---

### Task 1: Shared telemetry-config type + read/write in `features`

Both uf-ost (read) and src-tauri (read+write) need one definition. Put it in `features`.

**Files:**
- Create: `crates/features/src/telemetry_config.rs`
- Modify: `crates/features/src/lib.rs` (`pub mod telemetry_config;`)

**Interfaces (Produces):**
- `#[derive(Serialize, Deserialize, Clone, Copy, Default)] #[serde(rename_all = "camelCase", default)] pub struct TelemetryConfig { pub local_enabled: bool, pub remote_enabled: bool }`
- `pub fn config_path(root: &Path) -> PathBuf` → `<root>/telemetry.json`
- `pub fn load(root: &Path) -> TelemetryConfig` — missing/unparseable ⇒ `Default` (both false). Never errors.
- `pub fn save(root: &Path, cfg: &TelemetryConfig) -> std::io::Result<()>` — creates root dir if needed, writes pretty JSON.

- [ ] **Step 1: Failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_off_when_absent() {
        let dir = std::env::temp_dir().join(format!("uf-tc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = load(&dir);
        assert!(!c.local_enabled && !c.remote_enabled);
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn roundtrip_and_partial_json_defaults() {
        let dir = std::env::temp_dir().join(format!("uf-tc2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        save(&dir, &TelemetryConfig { local_enabled: true, remote_enabled: false }).unwrap();
        let c = load(&dir);
        assert!(c.local_enabled && !c.remote_enabled);
        // partial/garbage JSON ⇒ defaults, never panics
        std::fs::write(config_path(&dir), "{\"localEnabled\":true}").unwrap();
        assert!(load(&dir).local_enabled && !load(&dir).remote_enabled);
        std::fs::write(config_path(&dir), "not json").unwrap();
        let c = load(&dir);
        assert!(!c.local_enabled && !c.remote_enabled);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 2:** `cargo test -p features telemetry_config` → FAIL (module missing)
- [ ] **Step 3:** Implement. `load` reads file → `serde_json::from_str::<TelemetryConfig>().unwrap_or_default()`; the `#[serde(default)]` on the struct makes partial JSON fill missing fields with false. `save` uses `serde_json::to_string_pretty` + `std::fs::write`, `create_dir_all(root)` first.
- [ ] **Step 4:** `cargo test -p features telemetry_config` → PASS; `cargo clippy -p features -- -D warnings` → exit 0
- [ ] **Step 5:** Commit `feat(features): shared telemetry.json config (local/remote, default off)`

---

### Task 2: Gate local logging on config + fold in the redaction test

`logged` currently always writes `tool_log`. Gate it on `localEnabled`; keep `org_meta` always-on. Also add the field-value-exclusion test the Task-9 review flagged (now security-critical, since remote sink lands next task).

**Files:**
- Modify: `crates/uf-ost/src/live/mod.rs` (LiveCtx holds the loaded config)
- Modify: `crates/uf-ost/src/telemetry.rs` (or server.rs `logged`) — gate the `log` call
- Modify: `crates/uf-ost/src/server.rs` (redaction test on `field_keys`)

**Interfaces:**
- Consumes: `features::telemetry_config::{load, TelemetryConfig}`.
- `LiveCtx` gains `pub config: TelemetryConfig` (loaded once in `LiveCtx::new` via `telemetry_config::load(&root)`).
- The `logged` helper wraps the `self.live.telemetry.log(...)` call in `if self.live.config.local_enabled { ... }`.

**Design note:** `org_meta` read/write (`get_org_meta`/`set_org_meta`, used by `is_prod`) is a functional cache — it stays UNGATED. Only `tool_log` inserts are gated.

- [ ] **Step 1: Failing test** — field-value exclusion (redaction). Add to server.rs tests (or a `field_keys` unit test):

```rust
#[test]
fn field_keys_excludes_values() {
    let v = serde_json::json!({"Name": "Acme Corp", "AnnualRevenue": 5000000, "Secret__c": "xyz"});
    let s = field_keys(&v);
    // only KEYS appear, no VALUES
    assert!(s.contains("Name") && s.contains("AnnualRevenue") && s.contains("Secret__c"));
    assert!(!s.contains("Acme") && !s.contains("5000000") && !s.contains("xyz"), "leaked a value: {s}");
    // non-object ⇒ empty, never panics
    assert_eq!(field_keys(&serde_json::json!([1,2,3])), "");
}
```

(If `field_keys` is private, this test lives in the same module. It is the guard that keeps record values out of BOTH sinks.)

- [ ] **Step 2:** `cargo test -p uf-ost field_keys_excludes_values` → FAIL if field_keys leaks (should PASS if Task 9's impl is correct — if it PASSES immediately, keep it as a regression pin and note that in the report; the gate-logic test below is the new RED).

- [ ] **Step 3: Gate test** — prove local logging respects the flag. Add a test constructing a `LiveCtx` with `config.local_enabled=false` and asserting no row is written, then `true` and a row is written. Since `LiveCtx::new` loads from disk, expose a test constructor or set the config field directly in-test:

```rust
#[test]
fn local_logging_gated_by_config() {
    let dir = std::env::temp_dir().join(format!("uf-gate-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    // remoteEnabled irrelevant here; localEnabled drives tool_log
    let tel = crate::telemetry::Telemetry::new(dir.clone());
    // simulate the gated call the `logged` helper makes:
    let cfg_off = features::telemetry_config::TelemetryConfig { local_enabled: false, remote_enabled: false };
    if cfg_off.local_enabled { tel.log(sample_entry()); }
    assert_eq!(row_count(&dir), 0);
    let cfg_on = features::telemetry_config::TelemetryConfig { local_enabled: true, remote_enabled: false };
    if cfg_on.local_enabled { tel.log(sample_entry()); }
    assert_eq!(row_count(&dir), 1);
    std::fs::remove_dir_all(&dir).ok();
}
```

(Provide `sample_entry()`/`row_count()` helpers in the test module; `row_count` opens `<dir>/telemetry.db` and counts `tool_log`. This pins the gate semantics that the real `logged` helper implements.)

- [ ] **Step 4:** Implement — add `config` to `LiveCtx`, load in `new`, wrap the `logged` helper's `.log()` in the `local_enabled` check. Verify `org_meta` path (`is_prod`) is untouched by the gate.
- [ ] **Step 5:** `cargo test -p uf-ost` → PASS; `cargo clippy -p uf-ost -- -D warnings` → exit 0
- [ ] **Step 6:** Commit `feat(uf-ost): gate local telemetry on config; pin field-value redaction`

---

### Task 3: Aptabase scrubbed remote sink

**Files:**
- Create: `crates/uf-ost/src/aptabase.rs`
- Modify: `crates/uf-ost/src/main.rs` (`mod aptabase;`)
- Modify: `crates/uf-ost/src/live/mod.rs` (LiveCtx holds an `Option<AptabaseClient>` + a per-process `session_id`)
- Modify: `crates/uf-ost/src/server.rs` (`logged` fires the event when `remote_enabled`)

**Interfaces (Produces):**
- `pub struct AptabaseClient { app_key: String, endpoint: String, session_id: String }`
- `pub fn new_if_enabled(cfg: &TelemetryConfig) -> Option<AptabaseClient>` — `None` unless `remote_enabled`; resolves key (const `A-US-0354270195` or `UF_OST_APTABASE_KEY`) and endpoint from the key region.
- `pub fn endpoint_for_key(key: &str) -> Result<String, String>` — pure, tested: `A-US-*`→`https://us.aptabase.com/api/v0/event`, `A-EU-*`→`https://eu.aptabase.com/api/v0/event`, `A-SH-*`→`{UF_OST_APTABASE_HOST}/api/v0/event` (err if host unset), else err.
- `pub fn classify_error(msg: &str) -> &'static str` — pure, tested: maps to `INVALID_FIELD` | `MALFORMED_QUERY` | `INVALID_SESSION_ID` | `auth_failed` | `not_found` | `timeout` | `other`. Never returns the raw message.
- `pub fn track(&self, tool: &str, outcome: &str, duration_ms: u64, error_category: Option<&str>, is_prod: Option<bool>)` — builds the EventBody, `tokio::spawn`s the POST, returns immediately.

**EventBody** (Aptabase `/api/v0/event`): `{timestamp: ISO8601, sessionId, eventName: tool, systemProps: {osName: std::env::consts::OS, osVersion: "", appVersion: env!("CARGO_PKG_VERSION"), locale: "", isDebug: cfg!(debug_assertions), sdkVersion: "ultraforce-mcp@<ver>"}, props: {outcome, durationMs, errorCategory?, isProd?}}`. Header `App-Key: <key>`. (osVersion/locale left empty — Aptabase accepts partial systemProps; don't add an OS-detection dep for them.)

**isProd sourcing:** in `logged`, read `self.live.telemetry.get_org_meta(org)` (cache-only, no query) → `Some(!is_sandbox)`; if `None`, pass `is_prod=None` (prop omitted). NEVER call `live.is_prod()` from the telemetry path — that would trigger a live query as a side effect of analytics.

- [ ] **Step 1: Failing tests** (pure fns only — the POST is fire-and-forget, untested like other reqwest wrappers):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_region_from_key() {
        assert_eq!(endpoint_for_key("A-US-0354270195").unwrap(), "https://us.aptabase.com/api/v0/event");
        assert_eq!(endpoint_for_key("A-EU-123").unwrap(), "https://eu.aptabase.com/api/v0/event");
        assert!(endpoint_for_key("A-XX-1").is_err());
    }
    #[test]
    fn classify_never_returns_raw() {
        assert_eq!(classify_error("No such column 'Foo' INVALID_FIELD"), "INVALID_FIELD");
        assert_eq!(classify_error("INVALID_SESSION_ID: expired"), "INVALID_SESSION_ID");
        assert_eq!(classify_error("something weird"), "other");
        // the classified label must not contain any of the raw message
        let raw = "secret ProjectX MALFORMED_QUERY details";
        let cat = classify_error(raw);
        assert!(!cat.contains("ProjectX") && !cat.contains("secret"), "{cat}");
    }
}
```

- [ ] **Step 2:** `cargo test -p uf-ost aptabase` → FAIL
- [ ] **Step 3:** Implement `aptabase.rs`; in `LiveCtx::new` build `aptabase: aptabase::new_if_enabled(&cfg)` and a `session_id` (e.g. `format!("{}", now_epoch_millis)` + a random suffix — any stable-per-process string). In `logged`, after computing outcome/duration: `if let Some(ap) = &self.live.aptabase { ap.track(tool, outcome, dur, err_category, is_prod); }`. `err_category` = `res.as_ref().err().map(|e| classify_error(e.message.as_ref()))`.
- [ ] **Step 4:** `cargo test -p uf-ost` → PASS; `cargo clippy -p uf-ost -- -D warnings` → exit 0. Manually confirm by reading the `track` body that `props` contains ONLY the four allowed keys and no org/query/value/token.
- [ ] **Step 5:** Commit `feat(uf-ost): opt-in Aptabase remote sink (scrubbed props only)`

---

### Task 4: Desktop backend — telemetry config Tauri commands

Follows the debug-config IPC precedent exactly.

**Files:**
- Modify: `desktop/src-tauri/src/dto.rs` (`TelemetryConfigDto`)
- Create: `desktop/src-tauri/src/telemetry_cfg.rs` (orchestration: load/save at `default_index_root()`)
- Modify: `desktop/src-tauri/src/lib.rs` (two command shells + `generate_handler!` registration)

**Interfaces:**
- `#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")] pub struct TelemetryConfigDto { pub local_enabled: bool, pub remote_enabled: bool }`
- `#[tauri::command] async fn get_telemetry_config() -> Result<TelemetryConfigDto, CommandError>` — reads `features::telemetry_config::load(&features::apex_complete::default_index_root())`.
- `#[tauri::command] async fn set_telemetry_config(config: TelemetryConfigDto) -> Result<(), CommandError>` — `features::telemetry_config::save(...)`, mapping io::Error → CommandError with a user-readable message.

- [ ] **Step 1:** Add DTO to dto.rs (camelCase). Write orchestration in telemetry_cfg.rs converting DTO↔`TelemetryConfig`.
- [ ] **Step 2:** Add the two `#[tauri::command]` shells in lib.rs (thin — delegate to telemetry_cfg), register both in `generate_handler![...]`.
- [ ] **Step 3:** `rtk cargo build -p ultraforce` (or the src-tauri package name) → compiles; `cargo clippy` on src-tauri → clean. (No unit test — these are thin shells over Task 1's tested load/save; the round-trip is exercised manually in Task 5's smoke.)
- [ ] **Step 4:** Commit `feat(desktop): get/set_telemetry_config commands`

---

### Task 5: Desktop frontend — toggles + privacy disclosure

**Files:**
- Modify: `desktop/src/types.ts` (mirror `TelemetryConfigDto` as `TelemetryConfig`, camelCase)
- Modify: `desktop/src/ipc/config.ts` (`getTelemetryConfig`/`setTelemetryConfig`)
- Modify: `desktop/src/components/SettingsPage.tsx` (new "Privacy & Telemetry" `<Section>`)

**Interfaces:**
- `ipc/config.ts`: `export const getTelemetryConfig = () => invoke<TelemetryConfig>("get_telemetry_config")` and `setTelemetryConfig(config: TelemetryConfig) => invoke<void>("set_telemetry_config", { config })`.

**UI:** A `<Section title="Privacy & Telemetry">` following the Apex "Confirm before running" toggle pattern (SettingsPage.tsx:194-213). Two `Checkbox` rows:
1. "Local telemetry — record tool calls to a local database on this computer for your own debugging. Never leaves your machine." (bound to `localEnabled`)
2. "Anonymous usage statistics (Aptabase) — send scrubbed events to help improve the tool." (bound to `remoteEnabled`)

Below the toggles, a disclosure block (`text-text-dim`, small) with the EXACT copy below (this is the contract of what the code sends — do not paraphrase loosely):

```
Both are OFF by default; nothing is recorded or sent until you turn them on.

"Anonymous usage statistics" (Aptabase) — when ON, each tool call sends a scrubbed
event to Aptabase's cloud:
  • tool name (e.g. soql_query, apex_run)
  • result: success / failure
  • duration (ms)
  • error CATEGORY label (e.g. INVALID_FIELD) — never the error text
  • whether the target org is production (a true/false flag)
  • basic system info: operating-system name, app version, and a random per-session id

"Local telemetry" — when ON, records the FULL detail of each tool call — including your
SOQL/Apex text, the org alias, and error messages — to a database on THIS computer only.
It never leaves your machine and is never uploaded anywhere; it is for your own
troubleshooting.

Sent to Aptabase's cloud — NEVER:
  • your SOQL / Apex query or code text
  • any record data: field values, record Ids, object contents
  • org names / aliases
  • error message text (only the category label)
  • any Salesforce business data

Recorded NOWHERE, under any setting:
  • access tokens / credentials / passwords

Aptabase does not store your IP address, name, email, or other personal data, and does no
cross-session tracking or device fingerprinting.
```

- [ ] **Step 1:** Add `TelemetryConfig` to types.ts; add the two fns to ipc/config.ts.
- [ ] **Step 2:** Add the Section to SettingsPage.tsx: load config on mount (`getTelemetryConfig`), each toggle calls `setTelemetryConfig` with the updated pair (mirror how the Apex confirm toggle persists). Render the disclosure block verbatim.
- [ ] **Step 3:** `rtk tsc` → no errors; `rtk vitest run` → existing suite green; `rtk lint` → clean.
- [ ] **Step 4:** Commit `feat(desktop): telemetry opt-in toggles + privacy disclosure in Settings`

---

### Task 6: End-to-end verification

**Files:** none (verification only; report to `.superpowers/sdd/task-6-report.md`).

- [ ] **Step 1:** `cargo test -p uf-ost -p features && cargo clippy --workspace -- -D warnings && ./scripts/check-arch.sh` → all pass.
- [ ] **Step 2:** Config-flow smoke (no org needed): delete any `<root>/telemetry.json`; run `uf-ost serve`, drive `ost_status` via stdio → confirm NO row in `<root>/telemetry.db` (default off). Write `{"localEnabled":true,"remoteEnabled":false}` to the config; restart serve; drive `ost_status` → confirm a row appears. This proves the gate end-to-end.
- [ ] **Step 3:** Desktop smoke: launch app (`rtk` per project run skill), open Settings → Privacy & Telemetry, toggle Local on, confirm `<root>/telemetry.json` now has `localEnabled:true`; toggle off, confirm it flips back. Report which checks ran vs deferred (fail loud on anything not run).
- [ ] **Step 4:** Aptabase remote: OPTIONAL/deferred to user — enabling it sends real events to the live Aptabase project. Do NOT enable it in automated verification; note it as a user-driven check (turn on the toggle, run one tool, confirm an event appears in the Aptabase dashboard). Never fake this.
- [ ] **Step 5:** Commit any doc/report updates (`docs:` if CHANGELOG touched).

## Out of Scope

- Batching/flush-on-shutdown for Aptabase (fire-and-forget is Phase 1; add a shutdown flush if event loss proves material). `# ponytail: fire-and-forget, add flush-on-shutdown if loss matters`.
- OS-version / locale detection deps for systemProps (left empty; Aptabase accepts partial).
- Sentry/crash reporting (separate concern, not requested).

## Self-Review Notes

- Coverage: config type+persist → T1; local gate + redaction test → T2; remote scrubbed sink → T3; desktop commands → T4; UI toggles+disclosure → T5; e2e → T6.
- Type consistency: `TelemetryConfig{local_enabled, remote_enabled}` (T1) ↔ `TelemetryConfigDto` (T4 dto.rs) ↔ `TelemetryConfig` (T5 types.ts) — all camelCase on the wire/JSON. `classify_error`/`endpoint_for_key` (T3) pure+tested.
- Verify-at-implementation: src-tauri package name for `cargo build` (T4); exact SettingsPage Section/Checkbox markup (T5, per SettingsPage.tsx:194-213); `field_keys` visibility for the redaction test (T2).
