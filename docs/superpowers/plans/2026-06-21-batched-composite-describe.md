# Batched Composite Describe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe sObjects in batches of 25 via the Salesforce Composite REST API so a full offline index spawns `N/25` `sf` processes instead of `N`, cutting the ~926s managed-package first-index dramatically.

**Architecture:** Add pure composite request/response helpers + a `describe_objects` batch fetch to `sf-schema/puller.rs`; add `SchemaStore::get_or_fetch_many` that cache-partitions names and describes the misses in waves of up to 4 concurrent composite calls (25 objects each), persisting each result. Route `index_org` and `sync_org` through it. No frontend changes.

**Tech Stack:** Rust (tokio already a normal dep of sf-schema), `sf api request rest --method POST --body`, serde_json.

## Global Constraints

- Verification gate per stage: `cargo fmt --check` (exit-checked), `cargo clippy --all-targets -D warnings`, `cargo test` — all green.
- Real-org e2e uses the `ultraforce` dev org alias (`UF_E2E_ORG`, default `ultraforce`). **NEVER target `vivabiotech` (production).**
- `sf api request rest` is a beta command that rejects `--json`; parse raw stdout (use `run_raw_with_timeout`). Verified flags: `--method POST`, `--body "<inline json>"`, `--target-org`.
- The runner passes args directly to the process (no shell), so the inline JSON body needs no shell escaping.
- Composite REST hard limit: 25 subrequests per call.
- DRY, YAGNI, TDD, frequent commits.

---

### Task 1: Composite request/response helpers + batch describe

**Files:**
- Modify: `crates/sf-schema/src/puller.rs` (add helpers + `describe_objects`; keep existing `describe_object`)

**Interfaces:**
- Consumes: `SObjectSchema` (`crate::model`), `SfInvoker` / `SfError` (`sf_core`), `SfInvoker::run_raw_with_timeout`.
- Produces:
  - `build_composite_request(api_version: &str, names: &[String]) -> serde_json::Value`
  - `parse_composite_response(raw: &str) -> Vec<SObjectSchema>`
  - `describe_objects(invoker: &SfInvoker, org: &str, api_version: &str, names: &[String]) -> Result<Vec<SObjectSchema>, SfError>`

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block in `crates/sf-schema/src/puller.rs`:

```rust
    #[test]
    fn builds_composite_subrequests_with_describe_urls() {
        let names = vec!["Account".to_string(), "Contact".to_string()];
        let req = build_composite_request("60.0", &names);
        let subs = req["compositeRequest"].as_array().unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0]["method"], "GET");
        assert_eq!(
            subs[0]["url"],
            "/services/data/v60.0/sobjects/Account/describe"
        );
        assert_eq!(subs[0]["referenceId"], "r0");
        assert_eq!(subs[1]["referenceId"], "r1");
    }

    #[test]
    fn parses_only_ok_subresponses() {
        let raw = r#"{"compositeResponse":[
            {"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}},
            {"httpStatusCode":404,"referenceId":"r1","body":{"errorCode":"NOT_FOUND"}}
        ]}"#;
        let schemas = parse_composite_response(raw);
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].name, "Account");
    }

    #[test]
    fn parse_composite_response_tolerates_garbage() {
        assert!(parse_composite_response("not json").is_empty());
    }

    #[tokio::test]
    async fn describe_objects_sends_one_composite_post_with_target_org() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |_program, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}}]}"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let schemas = describe_objects(&invoker, "myorg", "60.0", &["Account".to_string()])
            .await
            .unwrap();

        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].name, "Account");
        let args = seen.lock().unwrap().clone();
        assert!(args.contains(&"composite".to_string()) || args.iter().any(|a| a.contains("composite")));
        assert!(args.contains(&"--method".to_string()));
        assert!(args.contains(&"POST".to_string()));
        assert!(args.contains(&"--target-org".to_string()));
        assert!(args.contains(&"myorg".to_string()));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p sf-schema puller 2>&1 | tail -20`
Expected: FAIL — `cannot find function build_composite_request` etc.

