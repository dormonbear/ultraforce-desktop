# Offline Symbol Table (full index) — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Replace lazy on-demand completion fetching with a one-time full background index that persists a complete local symbol table, so completion serves 100% offline (no "Loading") once indexed.

**Architecture:** A Rust index job assembles `Ost` = stdlib namespaces + all org Apex classes (full SymbolTables) + all sObject types, persists it as a JSON snapshot + manifest under `~/.cache/ultraforce`, and pre-populates `SchemaStore`'s per-object disk cache. `ApexCompleter` loads the snapshot into its in-memory cache and (when indexed) skips all on-demand fetches. A Tauri command runs the job and emits `index-progress` events; the frontend shows progress and a "reindex" control.

**Tech Stack:** Rust (`features`, `apex-lang`, `sf-schema` crates; `tokio`), Tauri 2 events (`tauri::Emitter`), React 19.

## Global Constraints

- English code/comments; no author attribution.
- Data is **first-party only** — Salesforce endpoints (Tooling completions, Tooling `ApexClass.SymbolTable`, sObject describe). Never that plugin bundled data. ([[sf-toolkit-apex-data-first-party-only]])
- Reuse the existing cache root `OstStore::default_root()` (`~/.cache/ultraforce`).
- `Ost`, `ApexType`, `Namespace` already derive `Serialize`/`Deserialize` — snapshot is `serde_json` of `Ost`.
- v1 sObject describe is **sequential** (ponytail: simple + correct first). `// ponytail: sequential describe; add bounded concurrency if first-index time is too long`.
- Long fetches use `run_raw_with_timeout` (already 300s for stdlib).
- Existing signatures: `fetch_apex_symbols(invoker,&str)->Result<Vec<Value>,SfError>`; `parse_stdlib(&Value)->Vec<Namespace>`; `parse_org_types(&[Value])->Vec<ApexType>`; `OstStore::{new,get_or_fetch(invoker,api,OstSource),default_root}`; `OstSource::{Stdlib,OrgTypes}`; `SchemaStore::{new,get_or_fetch(invoker,api,&str)->Result<SObjectSchema,_>,clear,default_root}`; `features::soql::list_sobject_names(invoker,org)->Vec<String>`; `features::api_version::api_version_for(invoker,org)->String`; `ApexCompleter{root,cache:Mutex<Option<(String,Arc<Ost>)>>}`.

---

### Task 1: OST snapshot persistence (`apex-lang`)

**Files:**
- Create: `crates/apex-lang/src/snapshot.rs`
- Modify: `crates/apex-lang/src/lib.rs` (`pub mod snapshot;` + re-exports)

**Interfaces:**
- Produces:
  - `pub struct IndexManifest { pub org_id: String, pub api_version: String, pub indexed_at: String, pub namespaces: usize, pub classes: usize, pub sobjects: usize }` (derive `Serialize, Deserialize, Clone, Debug, PartialEq`)
  - `pub fn save_snapshot(root: &Path, ost: &Ost, manifest: &IndexManifest) -> std::io::Result<()>` — writes `<root>/<org_id>/index.json` (the `Ost`) + `<root>/<org_id>/index.meta.json` (the manifest).
  - `pub fn load_snapshot(root: &Path, org_id: &str, api_version: &str) -> Option<(Ost, IndexManifest)>` — `None` when missing or `manifest.api_version != api_version`.

- [ ] **Step 1: Write the failing test**

