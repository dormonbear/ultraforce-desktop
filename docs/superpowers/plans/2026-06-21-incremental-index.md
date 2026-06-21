# Incremental Index Update (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On org-select, load the existing offline snapshot instantly and delta-sync only the Apex classes / sObjects changed since the last index, instead of always re-running the full index.

**Architecture:** A new `features::index::sync_org` loads the snapshot, upserts changed Apex classes (`LastModifiedDate >` watermark) and re-describes changed sObjects (EntityDefinition + CustomField watermark), reconciles deletions against the full current name-lists, persists a new snapshot, and returns counts. The Tauri `index_org` command becomes smart: snapshot present → install + delta-sync (+ `sync-result` toast); absent → full index (unchanged Phase-1 path).

**Tech Stack:** Rust (apex-lang, features, sf-schema crates), Tauri 2 (events), React/TypeScript (sonner toast).

## Global Constraints

- Watermark is the snapshot manifest's `indexed_at` (real RFC3339 UTC, e.g. `2026-06-21T12:00:00Z`), interpolated as a bare SOQL datetime: `LastModifiedDate > 2026-06-21T12:00:00Z` (NO quotes).
- Tooling SOQL goes through `sf data query --query "<q>" --use-tooling-api` via `invoker.run_json`, wrapped in `with_target(args, org)` — exactly as `acquire::fetch_apex_symbols` does.
- Delta is best-effort: a query/parse failure must leave the loaded full snapshot installed and the watermark NOT advanced (next org-select retries). Only a fully-successful sync persists a new snapshot.
- **Reconcile safety:** never delete OST types when a name-list came back empty (a failed/empty fetch must not wipe the index). Reconcile only when BOTH the class-name list and the sObject-name list are non-empty.
- `schema_to_apex_type` is `pub(crate)` in `features::apex_complete` — `features::index` is the same crate and already imports it.
- No new crates. `tokio` is already a `features` dependency.
- English code + comments. No author attribution in commits. Conventional-commit messages exactly as given.

---

### Task 1: Targeted schema-cache eviction (`SchemaStore::evict`)

A delta must re-describe a *changed* sObject, but its describe is disk-cached (stale) from the full index. `clear()` nukes the whole org cache; we need to evict one object.

**Files:**
- Modify: `crates/sf-schema/src/store.rs` (add `evict` near `clear`, ~line 114)
- Test: same file's `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn evict(&mut self, api_version: &str, object: &str) -> Result<(), SfError>` — removes the in-memory entry and the on-disk `<root>/<org>/<api>/<object>.json`; missing file is `Ok(())`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/sf-schema/src/store.rs`:

```rust
#[tokio::test]
async fn evict_removes_one_object_keeping_siblings() {
    let root = std::env::temp_dir().join(format!("schema-evict-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let mut store = SchemaStore::new(&root, "00Dorg");
    // Seed two cached describes on disk via the mock-backed get_or_fetch.
    let inv = SfInvoker::new(Arc::new(MockRunner::new(|_p, args| {
        let a = args.join(" ");
        let name = if a.contains("Account") { "Account" } else { "Contact" };
        Ok(RawOutput {
            status: 0,
            stdout: format!(
                r#"{{"status":0,"result":{{"name":"{name}","fields":[],"childRelationships":[]}}}}"#
            ),
            stderr: String::new(),
        })
    })));
    store.get_or_fetch(&inv, "60.0", "Account").await.unwrap();
    store.get_or_fetch(&inv, "60.0", "Contact").await.unwrap();

    store.evict("60.0", "Account").unwrap();

    assert!(store.get("60.0", "Account").is_none(), "Account evicted from memory");
    assert!(
        !root.join("00Dorg/60.0/Account.json").exists(),
        "Account file deleted"
    );
    assert!(
        root.join("00Dorg/60.0/Contact.json").exists(),
        "Contact untouched"
    );
    let _ = std::fs::remove_dir_all(&root);
}
```