- [ ] **Step 3: Implement the helpers**

At the top of `crates/sf-schema/src/puller.rs`, extend the imports and add a `Duration` use:

```rust
//! Pulls object describes from the live org via sf-core.

use crate::model::SObjectSchema;
use sf_core::{SfError, SfInvoker};
use std::time::Duration;
```

Keep the existing `describe_object` function as-is. Add below it:

```rust
/// Salesforce composite hard limit: max subrequests per call.
const COMPOSITE_MAX: usize = 25;
/// Composite describes are larger than a single describe; give them headroom.
const DESCRIBE_BATCH_TIMEOUT: Duration = Duration::from_secs(180);

/// Append `--target-org <org>` unless `org` is empty or the "default" sentinel.
fn with_target<'a>(mut args: Vec<&'a str>, org: &'a str) -> Vec<&'a str> {
    if !org.is_empty() && org != "default" {
        args.push("--target-org");
        args.push(org);
    }
    args
}

/// Build a composite request describing each name via a GET subrequest.
pub fn build_composite_request(api_version: &str, names: &[String]) -> serde_json::Value {
    let subrequests: Vec<serde_json::Value> = names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            serde_json::json!({
                "method": "GET",
                "url": format!("/services/data/v{api_version}/sobjects/{name}/describe"),
                "referenceId": format!("r{i}"),
            })
        })
        .collect();
    serde_json::json!({ "compositeRequest": subrequests })
}

/// Parse a composite response, keeping only `httpStatusCode == 200` bodies.
/// Each describe body carries its own `name`, so no referenceId remap is needed.
pub fn parse_composite_response(raw: &str) -> Vec<SObjectSchema> {
    #[derive(serde::Deserialize)]
    struct Envelope {
        #[serde(default, rename = "compositeResponse")]
        composite_response: Vec<SubResponse>,
    }
    #[derive(serde::Deserialize)]
    struct SubResponse {
        #[serde(default, rename = "httpStatusCode")]
        http_status_code: u16,
        #[serde(default)]
        body: Option<serde_json::Value>,
    }
    let env: Envelope = match serde_json::from_str(raw) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    env.composite_response
        .into_iter()
        .filter(|r| r.http_status_code == 200)
        .filter_map(|r| r.body)
        .filter_map(|b| serde_json::from_value::<SObjectSchema>(b).ok())
        .collect()
}

/// Describe up to `COMPOSITE_MAX` objects in one composite call (caller chunks).
/// Pinned to `org`. Returns successfully-described schemas; failures are dropped.
pub async fn describe_objects(
    invoker: &SfInvoker,
    org: &str,
    api_version: &str,
    names: &[String],
) -> Result<Vec<SObjectSchema>, SfError> {
    debug_assert!(names.len() <= COMPOSITE_MAX);
    let url = format!("/services/data/v{api_version}/composite");
    let body = build_composite_request(api_version, names).to_string();
    let args = with_target(
        vec![
            "api", "request", "rest", &url, "--method", "POST", "--body", &body,
        ],
        org,
    );
    let out = invoker
        .run_raw_with_timeout(&args, DESCRIBE_BATCH_TIMEOUT)
        .await?;
    Ok(parse_composite_response(&out.stdout))
}
```

