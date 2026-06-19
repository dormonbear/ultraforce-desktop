# apex-lang: sObject types in the OST (on-demand describe) — Implementation Plan

> Adds the deferred third OST source: sObject types via `sf-schema` describe, fetched ON DEMAND when
> the cursor needs members of a type not already in the OST. Makes `Account.`, custom objects, and
> their fields complete in the desktop Apex editor. Unblocks future unknown-type diagnostics.
> Completion-only / benign. apex-lang gains a pure `needed_type_at` helper; `features::apex_complete`
> does the async describe + OST augmentation. No Tauri/React change (the command already calls complete).

## Goal

The OST holds stdlib (completions) + org Apex classes, but NO sObjects. So `Account a; a.|` and
`Account.|` complete nothing. Add: detect the type name the cursor needs, and if it is absent from the
OST, describe it via `sf-schema` (disk-cached), map the schema → an `ApexType`, inject it, then complete.

## Scope (MVP) / YAGNI

- IN: ensure-describe for the DIRECT receiver type at the cursor — `StaticMember{type_name}` and
  `InstanceMember{receiver}` (a local's declared type, else the receiver as a type name). sObject FIELDS
  become instance `Property`s; reference fields also add a relationship `Property` (e.g. `AccountId` →
  also `Account` → the parent sObject) so later chains can reach parents.
- OUT (later): describing intermediate types inside a `ChainMember` chain (chains needing an undescribed
  sObject mid-way still return nothing); sObject methods (`getSObjectType`, etc.); namespaced types
  (`Schema.X`); diagnostics (separate, now unblocked).

## Global Constraints

- Rust 2021. apex-lang stays pure (no IO); the describe + cache lives in `features::apex_complete`.
- No lock held across `.await` (same invariant as the existing ApexCompleter). No new external crates.
- TDD per task. `cargo test -p apex-lang`, `cargo test -p features`, `cargo clippy --workspace -- -D warnings`,
  `cargo fmt --check` all clean. English; conventional commits; no author attribution. No branch/push.

## Pre-verified facts

- `apex_lang::parser::{outline(input)->ApexOutline{locals:Vec<LocalVar{name,declared_type}>},
  context_at(input,cursor)->CursorContext}`; `CursorContext::{TopLevel, StaticMember{type_name,prefix},
  InstanceMember{receiver,prefix}, ChainMember{chain,prefix}, Unknown}`. `apex_lang::complete` re-exports
  `complete`; `apex_lang::resolve::resolve_type(&Ost,&str)->Option<&ApexType>` is pub.
- `apex_lang::symbols::{Ost{namespaces,org_types}, ApexType{name,kind,methods,properties,enum_values},
  Property{name,prop_type,is_static}, TypeKind::Class}` — all Clone+Default, pub fields.
- `sf_schema::{SchemaStore, SObjectSchema, model::Field}`. `SchemaStore::new(root,org_id)`,
  `default_root()`, `async get_or_fetch(&mut self,&SfInvoker,api_version,object)->Result<SObjectSchema,SfError>`
  (returns OWNED — do NOT `.clone()` the result). `SObjectSchema{name, fields:Vec<Field>, ...}`;
  `Field{name, field_type (serde "type"), reference_to:Vec<String>, relationship_name:Option<String>, ...}`.
- `features/Cargo.toml` deps: `apex-lang`, `sf-core`, `serde`, `serde_json`; dev-deps `sf-core{test-util}`,
  `tokio`. It does NOT yet depend on `sf-schema` directly — add it.
- `crates/features/src/apex_complete.rs` `ApexCompleter { root: PathBuf, cache: Mutex<Option<(String, Arc<Ost>)>> }`
  with `new`, `with_default_root`, `cached(org_id)->Option<Arc<Ost>>`, `complete(invoker,org_id,src,cursor)`,
  `build(invoker,org_id)->Result<Ost,SfError>` (uses OstStore; get_or_fetch returns owned Value).

---

### Task 1: apex-lang `needed_type_at` (pure) (RED first)

**Files:** modify `crates/apex-lang/src/parser.rs` (add fn) + `crates/apex-lang/src/lib.rs` (re-export).

- [ ] **Step 1: failing test** — add to parser.rs tests:
  ```rust
  #[test]
  fn needed_type_at_returns_receiver_or_static_type() {
      // local's declared type
      let s = "Account a; a.na";
      assert_eq!(needed_type_at(s, s.len()).as_deref(), Some("Account"));
      // static / type receiver
      let t = "String.va";
      assert_eq!(needed_type_at(t, t.len()).as_deref(), Some("String"));
      // top-level prefix → nothing to describe
      assert_eq!(needed_type_at("Acc", 3), None);
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** in parser.rs:
  ```rust
  /// The type name whose members the cursor wants, if any — for ensure-describe in the wiring layer.
  /// `StaticMember` → the type; `InstanceMember` → the local's declared type, else the receiver as a
  /// type name. `TopLevel`/`ChainMember`/`Unknown` → None (chains are resolved post-describe later).
  pub fn needed_type_at(input: &str, cursor: usize) -> Option<String> {
      let o = outline(input);
      match context_at(input, cursor) {
          CursorContext::StaticMember { type_name, .. } => Some(type_name),
          CursorContext::InstanceMember { receiver, .. } => Some(
              o.locals
                  .iter()
                  .find(|l| l.name.eq_ignore_ascii_case(&receiver))
                  .map(|l| l.declared_type.clone())
                  .unwrap_or(receiver),
          ),
          _ => None,
      }
  }
  ```
  And in lib.rs add: `pub use parser::needed_type_at;`

- [ ] **Step 4: run → green**; clippy + fmt clean (whole workspace clippy must stay green).
- [ ] **Step 5: commit** `feat(apex-lang): expose needed_type_at for on-demand type acquisition`

---

### Task 2: features — sObject describe → ApexType, OST augmentation (RED first)

**Files:** modify `crates/features/Cargo.toml` (+`sf-schema`), `crates/features/src/apex_complete.rs`.

- [ ] **Step 1: dep** — add to `crates/features/Cargo.toml` `[dependencies]`:
  `sf-schema = { path = "../sf-schema" }`.

- [ ] **Step 2: failing test** — add a test to apex_complete.rs that scripts stdlib + org-types + a
  describe response for `Account`, then asserts a field completes. Use a sequencing MockRunner:
  ```rust
  #[tokio::test]
  async fn completes_sobject_field_via_on_demand_describe() {
      use std::sync::Mutex as StdMutex;
      // Sequenced responses keyed by call order: stdlib (api request rest, raw), org-types (data query),
      // then sObject describe (sf-schema's `sobject describe`/`data ...` — match by the object name token).
      let responses: Arc<StdMutex<Vec<&'static str>>> = Arc::new(StdMutex::new(vec![
          r#"{"publicDeclarations":{"System":{}}}"#,                       // stdlib (no types needed here)
          r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#, // org ApexClass
          r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string"},{"name":"AccountId","type":"reference","referenceTo":["Account"],"relationshipName":"Parent"}]}}"#, // describe Account
      ]));
      let runner = MockRunner::new(move |_p, _args| {
          let mut r = responses.lock().unwrap();
          let body = if r.is_empty() { "{}" } else { r.remove(0) };
          Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
      });
      let invoker = sf_core::SfInvoker::new(Arc::new(runner));
      let dir = std::env::temp_dir().join(format!("apex-sobj-test-{}", std::process::id()));
      let completer = ApexCompleter::new(dir.clone());

      let input = "Account a; a.Na";
      let got = completer.complete(&invoker, "myorg", input, input.len()).await.unwrap();
      assert!(got.iter().any(|c| c.label == "Name"), "{got:?}");

      let _ = std::fs::remove_dir_all(&dir);
  }
  ```
  > NOTE: the describe response shape must match what `sf_schema::SObjectSchema` deserializes (it reads
  > `name` + `fields[].{name,type,referenceTo,relationshipName}`). If `SchemaStore::get_or_fetch` issues
  > a specific `sf` subcommand, the MockRunner above ignores args and just returns the next scripted body
  > in call order — keep the order stdlib → org-types → describe. Adjust the order only if the real call
  > sequence differs; verify by reading the failing assertion.

- [ ] **Step 3: run → fail.**

- [ ] **Step 4: implement** in apex_complete.rs:
  - Imports: `use sf_schema::{SchemaStore, SObjectSchema};` and `use apex_lang::symbols::{ApexType, Property, TypeKind};` and `use apex_lang::resolve::resolve_type;`.
  - Map a describe to an ApexType:
    ```rust
    /// Salesforce describe `field.type` → the Apex type name used in completion.
    fn apex_field_type(f: &sf_schema::model::Field) -> String {
        match f.field_type.as_str() {
            "id" => "Id",
            "boolean" => "Boolean",
            "int" => "Integer",
            "double" | "currency" | "percent" => "Decimal",
            "date" => "Date",
            "datetime" => "Datetime",
            "time" => "Time",
            "base64" => "Blob",
            "reference" => return f.reference_to.first().cloned().unwrap_or_else(|| "Id".into()),
            // string, textarea, phone, url, email, picklist, multipicklist, encryptedstring, combobox, …
            _ => "String",
        }
        .to_string()
    }

    /// Map an sObject describe to an OST ApexType: fields → instance properties (+ relationship props).
    fn schema_to_apex_type(schema: &SObjectSchema) -> ApexType {
        let mut properties = Vec::new();
        for f in &schema.fields {
            properties.push(Property {
                name: f.name.clone(),
                prop_type: apex_field_type(f),
                is_static: false,
            });
            if let (Some(rel), Some(parent)) = (f.relationship_name.clone(), f.reference_to.first()) {
                properties.push(Property { name: rel, prop_type: parent.clone(), is_static: false });
            }
        }
        ApexType {
            name: schema.name.clone(),
            kind: TypeKind::Class,
            methods: Vec::new(),
            properties,
            enum_values: Vec::new(),
        }
    }
    ```
  - Refactor: extract `ensure_base(&self, invoker, org_id) -> Result<Arc<Ost>, SfError>` (cached() → else build → store Arc → return). Rewrite `complete`:
    ```rust
    pub async fn complete(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        src: &str,
        cursor: usize,
    ) -> Result<Vec<Candidate>, SfError> {
        let ost = self.ensure_base(invoker, org_id).await?;
        // On-demand sObject describe: if the cursor needs a type the OST lacks, try describing it.
        if let Some(type_name) = apex_lang::needed_type_at(src, cursor) {
            if resolve_type(&ost, &type_name).is_none() {
                if let Some(apex_ty) = self.describe_sobject(invoker, org_id, &type_name).await {
                    let augmented = self.augment(org_id, apex_ty);
                    return Ok(ost_complete(src, cursor, &augmented));
                }
            }
        }
        Ok(ost_complete(src, cursor, &ost))
    }

    /// Best-effort describe (None if the name is not a real sObject or describe fails — benign).
    async fn describe_sobject(&self, invoker: &SfInvoker, org_id: &str, name: &str) -> Option<ApexType> {
        let mut store = SchemaStore::new(self.root.clone(), org_id);
        store.get_or_fetch(invoker, API_VERSION, name).await.ok().map(|s| schema_to_apex_type(&s))
    }

    /// Insert `ty` into the cached OST's org_types (dedupe by name); returns the new Arc. Lock not held
    /// across any await (this fn is sync).
    fn augment(&self, org_id: &str, ty: ApexType) -> Arc<Ost> {
        let mut guard = self.cache.lock().unwrap();
        let mut ost = match &*guard {
            Some((id, ost)) if id == org_id => (**ost).clone(),
            _ => Ost::default(),
        };
        if !ost.org_types.iter().any(|t| t.name.eq_ignore_ascii_case(&ty.name)) {
            ost.org_types.push(ty);
        }
        let arc = Arc::new(ost);
        *guard = Some((org_id.to_string(), arc.clone()));
        arc
    }
    ```
  - Add `ensure_base` (the old cached/build logic):
    ```rust
    async fn ensure_base(&self, invoker: &SfInvoker, org_id: &str) -> Result<Arc<Ost>, SfError> {
        if let Some(ost) = self.cached(org_id) {
            return Ok(ost);
        }
        let ost = Arc::new(self.build(invoker, org_id).await?);
        *self.cache.lock().unwrap() = Some((org_id.to_string(), ost.clone()));
        Ok(ost)
    }
    ```
    (Keep `build`, `cached`, `new`, `with_default_root` as-is.)

  > Caching note: `augment` clones the OST only on a describe MISS (first time each sObject is seen),
  > not per keystroke — after augmentation the type resolves in `ensure_base`'s cached OST on the next
  > call, so repeat completions for the same sObject take the fast path. The existing
  > `completes_stdlib_type_and_caches` test must still pass unchanged.

- [ ] **Step 5: run → green**; `cargo test -p features && cargo clippy --workspace -- -D warnings && cargo fmt --check`.
- [ ] **Step 6: commit** `feat(features): on-demand sObject describe into the apex OST`

---

## Self-Review

- **Spec coverage:** pure `needed_type_at` (T1); sObject describe → ApexType mapping + on-demand OST
  augmentation in the wiring layer (T2). Desktop unchanged — `apex_complete` command picks it up.
- **Perf:** base OST cached per org; sObject describe disk-cached (SchemaStore) + injected once; OST clone
  happens only on a describe miss (first reference of a given sObject), never per keystroke.
- **Benign:** describe failures (typo'd/unknown receiver) → `None` → fall through to base completion;
  never errors the editor. No lock held across `.await`.
- **Unblocks:** unknown-type diagnostics become viable later once sObjects can enter the OST this way.
- **Known limits:** sObjects inside a `ChainMember` chain aren't auto-described yet; no sObject methods;
  no namespaced (`Schema.*`) types; field-type map is coarse (picklist→String, etc.).
