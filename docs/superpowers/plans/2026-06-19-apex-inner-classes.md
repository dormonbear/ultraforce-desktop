# apex-inner-classes: parse Apex inner classes into the OST — Implementation Plan

> Apex `SymbolTable.innerClasses[]` are currently dropped, so an inner type (`class Outer { class Row {…} }`,
> referenced as `Row r;`) is unknown to the OST. Parse them (recursively) into `org_types`. This both
> completes members on inner-class receivers AND removes a major false-positive source for future
> diagnostics ("unknown type" on a perfectly valid inner type). Pure `apex-lang` change. Benign.

## Goal

`parse_org_types` reads only each ApexClass's top-level `methods`/`properties`. Extend it to also emit
every (recursively nested) inner class as its own `ApexType`, named by its simple `name`. Inner-class
members are parsed by the exact same `parse_org_methods`/`parse_org_properties` already used for the
outer type.

## Scope (MVP) / YAGNI

- IN: `SymbolTable.innerClasses[]`, recursively. Each inner class → one `ApexType { name = its `name` }`.
- OUT: qualified `Outer.Inner` resolution (we register the simple name only — `resolve_type` is exact
  simple-name match); `interfaces`/`parentClass` inheritance flattening; enums/`enum_values`. Noted as
  ceilings, not done here.

## Global Constraints

- Rust 2021. `apex-lang` pure. No new crates. TDD. Gates: `cargo test -p apex-lang`,
  `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` (exit-code-checked —
  [[sf-toolkit-fmt-gate]]). English; conventional commits. No branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `crates/apex-lang/src/acquire.rs`:
  - `pub fn parse_org_types(records: &[serde_json::Value]) -> Vec<ApexType>` — per record reads
    `record["SymbolTable"]`, name from `symbol_table["name"]` falling back to `record["Name"]`, then
    `parse_org_methods(symbol_table)` + `parse_org_properties(symbol_table)`.
  - `fn parse_org_methods(symbol_table: &Value) -> Vec<Method>` and
    `fn parse_org_properties(symbol_table: &Value) -> Vec<Property>` read `symbol_table["methods"]` /
    `["properties"]`. An inner class object has the SAME shape (its own `methods`/`properties` arrays),
    so these helpers apply unchanged to an inner-class value.
- Test module (bottom of acquire.rs) has `const APEX_CLASS: &str =
  include_str!("../tests/fixtures/apexclass_symboltable.json");` and a test
  `parse_org_types_maps_symbol_table_records` that does
  `let records = …["result"]["records"]…; let types = parse_org_types(records);` then asserts on
  `types`. Adding an inner class to the fixture changes `types.len()` (1 → 2) — that test's existing
  assertions MUST be updated to stay green.
- Fixture today: one record `AccountService` whose `SymbolTable.innerClasses` is `[]`. Real SF
  inner-class entries carry a simple `name`, plus `methods`/`properties`/`innerClasses`/`constructors`/
  `interfaces` arrays of the same shape as the outer table.

---

### Task 1: recursive inner-class collection (RED first)

**Files:** `crates/apex-lang/src/acquire.rs`, `crates/apex-lang/tests/fixtures/apexclass_symboltable.json`.

- [ ] **Step 1: extend the fixture** — set `AccountService.SymbolTable.innerClasses` to:
  ```json
  "innerClasses": [
    {
      "name": "LineItem",
      "tableDeclaration": { "name": "LineItem" },
      "constructors": [],
      "interfaces": [],
      "innerClasses": [],
      "variables": [],
      "methods": [
        {
          "name": "total",
          "returnType": "Decimal",
          "modifiers": [],
          "parameters": [],
          "annotations": [],
          "references": []
        }
      ],
      "properties": [
        {
          "name": "quantity",
          "type": "Integer",
          "modifiers": ["public"],
          "annotations": [],
          "references": []
        }
      ]
    }
  ],
  ```
  (Leave the rest of the fixture intact.)

- [ ] **Step 2: failing test** — replace/extend `parse_org_types_maps_symbol_table_records` so it asserts
  BOTH the outer and the inner type, e.g.:
  ```rust
  let by_name = |n: &str| types.iter().find(|t| t.name == n);
  let outer = by_name("AccountService").expect("outer");
  assert!(outer.methods.iter().any(|m| m.name == "save"));
  let inner = by_name("LineItem").expect("inner class");
  assert!(inner.methods.iter().any(|m| m.name == "total"));
  assert!(inner.properties.iter().any(|p| p.name == "quantity"));
  ```
  (Keep any other existing assertions in that test that still hold; update a hardcoded
  `assert_eq!(types.len(), 1)`-style check to `2` if present.)

- [ ] **Step 3: run → fail** (`LineItem` not found).

- [ ] **Step 4: implement** — refactor `parse_org_types` to a recursive collector:
  ```rust
  pub fn parse_org_types(records: &[serde_json::Value]) -> Vec<ApexType> {
      let mut out = Vec::new();
      for record in records {
          let Some(symbol_table) = record.get("SymbolTable") else {
              continue;
          };
          let fallback = record.get("Name").and_then(Value::as_str);
          collect_symbol_table_types(symbol_table, fallback, &mut out);
      }
      out
  }

  /// Append the type described by `symbol_table` plus all of its (recursively nested) inner classes.
  /// ponytail: inner classes register under their simple `name` only; qualified `Outer.Inner`
  /// references are not resolved (extend resolve_type if that's ever needed).
  fn collect_symbol_table_types(
      symbol_table: &Value,
      name_fallback: Option<&str>,
      out: &mut Vec<ApexType>,
  ) {
      if let Some(name) = symbol_table
          .get("name")
          .and_then(Value::as_str)
          .or(name_fallback)
      {
          out.push(ApexType {
              name: name.to_string(),
              kind: TypeKind::Class,
              methods: parse_org_methods(symbol_table),
              properties: parse_org_properties(symbol_table),
              enum_values: Vec::new(),
          });
      }
      if let Some(inner) = symbol_table.get("innerClasses").and_then(Value::as_array) {
          for ic in inner {
              collect_symbol_table_types(ic, None, out);
          }
      }
  }
  ```

- [ ] **Step 5: run → green**; then `cargo test -p apex-lang && cargo clippy --workspace -- -D warnings
  && cargo fmt --check`.
- [ ] **Step 6: commit** `feat(apex-lang): parse Apex inner classes into the OST`

---

## Self-Review

- **Reuse:** inner classes go through the identical `parse_org_methods`/`parse_org_properties`, so
  member shape is guaranteed consistent with outer types.
- **Diagnostics-paving:** inner types now exist in the OST, eliminating a large class of would-be
  "unknown type" false positives.
- **Limits:** simple-name registration (collisions across files: last-wins / both present — benign for
  completion); no inheritance/interface flattening; enums not parsed.

## When finished, print

```
cargo test -p apex-lang
cargo clippy --workspace -- -D warnings
cargo fmt --check
git log --oneline <BASE_SHA>..HEAD
```