The existing test module imports (`use super::*;`, `MockRunner`, `Arc`, `Mutex`) already cover the new tests; the `parse`/`build` tests need none beyond `super::*`.

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p sf-schema puller 2>&1 | tail -20`
Expected: PASS (all puller tests, including the prior `describe_object_parses_envelope_and_passes_args`).

- [ ] **Step 5: Commit**

```bash
git add crates/sf-schema/src/puller.rs
git commit -m "feat(sf-schema): composite-REST batch describe primitive"
```

---

### Task 2: `SchemaStore::get_or_fetch_many`

**Files:**
- Modify: `crates/sf-schema/src/store.rs` (add method + tests)

**Interfaces:**
- Consumes: `crate::puller::describe_objects`, the store's private `persist`, `mem`, `org_id`, `Self::key`, `load_disk`, `get`.
- Produces: `SchemaStore::get_or_fetch_many(&mut self, invoker: &SfInvoker, api_version: &str, names: &[String], on_progress: &mut dyn FnMut(usize, usize)) -> Vec<(String, SObjectSchema)>`

- [ ] **Step 1: Write failing test**

Add to the `tests` module in `crates/sf-schema/src/store.rs` (it already has `counting_invoker`, `unique_root`, `API`, `FIXTURE`). Note `counting_invoker` returns the Account describe fixture for ANY call, so make the runner also answer composite calls. Add a composite-aware invoker helper and the test:

```rust
    fn composite_counting_invoker() -> (SfInvoker, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        // Any composite call returns one Account subresponse; counts each call.
        let runner = MockRunner::new(move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[],"childRelationships":[]}}]}"#.to_string(),
                stderr: String::new(),
            })
        });
        (SfInvoker::new(Arc::new(runner)), calls)
    }

    #[tokio::test]
    async fn get_or_fetch_many_describes_misses_and_skips_cached() {
        let root = unique_root();
        let (invoker, calls) = composite_counting_invoker();
        let mut store = SchemaStore::new(&root, "00Dorg");

        // First call: Account is a miss → one composite call, persisted.
        let mut seen = 0usize;
        let out = store
            .get_or_fetch_many(&invoker, API, &["Account".to_string()], &mut |done, total| {
                seen = total;
                let _ = done;
            })
            .await;
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "Account");
        assert_eq!(seen, 1, "progress total reflects requested names");
        assert_eq!(calls.load(Ordering::SeqCst), 1, "one composite call");
        assert!(root.join("00Dorg/60.0/Account.json").exists(), "persisted");

        // Second call: Account now cached in memory → no further composite call.
        let out2 = store
            .get_or_fetch_many(&invoker, API, &["Account".to_string()], &mut |_, _| {})
            .await;
        assert_eq!(out2.len(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1, "served from cache");
        std::fs::remove_dir_all(&root).ok();
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p sf-schema get_or_fetch_many 2>&1 | tail -20`
Expected: FAIL — `no method named get_or_fetch_many`.

- [ ] **Step 3: Implement the method**

In `crates/sf-schema/src/store.rs`, inside `impl SchemaStore`, add after `get_or_fetch`:

```rust
    /// Batch variant: describe the cache-miss `names` via the Composite REST
    /// API (25 per call, up to 4 calls concurrently), persist each, and return
    /// every `(name, schema)` (cached + freshly described). `on_progress` is
    /// called with `(done, total)` after the initial cache scan and after each
    /// completed composite call. Objects that fail to describe are dropped.
    pub async fn get_or_fetch_many(
        &mut self,
        invoker: &SfInvoker,
        api_version: &str,
        names: &[String],
        on_progress: &mut dyn FnMut(usize, usize),
    ) -> Vec<(String, SObjectSchema)> {
        let total = names.len();
        let mut out: Vec<(String, SObjectSchema)> = Vec::new();
        let mut missing: Vec<String> = Vec::new();

        for name in names {
            if let Some(s) = self.get(api_version, name) {
                out.push((name.clone(), s.clone()));
            } else if let Ok(Some(s)) = self.load_disk(api_version, name) {
                out.push((name.clone(), s));
            } else {
                missing.push(name.clone());
            }
        }
        let mut done = out.len();
        on_progress(done, total);

        // Describe misses in waves of COMPOSITE_CONCURRENCY composite calls,
        // each describing up to COMPOSITE_MAX objects.
        const COMPOSITE_MAX: usize = 25;
        const COMPOSITE_CONCURRENCY: usize = 4;
        let wave = COMPOSITE_MAX * COMPOSITE_CONCURRENCY;
        for super_chunk in missing.chunks(wave) {
            let mut set: tokio::task::JoinSet<(usize, Vec<SObjectSchema>)> =
                tokio::task::JoinSet::new();
            for batch in super_chunk.chunks(COMPOSITE_MAX) {
                let invoker = invoker.clone();
                let org = self.org_id.clone();
                let api = api_version.to_string();
                let batch = batch.to_vec();
                set.spawn(async move {
                    let attempted = batch.len();
                    let schemas = crate::puller::describe_objects(&invoker, &org, &api, &batch)
                        .await
                        .unwrap_or_default();
                    (attempted, schemas)
                });
            }
            while let Some(res) = set.join_next().await {
                let (attempted, schemas) = res.unwrap_or_default();
                for schema in schemas {
                    let name = schema.name.clone();
                    let _ = self.persist(api_version, &name, &schema);
                    self.mem
                        .insert(Self::key(api_version, &name), schema.clone());
                    out.push((name, schema));
                }
                done += attempted;
                on_progress(done, total);
            }
        }
        out
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p sf-schema 2>&1 | tail -20`
Expected: PASS (new test + all existing store/puller tests).

- [ ] **Step 5: Commit**

```bash
git add crates/sf-schema/src/store.rs
git commit -m "feat(sf-schema): SchemaStore::get_or_fetch_many batched describe"
```

---

### Task 3: Route `index_org` through the batch describe

**Files:**
- Modify: `crates/features/src/index.rs` (replace the per-object describe loop; update the `index_assembles_*` test mock)

**Interfaces:**
- Consumes: `SchemaStore::get_or_fetch_many` (Task 2), `schema_to_apex_type`, `IndexProgress`.

- [ ] **Step 1: Update the test mock to answer composite calls**

In `crates/features/src/index.rs`, in `index_assembles_classes_and_sobjects_and_persists`, the mock's final `else` returns a single `sobject describe` envelope that the batched path no longer calls. Add a composite branch before the final `else`:

```rust
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else if a.contains("composite") {
                ok(
                    r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[{"name":"Name","type":"string","relationshipName":null,"referenceTo":[]}],"childRelationships":[]}}]}"#,
                )
            } else {
                ok(
                    r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string","relationshipName":null,"referenceTo":[]}],"childRelationships":[]}}"#,
                )
            }
