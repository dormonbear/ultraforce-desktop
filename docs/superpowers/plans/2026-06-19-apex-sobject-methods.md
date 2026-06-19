# apex-sobject-methods: synthesize sObject instance methods — Implementation Plan

> A described sObject becomes an OST `ApexType` with field PROPERTIES only. Apex sObjects also have
> built-in instance methods (`getSObjectType()`, `put()`, `get()`, `addError()`, …). Add a small curated
> set so `acct.put(...)`/`acct.getSObjectType()` complete and future diagnostics stop false-flagging
> them. Change in `features::apex_complete::schema_to_apex_type`. Completion-only / benign.

## Goal

`schema_to_apex_type(schema)` currently emits only field/relationship properties. Append a fixed list of
the common Apex SObject instance methods so member completion on an sObject receiver includes them.

## Scope (MVP) / YAGNI

- IN: a curated constant list of common SObject instance methods, appended to every described sObject's
  `methods`. Return types are best-effort strings (resolvable ones point at real OST types).
- OUT: the full SObject method surface; static `SObjectType`/`DescribeSObjectResult` method graphs;
  field-name-typed `get(SObjectField)` overloads.

## Global Constraints

- Rust 2021. No lock across `.await` (this fn is sync). No new crates. TDD. Gates:
  `cargo test -p features`, `cargo clippy --workspace -- -D warnings`, `cargo fmt --check`
  (exit-code-checked — [[sf-toolkit-fmt-gate]]). English; conventional commits. No branch
  creation/switch; NEVER `git push`.

## Pre-verified facts

- `crates/features/src/apex_complete.rs` has `fn schema_to_apex_type(schema: &SObjectSchema) -> ApexType`
  building `properties` from `schema.fields` (+ relationship props), then returning
  `ApexType { name, kind: TypeKind::Class, methods: Vec::new(), properties, enum_values: Vec::new() }`.
- `apex_lang::symbols::{Method}` is in scope via the existing `use apex_lang::symbols::{ApexType, Ost,
  Property, TypeKind}` line — add `Method` to it. `Method { name, return_type, params: Vec<String>,
  is_static }`.
- Tests in this file build an `ApexCompleter`, script a describe via `MockRunner`, and assert candidates.
  `schema_to_apex_type` is a private fn — a direct unit test on it is simplest.

---

### Task 1: append curated SObject instance methods (RED first)

**Files:** `crates/features/src/apex_complete.rs`.

- [ ] **Step 1: failing test** — add to the tests module (direct call on the private fn):
  ```rust
  #[test]
  fn schema_to_apex_type_includes_sobject_instance_methods() {
      let schema: SObjectSchema = serde_json::from_str(
          r#"{"name":"Account","fields":[{"name":"Name","type":"string"}]}"#,
      )
      .unwrap();
      let ty = schema_to_apex_type(&schema);
      assert!(ty.properties.iter().any(|p| p.name == "Name"), "fields kept");
      assert!(ty.methods.iter().any(|m| m.name == "getSObjectType"));
      assert!(ty.methods.iter().any(|m| m.name == "put"));
      assert!(ty.methods.iter().any(|m| m.name == "get"));
      assert!(ty.methods.iter().all(|m| !m.is_static), "instance methods");
  }
  ```
  (If `SObjectSchema` does not deserialize from that minimal JSON, mirror the exact field shape used by
  the existing describe-mock tests in this file instead — keep the three method assertions.)

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — add a constant table and append it in `schema_to_apex_type`:
  ```rust
  /// Common Apex SObject instance methods (name, return type). Curated subset — not exhaustive.
  /// ponytail: extend the list if a needed builtin is missing; not worth modelling the full surface.
  const SOBJECT_METHODS: &[(&str, &str)] = &[
      ("get", "Object"),
      ("put", "Object"),
      ("getSObjectType", "Schema.SObjectType"),
      ("getSObject", "SObject"),
      ("getSObjects", "List<SObject>"),
      ("getPopulatedFieldsAsMap", "Map<String,Object>"),
      ("getErrors", "List<Database.Error>"),
      ("hasErrors", "Boolean"),
      ("isClone", "Boolean"),
      ("addError", "void"),
      ("clone", "SObject"),
  ];
  ```
  In `schema_to_apex_type`, build the methods vec before the return:
  ```rust
  let methods = SOBJECT_METHODS
      .iter()
      .map(|(name, ret)| Method {
          name: (*name).to_string(),
          return_type: (*ret).to_string(),
          params: Vec::new(),
          is_static: false,
      })
      .collect();
  ```
  and return `ApexType { name: schema.name.clone(), kind: TypeKind::Class, methods, properties,
  enum_values: Vec::new() }` (replace the `methods: Vec::new()`).

- [ ] **Step 4: run → green**; then `cargo test -p features && cargo clippy --workspace -- -D warnings
  && cargo fmt --check`.
- [ ] **Step 5: commit** `feat(features): synthesize common SObject instance methods`

---

## Self-Review

- **Benign:** purely additive to completion candidates on described sObjects; field properties unchanged.
- **Return types:** point at real OST types where they exist (`Schema.SObjectType`, collections) so
  chained completion (`acct.getPopulatedFieldsAsMap().get(...)`) can compose with generic unwrapping.
- **Limits:** curated subset; no overloads; no static-side method graphs.

## When finished, print

```
cargo test -p features
cargo clippy --workspace -- -D warnings
cargo fmt --check
git log --oneline <BASE_SHA>..HEAD
```
