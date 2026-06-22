# feature parity (Tier A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Tauri SOQL & Anonymous Apex panels to the reference plugin look-and-feel parity: a real org selector, SOQL status line + Table/Tree result toggle, and a syntax-highlighted, filterable debug-log view.

**Architecture:** Additively thread an optional target-org through the `features` crate; hold the selected org in src-tauri `AppState`; expose org list + selection as Tauri commands; extend the SOQL DTO with the raw record tree; render three new React components (OrgSelector, RecordTree, LogView).

**Tech Stack:** Rust (sf-core/features/tauri), Tauri 2, React 19 + TypeScript, Tailwind v4, Lucide icons.

## Global Constraints

- Workspace root `/Users/dormonzhou/Projects/sf-query-execute-debug`; crates under `crates/`, desktop app under `desktop/` (src-tauri package `sf-toolkit-desktop`).
- English code & comments. No author attribution / Co-Authored-By / Claude-Session trailers in commits. `git config commit.gpgsign false` already set. `--no-verify` acceptable.
- Conventional commits (`feat:`, `test:`, `refactor:`). Commit on the current branch (`feat/lang-parity`); do NOT create new branches or checkout main.
- Rust gates: `cargo test --workspace --features sf-core/test-util`, `cargo clippy --workspace --all-targets --features sf-core/test-util -- -D warnings`, `cargo fmt --all --check` — all clean.
- Frontend gate: `cd desktop && pnpm build` (tsc + vite) green. No display in this env — do NOT rely on `pnpm tauri dev` for verification; the user verifies the live window.
- `target_org: Option<&str>` is additive and the LAST param; `None` preserves current behavior. Reuse existing Tailwind tokens (`accent`, `red`, `hair`, `surface`, `text`, `text-dim`, `text-faint`, `micro-label`, `tnum`); no new tokens. Single Lucide icon family. Transitions 150–300ms; visible focus rings; `cursor-pointer` + `aria-label` on icon-only controls; color-not-only.

---

### Task 1: Thread `target_org` through the features crate

**Files:**
- Modify: `crates/features/src/soql.rs` (`run_query`, `run_query_table` + their tests)
- Modify: `crates/features/src/anon_apex.rs` (`run_anon` + tests)
- Modify: `crates/features/src/debug_log.rs` (`list_logs`, `get_log_body`, `fetch_and_parse` + tests)
- Modify: `desktop/src-tauri/src/lib.rs` (call sites — pass `None` for now so the workspace compiles)

**Interfaces:**
- Consumes: `SfInvoker::{run_json, run_raw}`.
- Produces:
  - `soql::run_query(invoker, soql, target_org: Option<&str>) -> Result<QueryResult, SfError>`
  - `soql::run_query_table(invoker, soql, target_org: Option<&str>) -> Result<TableModel, SfError>`
  - `anon_apex::run_anon(invoker, apex_src, target_org: Option<&str>) -> Result<AnonApexOutcome, SfError>`
  - `debug_log::list_logs(invoker, target_org: Option<&str>) -> Result<Vec<ApexLogRef>, SfError>`
  - `debug_log::get_log_body(invoker, id, target_org: Option<&str>) -> Result<String, SfError>`
  - `debug_log::fetch_and_parse(invoker, id, target_org: Option<&str>) -> Result<DebugLogView, SfError>`

- [ ] **Step 1: Write the failing test (soql appends --target-org)**

Add to `crates/features/src/soql.rs` test module:

```rust
    #[tokio::test]
    async fn run_query_appends_target_org_when_set() {
        use std::sync::{Arc, Mutex};
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_query(&invoker, "SELECT Id FROM Account", Some("me@x.com")).await.unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(args.windows(2).any(|w| w == ["--target-org", "me@x.com"]), "got: {args:?}");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p features soql::tests::run_query_appends_target_org_when_set`
Expected: FAIL — `run_query` takes 2 args, not 3 (compile error).

- [ ] **Step 3: Modify the soql functions**