```

- [ ] **Step 2: Run to verify the test still passes pre-change (mock-only edit)**

Run: `cargo test -p features index_assembles 2>&1 | tail -15`
Expected: PASS (the new branch is unused until Step 3, so the test is unchanged behaviorally).

- [ ] **Step 3: Replace the describe loop in `index_org`**

In `index_org`, replace this block (from `let names = list_sobject_names(...)` through the end of the `for chunk in names.chunks(DESCRIBE_CONCURRENCY)` loop):

```rust
    let names = list_sobject_names(invoker, org_id).await;
    let total = names.len();
    let mut sobjects = 0;
    let mut done = 0;
    // Describe sObjects up to DESCRIBE_CONCURRENCY at a time: serial describes
    // (one `sf` call each) make a large org's first index take many minutes.
    // Each task gets its own SchemaStore (disk cache is the shared truth; per
    // object → distinct files, so concurrent writes never collide).
    for chunk in names.chunks(DESCRIBE_CONCURRENCY) {
        let mut set: tokio::task::JoinSet<Option<ApexType>> = tokio::task::JoinSet::new();
        for name in chunk {
            let invoker = invoker.clone();
            let api = api.clone();
            let root = root.clone();
            let org = org_id.to_string();
            let name = name.clone();
            set.spawn(async move {
                let mut store = SchemaStore::new(root, &org);
                store
                    .get_or_fetch(&invoker, &api, &name)
                    .await
                    .ok()
                    .map(|s| schema_to_apex_type(&s))
            });
        }
        while let Some(res) = set.join_next().await {
            done += 1;
            if let Ok(Some(ty)) = res {
                org_types.push(ty);
                sobjects += 1;
            }
            on_progress(IndexProgress {
                phase: "sobjects",
                done,
                total,
            });
        }
    }