Create `crates/apex-lang/src/snapshot.rs` with only the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Ost};

    fn sample() -> (Ost, IndexManifest) {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![ApexType { name: "Foo".into(), ..Default::default() }],
        };
        let m = IndexManifest {
            org_id: "myorg".into(),
            api_version: "60.0".into(),
            indexed_at: "2026-06-21T00:00:00Z".into(),
            namespaces: 0,
            classes: 1,
            sobjects: 0,
        };
        (ost, m)
    }

    #[test]
    fn save_then_load_roundtrips() {
        let root = std::env::temp_dir().join(format!("snap-{}", std::process::id()));
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        let (got_ost, got_m) = load_snapshot(&root, "myorg", "60.0").unwrap();
        assert_eq!(got_ost, ost);
        assert_eq!(got_m, m);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_returns_none_on_api_mismatch() {
        let root = std::env::temp_dir().join(format!("snap2-{}", std::process::id()));
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        assert!(load_snapshot(&root, "myorg", "61.0").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p apex-lang snapshot 2>&1 | tail -5`
Expected: FAIL (no `save_snapshot`).

- [ ] **Step 3: Implement `snapshot.rs`** (above the test module)

```rust
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::symbols::Ost;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IndexManifest {
    pub org_id: String,
    pub api_version: String,
    pub indexed_at: String,
    pub namespaces: usize,
    pub classes: usize,
    pub sobjects: usize,
}

fn org_dir(root: &Path, org_id: &str) -> std::path::PathBuf {
    root.join(org_id)
}

/// Persist the assembled OST + manifest under `<root>/<org_id>/`.
pub fn save_snapshot(root: &Path, ost: &Ost, manifest: &IndexManifest) -> std::io::Result<()> {
    let dir = org_dir(root, &manifest.org_id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("index.json"), serde_json::to_vec_pretty(ost).unwrap())?;
    std::fs::write(
        dir.join("index.meta.json"),
        serde_json::to_vec_pretty(manifest).unwrap(),
    )?;
    Ok(())
}

/// Load a persisted snapshot, or `None` when absent / built for another API version.
pub fn load_snapshot(root: &Path, org_id: &str, api_version: &str) -> Option<(Ost, IndexManifest)> {
    let dir = org_dir(root, org_id);
    let manifest: IndexManifest =
        serde_json::from_slice(&std::fs::read(dir.join("index.meta.json")).ok()?).ok()?;
    if manifest.api_version != api_version {
        return None;
    }
    let ost: Ost = serde_json::from_slice(&std::fs::read(dir.join("index.json")).ok()?).ok()?;
    Some((ost, manifest))
}
```

Add `pub mod snapshot;` to `crates/apex-lang/src/lib.rs` and re-export: `pub use snapshot::{save_snapshot, load_snapshot, IndexManifest};`.

- [ ] **Step 4: Run, verify pass**

Run: `cargo test -p apex-lang snapshot 2>&1 | tail -5`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/apex-lang/src/snapshot.rs crates/apex-lang/src/lib.rs
git commit -m "feat(apex-lang): OST snapshot + manifest persistence"
```

---

### Task 2: Index orchestration (`features::index`)

**Files:**
- Create: `crates/features/src/index.rs`
- Modify: `crates/features/src/lib.rs` (`pub mod index;`)
- Modify: `crates/features/src/apex_complete.rs` (`schema_to_apex_type` → `pub(crate)`)

**Interfaces:**
- Consumes: `OstStore`, `OstSource`, `parse_stdlib`, `parse_org_types`, `save_snapshot`, `IndexManifest` (apex-lang); `SchemaStore` (sf-schema); `list_sobject_names`, `api_version_for`, `schema_to_apex_type` (features).
- Produces:
  - `pub struct IndexProgress { pub phase: &'static str, pub done: usize, pub total: usize }` (`Clone, Debug`)
  - `pub async fn index_org(invoker: &SfInvoker, root: PathBuf, org_id: &str, on_progress: &mut dyn FnMut(IndexProgress)) -> Result<apex_lang::Ost, SfError>` — fetches stdlib + all classes + all sObjects, assembles `Ost`, saves snapshot, returns it.

- [ ] **Step 1: Make `schema_to_apex_type` crate-visible**

In `crates/features/src/apex_complete.rs`, change `fn schema_to_apex_type(` to `pub(crate) fn schema_to_apex_type(`.

- [ ] **Step 2: Write the failing test**

Create `crates/features/src/index.rs` test module. The mock runner returns: stdlib completions (reuse the fixture pattern from apex_complete tests), an `ApexClass` SymbolTable query result, a `sobject list` result, and a describe. Keep it minimal — assert the assembled OST contains the org class and the sObject type, the snapshot file exists, and progress fired.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::{runner::MockRunner, RawOutput, SfInvoker};
    use std::sync::Arc;

    fn ok(stdout: &str) -> std::io::Result<RawOutput> {
        Ok(RawOutput { status: 0, stdout: stdout.to_string() })
    }

    #[tokio::test]
    async fn index_assembles_classes_and_sobjects_and_persists() {
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("completions") {
                // stdlib payload: one System namespace, one type
                ok(r#"{"publicDeclarations":{"System":{"Math":{"methods":[],"properties":[],"constructors":[]}}}}"#)
            } else if a.contains("ApexClass") {
                // tooling query → SymbolTable for class Foo
                ok(r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","tableDeclaration":{"name":"Foo"},"methods":[],"properties":[],"innerClasses":[],"interfaces":[]}}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                // sObject describe for Account
                ok(r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string","relationshipName":null,"referenceTo":[]}],"childRelationships":[]}}"#)
            }
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let root = std::env::temp_dir().join(format!("idx-{}", std::process::id()));
        let mut phases = vec![];
        let ost = index_org(&invoker, root.clone(), "myorg", &mut |p| phases.push(p.phase))
            .await
            .unwrap();

        assert!(ost.org_types.iter().any(|t| t.name == "Foo"), "org class present");
        assert!(ost.org_types.iter().any(|t| t.name == "Account"), "sObject present");
        assert!(ost.namespaces.iter().any(|n| n.name == "System"), "stdlib present");
        assert!(root.join("myorg/index.json").exists(), "snapshot written");
        assert!(phases.contains(&"sobjects"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
```

(Adjust the exact JSON envelopes to whatever `parse_stdlib`/`parse_org_types`/`SchemaStore` expect — cross-check the fixtures in `crates/apex-lang/tests/fixtures/` and `crates/sf-schema` tests; the test must compile against the real parsers.)

- [ ] **Step 3: Run, verify fail**

Run: `cargo test -p features index_assembles 2>&1 | tail -8`
Expected: FAIL (no `index_org`).

- [ ] **Step 4: Implement `index.rs`**

```rust
//! One-time full index of an org's symbols into a persisted offline OST.
use std::path::PathBuf;

use apex_lang::acquire::{parse_org_types, parse_stdlib};
use apex_lang::store::{OstSource, OstStore};
use apex_lang::{save_snapshot, IndexManifest, Ost};
use sf_core::{SfError, SfInvoker};
use sf_schema::SchemaStore;

use crate::apex_complete::schema_to_apex_type;
use crate::api_version::api_version_for;
use crate::soql::list_sobject_names;

#[derive(Clone, Debug)]
pub struct IndexProgress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

/// Full index: stdlib + every org Apex class + every sObject. Persists a
/// snapshot and returns the assembled OST. `on_progress` is called per phase
/// and per sObject described.
pub async fn index_org(
    invoker: &SfInvoker,
    root: PathBuf,
    org_id: &str,
    on_progress: &mut dyn FnMut(IndexProgress),
) -> Result<Ost, SfError> {
    let api = api_version_for(invoker, org_id).await;

    on_progress(IndexProgress { phase: "stdlib", done: 0, total: 1 });
    let mut ost_store = OstStore::new(root.clone(), org_id);
    let stdlib = ost_store.get_or_fetch(invoker, &api, OstSource::Stdlib).await?;
    let namespaces = parse_stdlib(&stdlib);
    on_progress(IndexProgress { phase: "stdlib", done: 1, total: 1 });

    on_progress(IndexProgress { phase: "classes", done: 0, total: 1 });
    let org_types_raw = ost_store.get_or_fetch(invoker, &api, OstSource::OrgTypes).await?;
    let mut org_types = match &org_types_raw {
        serde_json::Value::Array(records) => parse_org_types(records),
        _ => Vec::new(),
    };
    on_progress(IndexProgress { phase: "classes", done: org_types.len(), total: org_types.len() });

    let names = list_sobject_names(invoker, org_id).await;
    let total = names.len();
    let mut schema_store = SchemaStore::new(root.clone(), org_id);
    for (i, name) in names.iter().enumerate() {
        if let Ok(schema) = schema_store.get_or_fetch(invoker, &api, name).await {
            org_types.push(schema_to_apex_type(&schema));
        }
        on_progress(IndexProgress { phase: "sobjects", done: i + 1, total });
    }

    let ost = Ost { namespaces, org_types };
    let manifest = IndexManifest {
        org_id: org_id.to_string(),
        api_version: api,
        indexed_at: now_iso8601(),
        namespaces: ost.namespaces.len(),
        classes: ost.org_types.len() - total.min(ost.org_types.len()),
        sobjects: total,
    };
    let _ = save_snapshot(&root, &ost, &manifest);
    on_progress(IndexProgress { phase: "done", done: total, total });
    Ok(ost)
}

fn now_iso8601() -> String {
    // Coarse timestamp; chrono not a dep. Seconds since epoch is enough for the manifest.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch:{secs}")
}
```

Add `pub mod index;` to `crates/features/src/lib.rs`. Confirm `apex_lang` re-exports `Ost`, `save_snapshot`, `IndexManifest` (Task 1 added these); if `Ost` isn't re-exported at crate root, import it from `apex_lang::symbols::Ost`.

- [ ] **Step 5: Run, verify pass**

Run: `cargo test -p features index_assembles 2>&1 | tail -8`
Expected: PASS. (Fix JSON envelopes against the real parsers until green.)

- [ ] **Step 6: Commit**

```bash
git add crates/features/src/index.rs crates/features/src/lib.rs crates/features/src/apex_complete.rs
git commit -m "feat(features): full org index assembling stdlib + classes + sObjects"
```

---

### Task 3: ApexCompleter loads snapshot + offline-only completion

**Files:**
- Modify: `crates/features/src/apex_complete.rs`

**Interfaces:**
- Consumes: `apex_lang::load_snapshot` (Task 1), `index_org` (Task 2 — used by the Tauri layer, not here).
- Produces:
  - `ApexCompleter` gains `indexed: Mutex<std::collections::HashSet<String>>`.
  - `pub fn install_index(&self, org_id: &str, ost: Ost)` — store a freshly-built index into the cache + mark indexed.
  - `ensure_base` loads a disk snapshot before falling back to the lazy `build`.
  - `complete` skips the on-demand fetch block when the org is indexed.

- [ ] **Step 1: Write the failing test (offline-only)**

Add to the `apex_complete.rs` test module: build an index in-memory, install it, then call `complete` with an invoker whose runner **panics on any call** — proving no network happens when indexed.

```rust
#[tokio::test]
async fn indexed_completion_makes_no_sf_calls() {
    use apex_lang::symbols::{ApexType, Member, Ost};
    let dir = std::env::temp_dir().join(format!("idx-off-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());
    // Full type so resolve() finds a non-stub.
    let acct = ApexType {
        name: "Account".into(),
        properties: vec![Member { name: "Name".into(), ..Default::default() }],
        ..Default::default()
    };
    completer.install_index("myorg", Ost { namespaces: vec![], org_types: vec![acct] });

    let panicking = sf_core::runner::MockRunner::new(|_p, _a| panic!("no SF call when indexed"));
    let invoker = SfInvoker::new(std::sync::Arc::new(panicking));
    let src = "Account a; a.";
    let got = completer.complete(&invoker, "myorg", src, src.len()).await.unwrap();
    assert!(got.iter().any(|c| c.label == "Name"), "offline member completion: {got:?}");
    let _ = std::fs::remove_dir_all(&dir);
}
```

(Match `Member`/`ApexType` field names to `apex-lang/src/symbols.rs`; use `..Default::default()`.)

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p features indexed_completion_makes_no 2>&1 | tail -8`
Expected: FAIL (no `install_index`; or it panics because on-demand still fires).

- [ ] **Step 3: Implement the gate**

In `crates/features/src/apex_complete.rs`:

Add the field to the struct and constructor:

```rust
pub struct ApexCompleter {
    root: PathBuf,
    cache: Mutex<Option<(String, Arc<Ost>)>>,
    indexed: Mutex<std::collections::HashSet<String>>,
}
```
(set `indexed: Mutex::new(Default::default())` in both `new` bodies.)

Add methods:

```rust
    /// True once a full snapshot has been installed/loaded for `org_id`.
    fn is_indexed(&self, org_id: &str) -> bool {
        self.indexed.lock().unwrap().contains(org_id)
    }

    /// Store a freshly-built full index and mark the org indexed.
    pub fn install_index(&self, org_id: &str, ost: Ost) {
        *self.cache.lock().unwrap() = Some((org_id.to_string(), Arc::new(ost)));
        self.indexed.lock().unwrap().insert(org_id.to_string());
    }
```

In `ensure_base`, try the disk snapshot before building:

```rust
    async fn ensure_base(&self, invoker: &SfInvoker, org_id: &str) -> Result<Arc<Ost>, SfError> {
        if let Some(ost) = self.cached(org_id) {
            return Ok(ost);
        }
        // Prefer a persisted full index (offline, instant) over a lazy rebuild.
        let api = crate::api_version::api_version_for(invoker, org_id).await;
        if let Some((ost, _)) = apex_lang::load_snapshot(&self.root, org_id, &api) {
            let arc = Arc::new(ost);
            *self.cache.lock().unwrap() = Some((org_id.to_string(), arc.clone()));
            self.indexed.lock().unwrap().insert(org_id.to_string());
            return Ok(arc);
        }
        let ost = Arc::new(self.build(invoker, org_id).await?);
        *self.cache.lock().unwrap() = Some((org_id.to_string(), ost.clone()));
        Ok(ost)
    }
```

In `complete`, gate the on-demand block:

```rust
        let ost = self.ensure_base(invoker, org_id).await?;
        // When fully indexed, never fetch on-demand — the snapshot is complete,
        // so unknown identifiers simply yield no candidates (no "Loading").
        if !self.is_indexed(org_id) {
            if let Some(type_name) = apex_lang::needed_type_at(src, cursor) {
                if resolve_type(&ost, &type_name).is_none_or(is_stub_type) {
                    if let Some(apex_ty) = self.describe_sobject(invoker, org_id, &type_name).await {
                        let augmented = self.augment_types(org_id, vec![apex_ty]);
                        return Ok(ost_complete(src, cursor, &augmented));
                    }
                    let classes = self.fetch_org_class(invoker, org_id, &type_name).await;
                    if !classes.is_empty() {
                        let augmented = self.augment_types(org_id, classes);
                        return Ok(ost_complete(src, cursor, &augmented));
                    }
                }
            }
        }
        Ok(ost_complete(src, cursor, &ost))
```

- [ ] **Step 4: Run, verify pass**

Run: `cargo test -p features 2>&1 | tail -8`
Expected: PASS (new test + existing apex_complete tests still green).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/apex_complete.rs
git commit -m "feat(features): load index snapshot + offline-only apex completion"
```

---

### Task 4: Tauri commands + progress events

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces commands: `index_org(org)` (load snapshot if present else full index), `reindex_org(org)` (clear + index). Both emit `index-progress` events `{ org, phase, done, total }`.

- [ ] **Step 1: Add the progress DTO + emit helper**

In `desktop/src-tauri/src/lib.rs`, add `use tauri::{Emitter, AppHandle};` and:

```rust
#[derive(Clone, serde::Serialize)]
struct IndexProgressDto {
    org: String,
    phase: String,
    done: usize,
    total: usize,
}
```

- [ ] **Step 2: Add `index_org` command**

```rust
#[tauri::command]
async fn index_org(org: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let root = features::apex_complete::default_index_root();
    let mut on_progress = |p: features::index::IndexProgress| {
        let _ = app.emit(
            "index-progress",
            IndexProgressDto { org: org.clone(), phase: p.phase.to_string(), done: p.done, total: p.total },
        );
    };
    let ost = features::index::index_org(&state.invoker, root, &org, &mut on_progress)
        .await
        .map_err(|e| e.to_string())?;
    state.apex.install_index(&org, ost);
    // also refresh the FROM-completion sObject-name cache
    let names = features::soql::list_sobject_names(&state.invoker, &org).await;
    state.sobjects.lock().unwrap().insert(org.clone(), std::sync::Arc::new(names));
    Ok(())
}
```

Add `pub fn default_index_root() -> PathBuf { OstStore::default_root() }` to `apex_complete.rs` (or reuse `apex_lang::store::OstStore::default_root()` directly in lib.rs).

- [ ] **Step 3: Add `reindex_org` command**

```rust
#[tauri::command]
async fn reindex_org(org: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Clear the sObject describe cache; the index overwrites the OST snapshot.
    let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
    let _ = store.clear();
    index_org(org, app, state).await
}
```

- [ ] **Step 4: Register the commands**

Add `index_org, reindex_org,` to the `tauri::generate_handler![…]` list. (Keep `warm_apex`/`warm_schema`/`refresh_schema_cache` for now; the frontend will move to `index_org`.)

- [ ] **Step 5: Verify it compiles**

Run: `cd desktop/src-tauri && cargo check 2>&1 | tail -8`
Expected: compiles. (If `e.to_string()` needs `SfError: Display`, it already is used elsewhere via `map_err`.)

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/lib.rs crates/features/src/apex_complete.rs
git commit -m "feat(desktop): index_org/reindex_org commands + progress events"
```

---

### Task 5: Frontend — progress indicator + reindex, drive on org-select

**Files:**
- Create: `desktop/src/components/IndexProgress.tsx`
- Modify: `desktop/src/org.tsx` (call `index_org` on select instead of warm_apex/warm_schema)
- Modify: `desktop/src/components/SchemaRefresh.tsx` (call `reindex_org`)
- Modify: `desktop/src/App.tsx` (mount `<IndexProgress/>`)

**Interfaces:**
- Consumes: `listen` from `@tauri-apps/api/event`; `invoke`.

- [ ] **Step 1: IndexProgress indicator**

Create `desktop/src/components/IndexProgress.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

interface Progress {
  org: string;
  phase: string;
  done: number;
  total: number;
}

/** Top-bar indicator shown while an org is being indexed; hides when done. */
export function IndexProgress() {
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => {
    const un = listen<Progress>("index-progress", (e) => {
      setP(e.payload.phase === "done" ? null : e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);
  if (!p) return null;
  const label =
    p.phase === "sobjects"
      ? `Indexing objects ${p.done}/${p.total}`
      : p.phase === "classes"
        ? "Indexing Apex classes"
        : "Indexing stdlib";
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
      <Loader2 size={12} className="spin" />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Mount it in the header**

In `desktop/src/App.tsx`, import `IndexProgress` and render `<IndexProgress />` in the header's right-hand control group (before `<SchemaRefresh />`).

- [ ] **Step 3: Drive indexing on org-select**

In `desktop/src/org.tsx`, replace the two warm calls in `select` and the initial-default effect:

```ts
void invoke("index_org", { org: username }).catch(() => {});
```
(remove the `warm_apex` + `warm_schema` invokes — `index_org` loads the snapshot if present, else runs the full index and emits progress.)

- [ ] **Step 4: SchemaRefresh → reindex**

In `desktop/src/components/SchemaRefresh.tsx`, change the invoke to `reindex_org` (no count returned):

```ts
await invoke("reindex_org", { org });
toast.success("Reindexing org…");
```
Update the tooltip text to "Reindex org".

- [ ] **Step 5: Build**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/components/IndexProgress.tsx desktop/src/App.tsx desktop/src/org.tsx desktop/src/components/SchemaRefresh.tsx
git commit -m "feat(desktop): index progress indicator + reindex control; index on org-select"
```

---

### Task 6: Full verification + e2e

**Files:**
- Modify: `desktop/e2e/fixtures.ts` (handle `index_org`/`reindex_org`; optionally emit `index-progress`)
- Modify: `desktop/e2e/ultraforce.spec.ts` (no regression; the apex test still works)

- [ ] **Step 1: Mock the new commands in fixtures**

In `desktop/e2e/fixtures.ts` `RESP`, add `index_org: null, reindex_org: null,` so org-select doesn't error.

- [ ] **Step 2: Run the whole suite**

Run:
```bash
cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace 2>&1 | tail -5
cd desktop && npx tsc --noEmit && pnpm build && pnpm exec playwright test 2>&1 | tail -8
```
Expected: fmt clean, clippy clean, all Rust tests pass, frontend green, all e2e pass.

- [ ] **Step 3: Commit**

```bash
git add desktop/e2e/fixtures.ts desktop/e2e/ultraforce.spec.ts
git commit -m "test(desktop): mock index commands; verify offline-index suite"
```

---

## Self-Review

**Spec coverage:** Full eager index (stdlib+classes+sObjects) → Task 2. Snapshot persistence + load-on-launch → Tasks 1, 3. Offline-only completion → Task 3. Manual reindex → Task 4 (`reindex_org`) + Task 5 (button). Progress events + UI → Tasks 4, 5. First-party data → unchanged (uses existing fetchers). Index-on-select → Task 5. SOQL-in-Apex / SOQL-panel go offline for free because the index populates `SchemaStore`'s disk cache (noted in spec §3) — no extra task needed. **Phase 2 (incremental auto-update) intentionally deferred** — manifest carries `indexed_at` to enable a later delta query; not implemented here.

**Placeholder scan:** Code present in every step. The two "match the real JSON envelopes / field names" notes (Task 2 Step 2, Task 3 Step 1) are explicit cross-checks against existing fixtures, not deferred work — the implementer makes the test compile against the real parsers.

**Type consistency:** `IndexManifest`/`save_snapshot`/`load_snapshot` (Task 1) used in Tasks 2–3. `index_org(invoker, root, org_id, &mut dyn FnMut(IndexProgress))` (Task 2) called identically in Task 4. `IndexProgress{phase,done,total}` (Task 2) → `IndexProgressDto{org,phase,done,total}` (Task 4) → frontend `Progress` (Task 5) consistent. `install_index(org_id, Ost)` / `is_indexed` (Task 3) used in Task 4. `schema_to_apex_type` made `pub(crate)` in Task 2 Step 1, used in Task 2 Step 4.