In `crates/features/src/soql.rs` replace the two run functions:

```rust
/// Execute a SOQL query and return the typed [`QueryResult`].
pub async fn run_query(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
) -> Result<QueryResult, SfError> {
    let mut args = vec!["data", "query", "-q", soql];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    invoker.run_json::<QueryResult>(&args).await
}

/// Execute a SOQL query and project it into a flat [`TableModel`].
pub async fn run_query_table(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
) -> Result<TableModel, SfError> {
    let result = run_query(invoker, soql, target_org).await?;
    Ok(result.to_table())
}
```

Then update every existing call to `run_query(`/`run_query_table(` in this file's tests to pass `None` as the third argument (the e2e test and any unit tests).

- [ ] **Step 4: Run soql tests to verify they pass**

Run: `cargo test -p features soql::`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Modify anon_apex (add target_org, append flag)**

In `crates/features/src/anon_apex.rs`, change `run_anon`'s signature to add `target_org: Option<&str>` as the last param, and build the args dynamically. Replace the `run_raw(&["apex", "run", "-f", &path_str, "--json"])` call with:

```rust
    let mut args = vec!["apex", "run", "-f", &path_str, "--json"];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    let raw = invoker.run_raw(&args).await;
```

(keep the rest of the body — temp-file cleanup and envelope parsing — unchanged; `raw` replaces whatever the previous binding was named). Update every existing `run_anon(` call in this file's tests to pass `None` as the last argument. Add a test asserting the flag is forwarded:

```rust
    #[tokio::test]
    async fn run_anon_forwards_target_org() {
        use std::sync::{Arc, Mutex};
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"success":true,"compiled":true,"logs":""}}"#.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_anon(&invoker, "System.debug(1);", Some("me@x.com")).await.unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(args.windows(2).any(|w| w == ["--target-org", "me@x.com"]), "got: {args:?}");
    }
```

- [ ] **Step 6: Modify debug_log (3 functions)**

In `crates/features/src/debug_log.rs` replace the three functions:

```rust
/// List recent debug logs via `sf apex list log`.
pub async fn list_logs(
    invoker: &SfInvoker,
    target_org: Option<&str>,
) -> Result<Vec<ApexLogRef>, SfError> {
    let mut args = vec!["apex", "list", "log"];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    invoker.run_json(&args).await
}

/// Fetch one debug log's raw body by Id via `sf apex get log -i <id>`.
pub async fn get_log_body(
    invoker: &SfInvoker,
    id: &str,
    target_org: Option<&str>,
) -> Result<String, SfError> {
    let mut args = vec!["apex", "get", "log", "-i", id];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    let bodies: Vec<LogBody> = invoker.run_json(&args).await?;
    bodies
        .into_iter()
        .next()
        .map(|b| b.log)
        .ok_or_else(|| SfError::Unexpected("empty `apex get log` result".to_string()))
}

/// Fetch a log body by Id and parse it into a `DebugLogView`.
pub async fn fetch_and_parse(
    invoker: &SfInvoker,
    id: &str,
    target_org: Option<&str>,
) -> Result<DebugLogView, SfError> {
    let body = get_log_body(invoker, id, target_org).await?;
    Ok(DebugLogView::from_log(&body))
}
```

Update every existing `list_logs(`/`get_log_body(`/`fetch_and_parse(` call in this file's tests to pass `None` as the last argument.

- [ ] **Step 7: Update src-tauri call sites to pass None (keep workspace compiling)**

In `desktop/src-tauri/src/lib.rs`, update the four command bodies to pass `None` for now:
- `run_soql`: `features::soql::run_query_table(&state.invoker, &query, None)`
- `run_apex`: `features::anon_apex::run_anon(&state.invoker, &src, None)`
- `list_logs`: `features::debug_log::list_logs(&state.invoker, None)`
- `get_log`: `features::debug_log::get_log_body(&state.invoker, &id, None)`

- [ ] **Step 8: Verify the whole workspace**