Ensure the test module imports exist (top of `mod tests`): `use super::*; use sf_core::runner::MockRunner; use sf_core::{RawOutput, SfInvoker}; use std::sync::Arc;` — add any that are missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p sf-schema evict_removes_one_object -- --nocapture`
Expected: FAIL — `no method named evict`.

- [ ] **Step 3: Implement `evict`**

Add to `impl SchemaStore` (right after `clear`):

```rust
    /// Drop one object's cached schema (memory + disk) so the next
    /// `get_or_fetch` re-describes it. Missing file is fine.
    pub fn evict(&mut self, api_version: &str, object: &str) -> Result<(), SfError> {
        self.mem.remove(&Self::key(api_version, object));
        let path = self.file_path(api_version, object);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(SfError::Spawn(e)),
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p sf-schema evict_removes_one_object`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/sf-schema/src/store.rs
git commit -m "feat(sf-schema): targeted SchemaStore::evict for one object"
```

---

### Task 2: Delta acquisition queries (`acquire::fetch_changed_*`)

**Files:**
- Modify: `crates/apex-lang/src/acquire.rs` (add after `fetch_apex_class`, ~line 114)
- Test: same file's `#[cfg(test)] mod tests`

**Interfaces:**
- Produces:
  - `pub async fn fetch_changed_apex_classes(invoker: &SfInvoker, org: &str, since: &str) -> Result<Vec<serde_json::Value>, SfError>` — `SELECT Name, SymbolTable FROM ApexClass WHERE LastModifiedDate > <since>`; returns the `records` array (feed to `parse_org_types`).
  - `pub async fn fetch_changed_entities(invoker: &SfInvoker, org: &str, since: &str) -> Result<Vec<String>, SfError>` — distinct `QualifiedApiName` from the union of EntityDefinition + CustomField tooling watermark queries.

- [ ] **Step 1: Write the failing test**

Add to `crates/apex-lang/src/acquire.rs` `tests` module:

```rust
#[tokio::test]
async fn fetch_changed_classes_filters_by_watermark() {
    use sf_core::runner::MockRunner;
    let inv = SfInvoker::new(std::sync::Arc::new(MockRunner::new(|_p, args| {
        let a = args.join(" ");
        assert!(a.contains("LastModifiedDate >"), "watermark clause missing: {a}");
        assert!(a.contains("2026-06-21T00:00:00Z"), "since not interpolated: {a}");
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","methods":[],"properties":[]}}],"totalSize":1,"done":true}}"#.into(),
            stderr: String::new(),
        })
    })));
    let recs = fetch_changed_apex_classes(&inv, "myorg", "2026-06-21T00:00:00Z")
        .await
        .unwrap();
    assert_eq!(recs.len(), 1);
}

#[tokio::test]
async fn fetch_changed_entities_unions_and_dedups() {
    use sf_core::runner::MockRunner;
    let inv = SfInvoker::new(std::sync::Arc::new(MockRunner::new(|_p, args| {
        let a = args.join(" ");
        let body = if a.contains("FROM EntityDefinition") {
            r#"{"status":0,"result":{"records":[{"QualifiedApiName":"Account"},{"QualifiedApiName":"My__c"}]}}"#
        } else {
            // CustomField: nested EntityDefinition.QualifiedApiName
            r#"{"status":0,"result":{"records":[{"EntityDefinition":{"QualifiedApiName":"My__c"}},{"EntityDefinition":{"QualifiedApiName":"Other__c"}}]}}"#
        };
        Ok(sf_core::RawOutput { status: 0, stdout: body.into(), stderr: String::new() })
    })));
    let mut names = fetch_changed_entities(&inv, "myorg", "2026-06-21T00:00:00Z")
        .await
        .unwrap();
    names.sort();
    assert_eq!(names, vec!["Account".to_string(), "My__c".to_string(), "Other__c".to_string()]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apex-lang fetch_changed -- --nocapture`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement the two functions**

Add after `fetch_apex_class` in `crates/apex-lang/src/acquire.rs`:

```rust
/// Apex classes modified since `since` (RFC3339 UTC), with full `SymbolTable`.
/// Feed the returned records to [`parse_org_types`].
pub async fn fetch_changed_apex_classes(
    invoker: &SfInvoker,
    org: &str,
    since: &str,
) -> Result<Vec<serde_json::Value>, SfError> {
    #[derive(Deserialize)]
    struct QueryEnvelope {
        records: Vec<serde_json::Value>,
    }
    // `since` is our own ISO8601 (machine-generated) — no SOQL-injection surface.
    let q = format!("SELECT Name, SymbolTable FROM ApexClass WHERE LastModifiedDate > {since}");
    let args = with_target(
        vec!["data", "query", "--query", &q, "--use-tooling-api"],
        org,
    );
    let env: QueryEnvelope = invoker.run_json(&args).await?;
    Ok(env.records)
}

/// Entities (objects) whose definition or any custom field changed since
/// `since`. Returns the distinct `QualifiedApiName` set (re-describe each).
pub async fn fetch_changed_entities(
    invoker: &SfInvoker,
    org: &str,
    since: &str,
) -> Result<Vec<String>, SfError> {
    #[derive(Deserialize)]
    struct EntityRec {
        #[serde(rename = "QualifiedApiName")]
        name: String,
    }
    #[derive(Deserialize)]
    struct EntityEnv {
        records: Vec<EntityRec>,
    }
    #[derive(Deserialize)]
    struct FieldParent {
        #[serde(rename = "QualifiedApiName")]
        name: String,
    }
    #[derive(Deserialize)]
    struct FieldRec {
        #[serde(rename = "EntityDefinition")]
        entity: Option<FieldParent>,
    }
    #[derive(Deserialize)]
    struct FieldEnv {
        records: Vec<FieldRec>,
    }

    let mut out = std::collections::BTreeSet::new();

    let eq = format!(
        "SELECT QualifiedApiName FROM EntityDefinition WHERE LastModifiedDate > {since}"
    );
    let env: EntityEnv = invoker
        .run_json(&with_target(
            vec!["data", "query", "--query", &eq, "--use-tooling-api"],
            org,
        ))
        .await?;
    out.extend(env.records.into_iter().map(|r| r.name));

    let fq = format!(
        "SELECT EntityDefinition.QualifiedApiName FROM CustomField WHERE LastModifiedDate > {since}"
    );
    let fenv: FieldEnv = invoker
        .run_json(&with_target(
            vec!["data", "query", "--query", &fq, "--use-tooling-api"],
            org,
        ))
        .await?;
    out.extend(fenv.records.into_iter().filter_map(|r| r.entity.map(|e| e.name)));

    Ok(out.into_iter().collect())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p apex-lang fetch_changed`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/apex-lang/src/acquire.rs
git commit -m "feat(apex-lang): delta acquisition queries (changed classes + entities)"
```

---

### Task 3: Delta orchestration (`features::index::sync_org`)

**Files:**
- Modify: `crates/features/src/index.rs` (add `SyncOutcome` + `sync_org` + helpers; new tests)

**Interfaces:**
- Consumes: `apex_lang::acquire::{fetch_changed_apex_classes, fetch_changed_entities, fetch_apex_class_names, parse_org_types}`, `apex_lang::{load_snapshot, save_snapshot, IndexManifest, Ost}`, `apex_lang::symbols::ApexType`, `sf_schema::SchemaStore::{new, evict, get_or_fetch}`, `crate::apex_complete::schema_to_apex_type`, `crate::soql::list_sobject_names`, `crate::api_version::api_version_for`, the existing `iso8601_utc` (file-local) and `now_iso8601`.
- Produces:
  - `pub struct SyncOutcome { pub added: usize, pub updated: usize, pub removed: usize }` with `pub fn changed(&self) -> bool`.
  - `pub async fn sync_org(invoker: &SfInvoker, root: PathBuf, org_id: &str) -> Result<(SyncOutcome, Ost), SfError>` — returns the patched OST (to install) and the counts. If no snapshot exists, returns `(SyncOutcome::default(), Ost::default())` with no work.

- [ ] **Step 1: Write the failing tests**

Add to `crates/features/src/index.rs` `tests` module (helpers `ok` already exist there):

```rust
    // Build a snapshot on disk for `org` with a known watermark + seeded OST.
    fn seed_snapshot(root: &std::path::Path, org: &str, api: &str, ost: &Ost) {
        let m = IndexManifest {
            org_id: org.into(),
            api_version: api.into(),
            indexed_at: "2026-01-01T00:00:00Z".into(),
            namespaces: ost.namespaces.len(),
            classes: 0,
            sobjects: 0,
        };
        apex_lang::save_snapshot(root, ost, &m).unwrap();
    }

    #[tokio::test]
    async fn sync_upserts_changed_class_and_advances_watermark() {
        let root = std::env::temp_dir().join(format!("sync-up-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![ApexType { name: "Foo".into(), ..Default::default() }],
        };
        seed_snapshot(&root, "myorg", "60.0", &seeded);

        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("FROM ApexClass") && a.contains("LastModifiedDate") {
                // Foo changed: now has a method `bar`.
                ok(r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","methods":[{"name":"bar","returnType":"void","parameters":[]}],"properties":[]}}]}}"#)
            } else if a.contains("FROM EntityDefinition") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("FROM CustomField") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"Foo"}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                ok(r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#)
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "myorg").await.unwrap();

        let foo = ost.org_types.iter().find(|t| t.name == "Foo").expect("Foo present");
        assert!(foo.methods.iter().any(|m| m.name == "bar"), "Foo upgraded with bar");
        assert_eq!(outcome.updated, 1, "Foo counted as updated");
        let (_, m) = apex_lang::load_snapshot(&root, "myorg", "60.0").unwrap();
        assert_ne!(m.indexed_at, "2026-01-01T00:00:00Z", "watermark advanced");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn sync_reconciles_deleted_type() {
        let root = std::env::temp_dir().join(format!("sync-del-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // Seed an OST with a class `Gone` that no longer exists in the org,
        // plus `Keeper` (still a class) and `Account` (still an sObject).
        // Reconcile runs because BOTH name lists are non-empty.
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![
                ApexType { name: "Keeper".into(), ..Default::default() },
                ApexType { name: "Account".into(), ..Default::default() },
                ApexType { name: "Gone".into(), ..Default::default() },
            ],
        };
        seed_snapshot(&root, "myorg", "60.0", &seeded);
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("LastModifiedDate") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"Keeper"}]}}"#) // Gone is absent
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                ok(r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#)
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "myorg").await.unwrap();
        assert!(ost.org_types.iter().any(|t| t.name == "Keeper"), "Keeper kept");
        assert!(ost.org_types.iter().any(|t| t.name == "Account"), "Account kept");
        assert!(!ost.org_types.iter().any(|t| t.name == "Gone"), "Gone removed");
        assert_eq!(outcome.removed, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn sync_skips_reconcile_when_namelist_empty() {
        // If the sObject list comes back empty (fetch failure), do NOT delete
        // sObject types — guards against wiping the index on a transient error.
        let root = std::env::temp_dir().join(format!("sync-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![ApexType { name: "Account".into(), ..Default::default() }],
        };
        seed_snapshot(&root, "myorg", "60.0", &seeded);
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("LastModifiedDate") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"SomeClass"}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":[]}"#) // empty → skip reconcile
            } else {
                ok(r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#)
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "myorg").await.unwrap();
        assert!(ost.org_types.iter().any(|t| t.name == "Account"), "Account NOT wiped");
        assert_eq!(outcome.removed, 0, "no reconcile on empty list");
        let _ = std::fs::remove_dir_all(&root);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p features --lib sync_ -- --nocapture`
Expected: FAIL — `sync_org` / `SyncOutcome` not found.

- [ ] **Step 3: Implement `SyncOutcome` + `sync_org`**

Add to `crates/features/src/index.rs` (after `index_org`). Add imports at the top: extend the `use apex_lang::acquire::{...}` line to include `fetch_apex_class_names, fetch_changed_apex_classes, fetch_changed_entities`.

```rust
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SyncOutcome {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
}

impl SyncOutcome {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

/// Insert `ty` into `types`, replacing any same-name (case-insensitive) entry.
/// Returns true when it replaced an existing type (an update), false on add.
fn upsert(types: &mut Vec<ApexType>, ty: ApexType) -> bool {
    if let Some(slot) = types.iter_mut().find(|t| t.name.eq_ignore_ascii_case(&ty.name)) {
        *slot = ty;
        true
    } else {
        types.push(ty);
        false
    }
}

/// Delta sync: patch the snapshot's OST with only what changed since its
/// watermark, persist, and return the patched OST + counts. No-op (zero
/// counts, default OST) when no snapshot exists.
pub async fn sync_org(
    invoker: &SfInvoker,
    root: PathBuf,
    org_id: &str,
) -> Result<(SyncOutcome, Ost), SfError> {
    let api = api_version_for(invoker, org_id).await;
    let Some((mut ost, manifest)) = apex_lang::load_snapshot(&root, org_id, &api) else {
        return Ok((SyncOutcome::default(), Ost::default()));
    };
    let since = manifest.indexed_at.clone();
    let started_at = now_iso8601();
    let mut outcome = SyncOutcome::default();

    // Changed Apex classes → upsert full SymbolTables.
    let class_records = fetch_changed_apex_classes(invoker, org_id, &since).await?;
    for ty in parse_org_types(&class_records) {
        if upsert(&mut ost.org_types, ty) {
            outcome.updated += 1;
        } else {
            outcome.added += 1;
        }
    }

    // Changed sObjects → evict stale describe, re-describe, upsert.
    let entities = fetch_changed_entities(invoker, org_id, &since).await?;
    let mut schema_store = SchemaStore::new(root.clone(), org_id);
    for name in entities {
        let _ = schema_store.evict(&api, &name);
        if let Ok(schema) = schema_store.get_or_fetch(invoker, &api, &name).await {
            if upsert(&mut ost.org_types, schema_to_apex_type(&schema)) {
                outcome.updated += 1;
            } else {
                outcome.added += 1;
            }
        }
    }

    // Deletion reconcile — only when BOTH name lists are non-empty (an empty
    // list means a failed fetch; never wipe the index on that).
    let class_names = fetch_apex_class_names(invoker, org_id).await.unwrap_or_default();
    let sobject_names = list_sobject_names(invoker, org_id).await;
    if !class_names.is_empty() && !sobject_names.is_empty() {
        let live: std::collections::HashSet<String> = class_names
            .iter()
            .chain(sobject_names.iter())
            .map(|n| n.to_ascii_lowercase())
            .collect();
        let before = ost.org_types.len();
        ost.org_types
            .retain(|t| live.contains(&t.name.to_ascii_lowercase()));
        outcome.removed = before - ost.org_types.len();
    }

    let manifest = IndexManifest {
        org_id: org_id.to_string(),
        api_version: api,
        indexed_at: started_at,
        namespaces: ost.namespaces.len(),
        classes: class_names.len(),
        sobjects: sobject_names.len(),
    };
    save_snapshot(&root, &ost, &manifest).map_err(SfError::Spawn)?;
    Ok((outcome, ost))
}
```

Note: all `IndexManifest` fields are set explicitly (no `..manifest` spread). `since` was cloned from `manifest.indexed_at` before this point, so `manifest` is not moved when constructing the new one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p features --lib sync_`
Expected: PASS (3 tests). Also run `cargo test -p features --lib index::` (the existing index tests still pass).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/index.rs
git commit -m "feat(features): sync_org delta index (upsert changed + reconcile deletes)"
```

---

### Task 4: Smart `index_org` entry + `sync-result` event

**Files:**
- Modify: `crates/features/src/lib.rs` (ensure `pub use`/module exposure of `SyncOutcome` if needed — `index` is already `pub mod`)
- Modify: `desktop/src-tauri/src/lib.rs` (rewrite `index_org`, add `SyncResultDto`)

**Interfaces:**
- Consumes: `features::index::sync_org`, `features::index::SyncOutcome`, `apex_lang::load_snapshot`, `features::apex_complete::default_index_root`.
- Produces: emits Tauri event `sync-result` with `SyncResultDto { org, added, updated, removed }`.

- [ ] **Step 1: Write the failing test (Rust compile gate)**

There is no unit harness for Tauri commands; the gate is `cargo check -p ultraforce-desktop-lib`. Add the DTO + rewrite first (Step 2), then this step is the check in Step 3. (No separate test file — the command is exercised by the Task 6 e2e + the `sync_org` unit tests.)

- [ ] **Step 2: Rewrite the `index_org` command + add the DTO**

In `desktop/src-tauri/src/lib.rs`, add near `IndexProgressDto`:

```rust
#[derive(Clone, serde::Serialize)]
struct SyncResultDto {
    org: String,
    added: usize,
    updated: usize,
    removed: usize,
}
```

Replace the whole `index_org` command body with:

```rust
#[tauri::command]
async fn index_org(org: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let root = features::apex_complete::default_index_root();
    let api = features::api_version::api_version_for(&state.invoker, &org).await;

    // Already indexed → install the snapshot instantly (completion ready), then
    // delta-sync in the same command and emit a result if anything changed.
    if let Some((ost, _)) = apex_lang::load_snapshot(&root, &org, &api) {
        state.apex.install_index(&org, ost);
        if let Ok((outcome, patched)) =
            features::index::sync_org(&state.invoker, root, &org).await
        {
            state.apex.install_index(&org, patched);
            if outcome.changed() {
                let _ = app.emit(
                    "sync-result",
                    SyncResultDto {
                        org: org.clone(),
                        added: outcome.added,
                        updated: outcome.updated,
                        removed: outcome.removed,
                    },
                );
            }
        }
        let names = features::soql::list_sobject_names(&state.invoker, &org).await;
        state.sobjects.lock().unwrap().insert(org.clone(), Arc::new(names));
        return Ok(());
    }

    // Not indexed → full first index (Phase-1 path).
    let mut on_progress = |p: features::index::IndexProgress| {
        let _ = app.emit(
            "index-progress",
            IndexProgressDto {
                org: org.clone(),
                phase: p.phase.to_string(),
                done: p.done,
                total: p.total,
            },
        );
    };
    let ost = features::index::index_org(&state.invoker, root, &org, &mut on_progress)
        .await
        .map_err(|e| e.to_string())?;
    state.apex.install_index(&org, ost);
    let names = features::soql::list_sobject_names(&state.invoker, &org).await;
    state.sobjects.lock().unwrap().insert(org.clone(), Arc::new(names));
    Ok(())
}
```

`reindex_org` stays unchanged (it clears the schema cache then calls `index_org`; with no snapshot after clear... note: `SchemaStore::clear` removes `<root>/<org>` which now ALSO holds the snapshot — so after `reindex_org`'s clear, `load_snapshot` returns None and the full path runs. Correct: reindex = full).

- [ ] **Step 3: Verify it compiles**

Run: `cd desktop/src-tauri && cargo check`
Expected: clean compile. Then `cargo clippy -p ultraforce-desktop-lib --all-targets -- -D warnings`.

- [ ] **Step 4: Run the workspace tests**

Run: `cargo test --workspace`
Expected: all pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs crates/features/src/lib.rs
git commit -m "feat(desktop): smart index_org entry — load snapshot + delta sync"
```

---

### Task 5: Frontend `sync-result` toast

**Files:**
- Create: `desktop/src/components/SyncToast.tsx`
- Modify: `desktop/src/App.tsx` (mount `<SyncToast />`)
- Test: `desktop/src/components/syncToast.test.ts` (pure label helper)

**Interfaces:**
- Consumes: Tauri `sync-result` event `{ org, added, updated, removed }`; `sonner` `toast`.
- Produces: `<SyncToast />` (renders null; shows a toast on each `sync-result`).

- [ ] **Step 1: Write the failing test (pure label)**

`desktop/src/components/syncToast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { syncLabel } from "./syncToast";

describe("syncLabel", () => {
  it("summarizes the change counts", () => {
    expect(syncLabel({ org: "o", added: 2, updated: 1, removed: 0 })).toBe(
      "Synced 3 updates",
    );
    expect(syncLabel({ org: "o", added: 0, updated: 1, removed: 0 })).toBe(
      "Synced 1 update",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop && npx vitest run syncToast`
Expected: FAIL — cannot find `./syncToast`.

- [ ] **Step 3: Implement the helper + component**

`desktop/src/components/syncToast.ts`:

```ts
export interface SyncResult {
  org: string;
  added: number;
  updated: number;
  removed: number;
}

/** "Synced N update(s)" — N = added + updated + removed. */
export function syncLabel(r: SyncResult): string {
  const n = r.added + r.updated + r.removed;
  return `Synced ${n} ${n === 1 ? "update" : "updates"}`;
}
```

`desktop/src/components/SyncToast.tsx`:

```tsx
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { syncLabel, type SyncResult } from "./syncToast";

/** Listens for backend `sync-result` events and shows a toast. Renders nothing. */
export function SyncToast() {
  useEffect(() => {
    const un = listen<SyncResult>("sync-result", (e) => {
      toast.success(syncLabel(e.payload));
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);
  return null;
}
```

Then in `desktop/src/App.tsx`, import and mount it next to `<Toaster />`:

```tsx
import { SyncToast } from "./components/SyncToast";
```

and inside the root JSX (just before `<Toaster ... />`):

```tsx
      <SyncToast />
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd desktop && npx vitest run syncToast && npx tsc --noEmit`
Expected: PASS + clean types.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/SyncToast.tsx desktop/src/components/syncToast.ts desktop/src/components/syncToast.test.ts desktop/src/App.tsx
git commit -m "feat(desktop): sync-result toast on delta index"
```

---

### Task 6: e2e — frontend toast + real-org delta

**Files:**
- Modify: `desktop/e2e/fixtures.ts` (no change needed if `__ufEmit` exists; confirm it does)
- Modify: `desktop/e2e/ultraforce.spec.ts` (add a `sync-result` toast spec)
- Modify: `crates/features/tests/real_org_e2e.rs` (add `e2e_sync_org_noop`)

**Interfaces:**
- Consumes: `window.__ufEmit("sync-result", {...})` (added in the progress-bar work); `features::index::sync_org`; `apex_lang::save_snapshot`/`IndexManifest`.

- [ ] **Step 1: Write the failing frontend spec**

Append to `desktop/e2e/ultraforce.spec.ts`:

```ts
test("sync-result event shows a toast", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() =>
    (window as unknown as { __ufEmit: (e: string, p: unknown) => void }).__ufEmit(
      "sync-result",
      { org: "x", added: 1, updated: 2, removed: 0 },
    ),
  );
  await expect(page.getByText("Synced 3 updates")).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop && pnpm exec playwright test -g "sync-result"`
Expected: FAIL (no toast) — because `<SyncToast />` must be mounted (Task 5) AND the spec is new. If Task 5 landed, it passes; run anyway to confirm the wire.

- [ ] **Step 3: Write the real-org delta e2e**

Append to `crates/features/tests/real_org_e2e.rs`:

```rust
/// Delta sync against a live org with a fresh watermark = no changes, fast,
/// and the manifest timestamp advances. Seeds a tiny snapshot first so the
/// sync has something to load (a full index would take minutes).
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_sync_org_noop() {
    use apex_lang::symbols::{ApexType, Ost};
    let inv = invoker();
    let o = org();
    let root = std::env::temp_dir().join(format!("uf-e2e-sync-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);

    let api = features::api_version::api_version_for(&inv, &o).await;
    // Seed a minimal snapshot containing one real sObject (survives reconcile)
    // and one fake type (reconciled away), watermark = far future so no class
    // shows as "changed".
    let seeded = Ost {
        namespaces: vec![],
        org_types: vec![
            ApexType { name: "Account".into(), ..Default::default() },
            ApexType { name: "ZzzNotARealType".into(), ..Default::default() },
        ],
    };
    let m = apex_lang::IndexManifest {
        org_id: o.clone(),
        api_version: api.clone(),
        indexed_at: "2999-01-01T00:00:00Z".into(),
        namespaces: 0,
        classes: 0,
        sobjects: 0,
    };
    apex_lang::save_snapshot(&root, &seeded, &m).unwrap();

    let (outcome, ost) = features::index::sync_org(&inv, root.clone(), &o)
        .await
        .expect("delta sync against live org");

    // Future watermark → zero changed classes/entities.
    assert_eq!(outcome.added, 0, "no adds with a future watermark");
    assert_eq!(outcome.updated, 0, "no updates with a future watermark");
    // Reconcile keeps the real object, drops the fake one.
    assert!(ost.org_types.iter().any(|t| t.name == "Account"), "Account kept");
    assert!(!ost.org_types.iter().any(|t| t.name == "ZzzNotARealType"), "fake removed");
    assert!(outcome.removed >= 1, "fake type reconciled away");

    let (_, m2) = apex_lang::load_snapshot(&root, &o, &api).unwrap();
    assert_ne!(m2.indexed_at, "2999-01-01T00:00:00Z", "watermark advanced");
    let _ = std::fs::remove_dir_all(&root);
}
```

- [ ] **Step 4: Verify**

Run (frontend): `cd desktop && pnpm exec playwright test` → all specs pass (8 + 1 new).
Run (compile e2e): `cargo test -p features --test real_org_e2e --no-run` → builds.
Run (real, manual): `cargo test -p features --test real_org_e2e e2e_sync_org_noop -- --ignored --test-threads=1 --nocapture` → 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/e2e/ultraforce.spec.ts crates/features/tests/real_org_e2e.rs
git commit -m "test: e2e for sync-result toast + real-org delta noop"
```

---

## Final verification

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd desktop && npx tsc --noEmit && pnpm build && npx vitest run && pnpm exec playwright test
```

All must be green. The real-org `e2e_sync_org_noop` is `#[ignore]`; run it manually once to confirm the live delta path.