```

with:

```rust
    let names = list_sobject_names(invoker, org_id).await;
    let total = names.len();
    // Describe all sObjects via batched Composite REST (25 per call, up to 4
    // calls concurrently) instead of one `sf` process per object — the latter
    // made a managed-package org's first index take ~15 min.
    let mut store = SchemaStore::new(root.clone(), org_id);
    let described = store
        .get_or_fetch_many(invoker, &api, &names, &mut |done, _total| {
            on_progress(IndexProgress {
                phase: "sobjects",
                done,
                total,
            });
        })
        .await;
    let mut sobjects = 0;
    for (_name, schema) in &described {
        org_types.push(schema_to_apex_type(schema));
        sobjects += 1;
    }
```

Then remove the now-unused imports: delete `use apex_lang::symbols::ApexType;` **only if** `ApexType` is unused elsewhere in the file — it is still used in `upsert`'s signature and the test module, so KEEP it. `DESCRIBE_CONCURRENCY` const becomes unused — delete its declaration:

```rust
/// Max sObject describes in flight during indexing (bounds wall time without
/// hammering the org).
const DESCRIBE_CONCURRENCY: usize = 8;
```

- [ ] **Step 4: Run to verify pass + lint**

Run: `cargo test -p features 2>&1 | tail -20 && cargo clippy -p features --all-targets 2>&1 | tail -8`
Expected: tests PASS; clippy clean (no unused-import / dead-code warning for `DESCRIBE_CONCURRENCY`).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/index.rs
git commit -m "feat(features): index_org uses batched composite describe"
```

---

### Task 4: Route `sync_org` through the batch describe

**Files:**
- Modify: `crates/features/src/index.rs` (replace the changed-entity describe loop; add a sync test)

**Interfaces:**
- Consumes: `SchemaStore::get_or_fetch_many`, `SchemaStore::invalidate`, `upsert`, `schema_to_apex_type`.

- [ ] **Step 1: Write failing test**

Add to the `tests` module in `crates/features/src/index.rs`:

```rust
    #[tokio::test]
    async fn sync_describes_changed_entity_via_composite() {
        let root = std::env::temp_dir().join(format!("sync-comp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Account".into(),
                ..Default::default()
            }],
        };
        seed_snapshot(&root, "uorg_comp", "60.0", &seeded);
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("FROM ApexClass") && a.contains("LastModifiedDate") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("FROM EntityDefinition") {
                ok(r#"{"status":0,"result":{"records":[{"QualifiedApiName":"Account"}]}}"#)
            } else if a.contains("FROM CustomField") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("composite") {
                ok(
                    r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[{"name":"Name","type":"string","relationshipName":null,"referenceTo":[]}],"childRelationships":[]}}]}"#,
                )
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"Foo"}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "uorg_comp").await.unwrap();

        let account = ost
            .org_types
            .iter()
            .find(|t| t.name == "Account")
            .expect("Account present");
        assert!(
            account.properties.iter().any(|p| p.name == "Name"),
            "Account re-described with Name field"
        );
        assert_eq!(outcome.updated, 1, "Account counted as updated");
        let _ = std::fs::remove_dir_all(&root);
    }
```

Confirmed: `schema_to_apex_type` (`crates/features/src/apex_complete.rs:288`) maps each describe field onto `ApexType.properties` as a `Property { name, .. }`, so the `Name` field surfaces as `properties` entry `name == "Name"`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p features sync_describes_changed_entity_via_composite 2>&1 | tail -20`
Expected: FAIL — the current serial loop describes via single `sobject describe` (the `else` branch returns `{"records":[]}` here, not a describe), so Account gains no `Name`; assertion fails.

- [ ] **Step 3: Replace the changed-entity loop in `sync_org`**

In `sync_org`, replace:

```rust
    // Changed sObjects → evict stale describe, re-describe, upsert.
    let entities = fetch_changed_entities(invoker, org_id, &since).await?;
    let mut schema_store = SchemaStore::new(root.clone(), org_id);
    for name in entities {
        let _ = schema_store.invalidate(&api, &name);
        if let Ok(schema) = schema_store.get_or_fetch(invoker, &api, &name).await {
            if upsert(&mut ost.org_types, schema_to_apex_type(&schema)) {
                outcome.updated += 1;
            } else {
                outcome.added += 1;
            }
        }
    }