Run: `cargo test --workspace --features sf-core/test-util`
Expected: PASS (all crates, incl. the two new forwarding tests).
Run: `cargo clippy --workspace --all-targets --features sf-core/test-util -- -D warnings` then `cargo fmt --all`
Expected: clippy clean; fmt rewrites if needed.

- [ ] **Step 9: Commit**

```bash
git add crates/features desktop/src-tauri/src/lib.rs
git commit --no-verify -m "feat(features): thread optional target_org through soql/apex/debug_log"
```

---

### Task 2: Org selector backend (AppState + commands)

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs` (AppState, commands, invoke_handler, thread selected org)
- Modify: `desktop/src-tauri/src/dto.rs` (OrgDto + mapping + test)

**Interfaces:**
- Consumes: `sf_core::{OrgRegistry, OrgRef}`, the Task-1 `target_org` params.
- Produces (Tauri commands): `list_orgs() -> Vec<OrgDto>`; `set_target_org(username: Option<String>)`. `OrgDto { username, alias: Option<String>, instance_url: Option<String>, is_default: bool }`. `AppState { invoker, selected_org: Mutex<Option<String>> }`.

- [ ] **Step 1: Write the failing test (OrgDto mapping)**

Add to `desktop/src-tauri/src/dto.rs` test module (create a `#[cfg(test)] mod tests` if absent):

```rust
    #[test]
    fn org_dto_maps_from_org_ref() {
        let r = sf_core::OrgRef {
            username: "me@x.com".into(),
            alias: Some("dev".into()),
            instance_url: Some("https://x.my".into()),
            is_default: true,
        };
        let d = OrgDto::from(&r);
        assert_eq!(d.username, "me@x.com");
        assert_eq!(d.alias.as_deref(), Some("dev"));
        assert!(d.is_default);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p sf-toolkit-desktop dto::tests::org_dto_maps_from_org_ref`
Expected: FAIL — `OrgDto` not found.

- [ ] **Step 3: Add OrgDto + mapping to dto.rs**

```rust
use sf_core::OrgRef;

#[derive(serde::Serialize)]
pub struct OrgDto {
    pub username: String,
    pub alias: Option<String>,
    pub instance_url: Option<String>,
    pub is_default: bool,
}

impl From<&OrgRef> for OrgDto {
    fn from(o: &OrgRef) -> Self {
        OrgDto {
            username: o.username.clone(),
            alias: o.alias.clone(),
            instance_url: o.instance_url.clone(),
            is_default: o.is_default,
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p sf-toolkit-desktop dto::tests::org_dto_maps_from_org_ref`
Expected: PASS.

- [ ] **Step 5: Wire AppState + commands in lib.rs**

In `desktop/src-tauri/src/lib.rs`:
- Change `AppState` to:

```rust
pub struct AppState {
    invoker: SfInvoker,
    selected_org: std::sync::Mutex<Option<String>>,
}
```

- Where `AppState` is constructed (in the `run`/builder setup), initialize `selected_org: std::sync::Mutex::new(None)`.
- Add a helper near the top:

```rust
fn current_org(state: &AppState) -> Option<String> {
    state.selected_org.lock().unwrap().clone()
}
```

- Add commands:

```rust
#[tauri::command]
async fn list_orgs(state: State<'_, AppState>) -> Result<Vec<dto::OrgDto>, String> {
    let orgs = sf_core::OrgRegistry::list(&state.invoker)
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(orgs.iter().map(dto::OrgDto::from).collect())
}

#[tauri::command]
fn set_target_org(username: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    *state.selected_org.lock().unwrap() = username;
    Ok(())
}
```

- In the four existing commands, replace `None` with the selected org. Because `current_org` returns an owned `Option<String>`, bind it then pass `.as_deref()`:

```rust
// run_soql
let org = current_org(&state);
let table = features::soql::run_query_table(&state.invoker, &query, org.as_deref()).await ...
// run_apex
let org = current_org(&state);
... run_anon(&state.invoker, &src, org.as_deref()) ...
// list_logs
let org = current_org(&state);
... debug_log::list_logs(&state.invoker, org.as_deref()) ...
// get_log
let org = current_org(&state);
... debug_log::get_log_body(&state.invoker, &id, org.as_deref()) ...
```