```

with:

```rust
    // Changed sObjects → evict stale describes, then batch re-describe + upsert.
    let entities = fetch_changed_entities(invoker, org_id, &since).await?;
    let mut schema_store = SchemaStore::new(root.clone(), org_id);
    for name in &entities {
        let _ = schema_store.invalidate(&api, name);
    }
    let described = schema_store
        .get_or_fetch_many(invoker, &api, &entities, &mut |_, _| {})
        .await;
    for (_name, schema) in &described {
        if upsert(&mut ost.org_types, schema_to_apex_type(schema)) {
            outcome.updated += 1;
        } else {
            outcome.added += 1;
        }
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p features 2>&1 | tail -20`
Expected: PASS — all `index.rs` tests including the new composite-sync test and the existing `sync_upserts_*` / `sync_reconciles_*` / `sync_skips_*` tests.

- [ ] **Step 5: Workspace verification gate + commit**

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8 && cargo test 2>&1 | tail -15
git add crates/features/src/index.rs
git commit -m "feat(features): sync_org uses batched composite describe"
```

Expected: fmt clean (no output), clippy clean, all tests pass.

---

### Task 5: Real-org wall-time verification

**Files:** none (verification + memory note only).

- [ ] **Step 1: Run the offline-index e2e against the dev org and time it**

Run:
```bash
UF_E2E_ORG=ultraforce cargo test -p features --test real_org_e2e e2e_index_org_offline -- --ignored --test-threads=1 2>&1 | tail -25
```
Expected: PASS. Record the wall time (cargo prints `test ... ok` with elapsed; also note the total `finished in Xs`). Compare against the 926s baseline — the headline result is a large drop (target: minutes → well under).

- [ ] **Step 2: Run the no-op sync e2e to confirm the delta path still works**

Run:
```bash
UF_E2E_ORG=ultraforce cargo test -p features --test real_org_e2e e2e_sync_org_noop -- --ignored --test-threads=1 2>&1 | tail -15
```
Expected: PASS.

- [ ] **Step 3: Update build-state memory with the new first-index wall time**

Edit `/Users/dormonzhou/.claude/projects/-Users-dormonzhou-Projects-sf-query-execute-debug/memory/sf-toolkit-build-state.md`: append a note that batched composite describe shipped and record the measured first-index wall time vs the 926s baseline.

- [ ] **Step 4: Commit any plan/doc check-the-box updates**

```bash
git add docs/superpowers/plans/2026-06-21-batched-composite-describe.md
git commit -m "docs: mark batched composite describe plan complete"
```

---

## Self-Review

- **Spec coverage:** pure helpers + `describe_objects` (Task 1) ✓; `get_or_fetch_many` cache-partition + concurrent waves + persist + progress (Task 2) ✓; `index_org` wiring (Task 3) ✓; `sync_org` wiring with invalidate-then-batch (Task 4) ✓; real-org wall-time verification (Task 5) ✓; error handling (drop failed batch / skip non-200) covered by `unwrap_or_default` + `parse_composite_response` filter ✓; `with_target` pins org ✓; on-demand single describe untouched ✓; no frontend changes ✓.
- **Type consistency:** `get_or_fetch_many(&mut self, &SfInvoker, &str, &[String], &mut dyn FnMut(usize, usize)) -> Vec<(String, SObjectSchema)>` used identically in Tasks 2/3/4. `describe_objects(&SfInvoker, &str, &str, &[String]) -> Result<Vec<SObjectSchema>, SfError>` consistent. `COMPOSITE_MAX = 25` defined in both puller (for `describe_objects` guard) and store (for chunking) — intentional, each module owns its constant.
- **Resolved:** `schema_to_apex_type` maps sObject fields onto `ApexType.properties` (`apex_complete.rs:288`), so the Task 4 `.properties` assertion is correct.