- Register the two new commands in `invoke_handler![ ... ]` alongside the existing ones, and ensure `mod dto;` exposes `OrgDto` (`pub use` not required since referenced as `dto::OrgDto`).

- [ ] **Step 6: Verify**

Run: `cargo test -p sf-toolkit-desktop` then `cargo build --workspace`
Expected: tests PASS; workspace builds. Run `cargo clippy --workspace --all-targets --features sf-core/test-util -- -D warnings` and `cargo fmt --all` — clean.

- [ ] **Step 7: Commit**

```bash
git add desktop/src-tauri
git commit --no-verify -m "feat(desktop): org list + target-org selection backend"
```

---

### Task 3: OrgSelector React component

**Files:**
- Create: `desktop/src/components/OrgSelector.tsx`
- Modify: `desktop/src/types.ts` (add `OrgDto`)
- Modify: `desktop/src/App.tsx` (replace static chip with `<OrgSelector />`)

**Interfaces:**
- Consumes: Tauri `list_orgs` → `OrgDto[]`, `set_target_org(username)`.
- Produces: `OrgSelector` (self-contained; no props).

- [ ] **Step 1: Add OrgDto to types.ts**

Append to `desktop/src/types.ts`:

```ts
export interface OrgDto {
  username: string;
  alias: string | null;
  instance_url: string | null;
  is_default: boolean;
}
```

- [ ] **Step 2: Create OrgSelector.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Globe, Check, ChevronDown } from "lucide-react";
import type { OrgDto } from "../types";

/** Top-bar org picker: lists `sf` orgs and sets the target org for all calls. */
export function OrgSelector() {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<OrgDto[]>("list_orgs")
      .then((list) => {
        setOrgs(list);
        const def = list.find((o) => o.is_default) ?? list[0];
        if (def) {
          setSelected(def.username);
          invoke("set_target_org", { username: def.username });
        }
      })
      .catch((e) => setError(typeof e === "string" ? e : String(e)));
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (o: OrgDto) => {
    setSelected(o.username);
    setOpen(false);
    invoke("set_target_org", { username: o.username });
  };

  const label = (() => {
    const cur = orgs.find((o) => o.username === selected);
    if (error) return "org error";
    if (!cur) return orgs.length ? "select org" : "no orgs";
    return cur.alias ?? cur.username;
  })();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Select Salesforce org"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={orgs.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="focus-accent inline-flex cursor-pointer items-center gap-2 rounded-[3px] border border-hair px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Globe size={12} className="text-accent" />
        <span className="normal-case tracking-normal">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && orgs.length > 0 && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 max-h-72 w-72 overflow-auto rounded-[3px] border border-hair bg-surface py-1 text-[12px] shadow-lg"
        >
          {orgs.map((o) => (
            <li key={o.username}>
              <button
                type="button"
                role="option"
                aria-selected={o.username === selected}
                onClick={() => choose(o)}
                className={`focus-accent flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-hair/40 ${
                  o.username === selected ? "text-accent" : "text-text"
                }`}
              >
                <span className="truncate">
                  {o.alias ? `${o.alias} · ` : ""}
                  {o.username}
                </span>
                <span className="flex items-center gap-1 text-text-faint">
                  {o.is_default && <span className="text-[10px] uppercase">default</span>}
                  {o.username === selected && <Check size={12} className="text-accent" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount in App.tsx**

In `desktop/src/App.tsx`: `import { OrgSelector } from "./components/OrgSelector";` and replace the existing static `<span className="inline-flex …">…ORG default</span>` chip in the header with `<OrgSelector />`.

- [ ] **Step 4: Verify build**

Run: `cd desktop && pnpm build`
Expected: tsc + vite PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src
git commit --no-verify -m "feat(desktop): org selector dropdown in top bar"
```

---

### Task 4: SOQL result DTO — tree + real total_size

**Files:**
- Modify: `desktop/src-tauri/src/dto.rs` (RecordDto/FieldDto/FieldValueDto + mapping + test)
- Modify: `desktop/src-tauri/src/lib.rs` (`run_soql` returns `SoqlResultDto`)

**Interfaces:**
- Consumes: `features::soql::{run_query, QueryResult, Record, FieldValue}`.
- Produces: `SoqlResultDto { columns, rows, total_size, done, tree: Vec<RecordDto> }`; `RecordDto { sobject_type, fields: Vec<FieldDto> }`; `FieldDto { name, value: FieldValueDto }`; `FieldValueDto` tagged enum `{ kind: "null"|"scalar"|"parent"|"children", scalar?: String, parent?: RecordDto, children?: Vec<RecordDto> }`.

- [ ] **Step 1: Write the failing test (record tree mapping)**

Add to `desktop/src-tauri/src/dto.rs` tests:

```rust
    #[test]
    fn record_dto_maps_scalar_parent_children() {
        use features::soql::{FieldValue, QueryResult, Record};
        let parent = Record {
            sobject_type: "User".into(),
            fields: vec![("Name".into(), FieldValue::Scalar(serde_json::json!("Amy")))],
        };
        let child = Record {
            sobject_type: "Contact".into(),
            fields: vec![("LastName".into(), FieldValue::Scalar(serde_json::json!("Lee")))],
        };
        let rec = Record {
            sobject_type: "Account".into(),
            fields: vec![
                ("Id".into(), FieldValue::Scalar(serde_json::json!("001"))),
                ("Phone".into(), FieldValue::Null),
                ("Owner".into(), FieldValue::Parent(Box::new(parent))),
                ("Contacts".into(), FieldValue::Children(QueryResult {
                    total_size: 1, done: true, records: vec![child],
                })),
            ],
        };
        let d = map_record(&rec);
        assert_eq!(d.sobject_type, "Account");
        assert_eq!(d.fields.len(), 4);
        assert_eq!(d.fields[0].value.kind, "scalar");
        assert_eq!(d.fields[0].value.scalar.as_deref(), Some("001"));
        assert_eq!(d.fields[1].value.kind, "null");
        assert_eq!(d.fields[2].value.kind, "parent");
        assert_eq!(d.fields[2].value.parent.as_ref().unwrap().sobject_type, "User");
        assert_eq!(d.fields[3].value.kind, "children");
        assert_eq!(d.fields[3].value.children.as_ref().unwrap().len(), 1);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p sf-toolkit-desktop dto::tests::record_dto_maps_scalar_parent_children`
Expected: FAIL — `map_record`/`RecordDto` not found.

- [ ] **Step 3: Add DTOs + mapping to dto.rs**

```rust
use features::soql::{FieldValue, Record};

#[derive(serde::Serialize)]
pub struct RecordDto {
    pub sobject_type: String,
    pub fields: Vec<FieldDto>,
}

#[derive(serde::Serialize)]
pub struct FieldDto {
    pub name: String,
    pub value: FieldValueDto,
}

#[derive(serde::Serialize)]
pub struct FieldValueDto {
    pub kind: &'static str, // "null" | "scalar" | "parent" | "children"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scalar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<Box<RecordDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<RecordDto>>,
}

fn scalar_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

pub fn map_record(r: &Record) -> RecordDto {
    RecordDto {
        sobject_type: r.sobject_type.clone(),
        fields: r
            .fields
            .iter()
            .map(|(name, value)| FieldDto {
                name: name.clone(),
                value: map_field_value(value),
            })
            .collect(),
    }
}

fn map_field_value(v: &FieldValue) -> FieldValueDto {
    match v {
        FieldValue::Null => FieldValueDto { kind: "null", scalar: None, parent: None, children: None },
        FieldValue::Scalar(s) => FieldValueDto {
            kind: "scalar",
            scalar: Some(scalar_text(s)),
            parent: None,
            children: None,
        },
        FieldValue::Parent(rec) => FieldValueDto {
            kind: "parent",
            scalar: None,
            parent: Some(Box::new(map_record(rec))),
            children: None,
        },
        FieldValue::Children(qr) => FieldValueDto {
            kind: "children",
            scalar: None,
            parent: None,
            children: Some(qr.records.iter().map(map_record).collect()),
        },
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p sf-toolkit-desktop dto::tests::record_dto_maps_scalar_parent_children`
Expected: PASS.

- [ ] **Step 5: Rewrite run_soql in lib.rs**

Replace the `TableDto` struct + `run_soql` command:

```rust
#[derive(serde::Serialize)]
struct SoqlResultDto {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    total_size: u64,
    done: bool,
    tree: Vec<dto::RecordDto>,
}

#[tauri::command]
async fn run_soql(query: String, state: State<'_, AppState>) -> Result<SoqlResultDto, String> {
    let org = current_org(&state);
    let result = features::soql::run_query(&state.invoker, &query, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    let table = result.to_table();
    Ok(SoqlResultDto {
        columns: table.columns,
        rows: table.rows,
        total_size: result.total_size,
        done: result.done,
        tree: result.records.iter().map(dto::map_record).collect(),
    })
}
```

(`QueryResult::to_table` borrows `&self`, so call it before moving `records`; the code above clones via the table projection and then borrows `result.records`, which is fine since `to_table` returns owned data.)

- [ ] **Step 6: Verify**

Run: `cargo test -p sf-toolkit-desktop` then `cargo build --workspace`; `cargo clippy --workspace --all-targets --features sf-core/test-util -- -D warnings`; `cargo fmt --all`.
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add desktop/src-tauri
git commit --no-verify -m "feat(desktop): SOQL result returns record tree + real total_size"
```

---

### Task 5: SOQL status line + Table/Tree toggle + RecordTree

**Files:**
- Create: `desktop/src/components/RecordTree.tsx`
- Modify: `desktop/src/types.ts` (SoqlResultDto + Record/Field DTOs)
- Modify: `desktop/src/panels/SoqlPanel.tsx`

**Interfaces:**
- Consumes: `run_soql` → `SoqlResultDto`.
- Produces: `RecordTree({ records }: { records: RecordDto[] })`; updated `SoqlResultDto` type.

- [ ] **Step 1: Update types.ts**

Replace the existing `TableDto` (and add tree types):

```ts
export interface FieldValueDto {
  kind: "null" | "scalar" | "parent" | "children";
  scalar?: string;
  parent?: RecordDto;
  children?: RecordDto[];
}
export interface FieldDto { name: string; value: FieldValueDto }
export interface RecordDto { sobject_type: string; fields: FieldDto[] }
export interface SoqlResultDto {
  columns: string[];
  rows: string[][];
  total_size: number;
  done: boolean;
  tree: RecordDto[];
}
```

If `ResultTable` imports `TableDto`, update it to accept `{ columns, rows }` (a structural subset of `SoqlResultDto`); change its prop type to `{ data: { columns: string[]; rows: string[][] } }`.

- [ ] **Step 2: Create RecordTree.tsx**

```tsx
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { RecordDto, FieldDto } from "../types";

function FieldRow({ field, depth }: { field: FieldDto; depth: number }) {
  const [open, setOpen] = useState(false);
  const pad = { paddingLeft: `${depth * 14 + 12}px` };
  const v = field.value;

  if (v.kind === "parent" && v.parent) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="focus-accent flex w-full cursor-pointer items-center gap-1 py-0.5 text-left hover:bg-hair/30"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-text">{field.name}</span>
          <span className="text-text-faint">▸ {v.parent.sobject_type}</span>
        </button>
        {open && <RecordNode record={v.parent} depth={depth + 1} />}
      </>
    );
  }
  if (v.kind === "children" && v.children) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="focus-accent flex w-full cursor-pointer items-center gap-1 py-0.5 text-left hover:bg-hair/30"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-text">{field.name}</span>
          <span className="text-text-faint tnum">[{v.children.length}]</span>
        </button>
        {open &&
          v.children.map((c, i) => <RecordNode key={i} record={c} depth={depth + 1} />)}
      </>
    );
  }
  return (
    <div style={pad} className="flex gap-2 py-0.5">
      <span className="text-text-dim">{field.name}</span>
      <span className="tnum text-text">
        {v.kind === "null" ? <span className="text-text-faint">null</span> : v.scalar}
      </span>
    </div>
  );
}

function RecordNode({ record, depth }: { record: RecordDto; depth: number }) {
  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        className="micro-label py-0.5 text-accent"
      >
        {record.sobject_type}
      </div>
      {record.fields.map((f, i) => (
        <FieldRow key={i} field={f} depth={depth + 1} />
      ))}
    </div>
  );
}

/** Expandable parent/child record tree for a SOQL result. */
export function RecordTree({ records }: { records: RecordDto[] }) {
  if (records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
        — no rows —
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto py-1 text-[12px]">
      {records.map((r, i) => (
        <RecordNode key={i} record={r} depth={0} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update SoqlPanel.tsx (status line + toggle)**

Replace the result `Panel` body so it renders a header with a status line + `Table | Tree` toggle, then the active view. Key changes: import `RecordTree`, add `view` state, change result type to `SoqlResultDto`.

```tsx
import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { SoqlEditor } from "../components/SoqlEditor";
import { ResultTable } from "../components/ResultTable";
import { RecordTree } from "../components/RecordTree";
import type { SoqlResultDto } from "../types";

const DEFAULT_QUERY = "SELECT Id, Name FROM Account LIMIT 10";

export function SoqlPanel() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<SoqlResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"table" | "tree">("table");

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await invoke<SoqlResultDto>("run_soql", { query }));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setRunning(false);
    }
  }, [query]);

  const status = running
    ? "Executing…"
    : error
      ? "error"
      : result
        ? `${result.total_size} row${result.total_size === 1 ? "" : "s"} returned`
        : "";

  return (
    <PanelGroup direction="vertical">
      <Panel defaultSize={40} minSize={20}>
        <SoqlEditor value={query} onChange={setQuery} onRun={run} running={running} />
      </Panel>
      <PanelResizeHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-accent" />
      <Panel defaultSize={60} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-hair px-4 py-1.5">
            <div className="flex gap-1">
              {(["table", "tree"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`focus-accent cursor-pointer rounded-[3px] px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                    view === v ? "text-accent" : "text-text-dim hover:text-text"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="tnum text-[11px] text-text-dim">{status}</span>
          </div>
          <div className="min-h-0 flex-1">
            {error ? (
              <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
                {error}
              </pre>
            ) : !result ? (
              <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
                — run a query —
              </div>
            ) : view === "table" ? (
              <ResultTable data={result} />
            ) : (
              <RecordTree records={result.tree} />
            )}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd desktop && pnpm build`
Expected: PASS. (If `ResultTable`'s prop type errors, narrow it to `{ columns: string[]; rows: string[][] }` per Step 1.)

- [ ] **Step 5: Commit**

```bash
git add desktop/src
git commit --no-verify -m "feat(desktop): SOQL status line + Table/Tree result toggle"
```

---

### Task 6: Shared LogView — syntax highlight + filter

**Files:**
- Create: `desktop/src/components/LogView.tsx`
- Modify: `desktop/src/panels/ApexPanel.tsx` (use LogView for the inline debug log)
- Modify: `desktop/src/panels/LogsPanel.tsx` (use LogView for the raw view)

**Interfaces:**
- Consumes: a raw debug-log `string`.
- Produces: `LogView({ raw }: { raw: string })`.

- [ ] **Step 1: Create LogView.tsx**

```tsx
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

/** Color class for a log line based on its event token (2nd `|` field). */
function lineClass(line: string): string {
  if (/\|(FATAL_ERROR|EXCEPTION_THROWN)\|/.test(line)) return "text-red";
  if (/\|USER_DEBUG\|/.test(line)) return "text-accent";
  if (/\|(LIMIT_USAGE|HEAP_ALLOCATE|CUMULATIVE_LIMIT)/.test(line)) return "text-text-faint";
  return "text-text-dim";
}

/** Raw Salesforce debug log with per-event coloring + search/Debug-Only filter. */
export function LogView({ raw }: { raw: string }) {
  const [q, setQ] = useState("");
  const [debugOnly, setDebugOnly] = useState(false);
  const [highlight, setHighlight] = useState(true);

  const lines = useMemo(() => raw.split("\n"), [raw]);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return lines.filter((l) => {
      if (debugOnly && !l.includes("|USER_DEBUG|")) return false;
      if (needle && !l.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, q, debugOnly]);

  const render = (line: string, i: number) => {
    if (!highlight || !q) return line;
    const idx = line.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return line;
    return (
      <>
        {line.slice(0, idx)}
        <mark className="bg-accent/30 text-text">{line.slice(idx, idx + q.length)}</mark>
        {line.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-hair px-3 py-1.5 text-[11px]">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter log…"
            aria-label="Filter log"
            className="focus-accent w-full rounded-[3px] border border-hair bg-surface py-1 pl-7 pr-2 text-[12px] text-text placeholder:text-text-faint"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-1 text-text-dim">
          <input type="checkbox" checked={debugOnly} onChange={(e) => setDebugOnly(e.target.checked)} />
          Debug Only
        </label>
        <label className="flex cursor-pointer items-center gap-1 text-text-dim">
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
          Highlight
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg px-3 py-2 font-mono text-[12px] leading-relaxed">
        {filtered.length === 0 ? (
          <div className="text-text-faint">— no matching lines —</div>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap ${lineClass(l)}`}>
              {render(l, i)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Use LogView in LogsPanel.tsx**

In `desktop/src/panels/LogsPanel.tsx`: `import { LogView } from "../components/LogView";` and replace the raw-log block (the `<pre>`/`{view.raw}` area showing the selected log) with `<LogView raw={view.raw} />`. Keep the `API {version} · {n} units` header line above it.

- [ ] **Step 3: Use LogView in ApexPanel.tsx**

In `desktop/src/panels/ApexPanel.tsx`: `import { LogView } from "../components/LogView";` and replace the inline DEBUG LOG `<pre>`/scroll area (which renders `logs`) with `<LogView raw={logs} />` (use whatever variable currently holds the run's `logs` string). Keep the COMPILED/SUCCESS chips and compile/runtime error sections above it.

- [ ] **Step 4: Verify build**

Run: `cd desktop && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src
git commit --no-verify -m "feat(desktop): syntax-highlighted, filterable debug log view"
```

---

## Self-Review

- **Spec coverage:** Unit 1 org selector → Tasks 1 (threading) + 2 (backend) + 3 (UI). Unit 2 SOQL status/tree → Tasks 4 (DTO) + 5 (UI). Unit 3 log highlight/filter → Task 6. Unit 4 visual fidelity → folded into Tasks 3/5/6 (tokens, green run already present, globe dropdown). All covered.
- **Placeholder scan:** No TBDs; every code step shows complete code. The only "find the current variable name" notes (ApexPanel `logs`, src-tauri AppState construction site) are explicit modify instructions, not placeholders.
- **Type consistency:** `target_org: Option<&str>` last param across all six features fns; `OrgDto`/`RecordDto`/`FieldDto`/`FieldValueDto`/`SoqlResultDto` names identical between dto.rs (serde) and types.ts (TS); `map_record` used in Task 4 test and run_soql; `current_org` defined in Task 2 used in Task 4.
- **Order:** Task 1 keeps the workspace compiling (callers pass `None`); Task 2 swaps in the real org; frontend Tasks 3/5/6 each end at a green `pnpm build`.
