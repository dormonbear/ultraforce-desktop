# SP-B features::soql (thin slice) Implementation Plan

> Date: 2026-06-18 · Crate: `crates/features` (module `soql`) · Depends on: sf-core
> Spec: specs/2026-06-18-features-soql-design.md

Implements the SOQL execution slice: run a query → typed `QueryResult` → flat
table model. TDD throughout. Mirrors SP-A (MockRunner unit tests + gated e2e).

## Global Constraints

- New code lives in `crates/features` (existing crate); add `pub mod soql;` to
  its `lib.rs`. No new crate, no new external deps (NO `indexmap`,
  NO `serde_json/preserve_order`).
- Reuse `sf_core::{SfInvoker, SfError}` and `sf_core::runner::MockRunner`
  (features already dev-deps sf-core with `test-util` — confirm; if not, add it).
- `run_json` appends `--json` itself; call it.
- Canonical fixture already exists: `crates/features/tests/fixtures/query_accounts.json`
  (full envelope; `result` has 2 records: scalars Id/Name, parent `Owner.Name`
  + a null Owner, child `Contacts` + a null Contacts).
- **Top-level field order MUST match the query** (drives table columns). serde's
  streaming `MapAccess` yields entries in source order — use a custom
  `Deserialize` for `Record` (see Task 3). Do NOT route records through
  `serde_json::Value` for the top level (its Map is sorted without
  `preserve_order`).
- Every task RED→GREEN; `cargo test -p features` after each; `cargo test
  --workspace` at the end. clippy `-D warnings` + `cargo fmt -p features --check`
  must pass. Do NOT run `#[ignore]` e2e in the normal suite.

### Task 1: Scaffold the soql module

- `crates/features/src/soql.rs` with `pub mod soql;` wired in `lib.rs`.
- Confirm `crates/features/Cargo.toml` dev-deps include
  `sf-core = { path = "../sf-core", features = ["test-util"] }` and
  `serde_json`; add `serde` (derive) to `[dependencies]` if missing.
- Verify: `cargo build -p features`.
- Commit: `chore(features): scaffold soql module`

### Task 2: model types

```rust
pub struct QueryResult { pub total_size: u64, pub done: bool, pub records: Vec<Record> }
pub struct Record { pub sobject_type: String, pub fields: Vec<(String, FieldValue)> }
pub enum FieldValue { Null, Scalar(serde_json::Value), Parent(Box<Record>), Children(QueryResult) }
pub struct TableModel { pub columns: Vec<String>, pub rows: Vec<Vec<String>> }
```
Derive `Debug, Clone, PartialEq`. No deserialize derive yet (Task 3).
Commit: `feat(features): soql query result + table model types`

### Task 3: ordered parsing — QueryResult::from_json + Record Deserialize

- `QueryResult`: `#[derive(Deserialize)]` with `#[serde(rename_all = "camelCase")]`
  (totalSize→total_size) and `done`, `records: Vec<Record>`.
- **Custom `impl<'de> Deserialize<'de> for Record`** via a `Visitor::visit_map`:
  loop `map.next_entry::<String, serde_json::Value>()` (keys arrive in source
  order). For each `(key, value)`:
  - `key == "attributes"` → read `value["type"]` into `sobject_type`.
  - else push `(key, classify(value))` into `fields`.
- `fn classify(v: serde_json::Value) -> FieldValue`:
  - `Value::Null` → `Null`
  - `Value::Object` containing key `"records"` → `Children(serde_json::from_value::<QueryResult>(v)?)`
  - `Value::Object` containing key `"attributes"` (and no `records`) →
    `Parent(Box::new(serde_json::from_value::<Record>(v)?))`
  - else → `Scalar(v)`
  - `// ponytail: a Parent's *nested* field order falls back to serde_json's
    default (sorted) since the value goes through Value; top-level/query order is
    preserved. Upgrade to preserve_order when SP-E needs deep nested order.`
- `pub fn from_json(result: &serde_json::Value) -> Result<QueryResult, serde_json::Error>`
  = `serde_json::from_value(result.clone())` (or borrow via `Deserialize`).

**Test (RED first):** load the fixture file, take `["result"]`, `from_json` it;
assert `total_size == 2`, `records.len() == 2`; record0 `sobject_type ==
"Account"`, its `fields` keys in order `["Id","Name","Owner","Contacts"]`,
`Owner` is `Parent` whose inner field `Name` is `Scalar("Alice")`, `Contacts` is
`Children` with `total_size == 1`; record1 `Owner == Null` and `Contacts == Null`.
Commit: `feat(features): parse SOQL results preserving query field order`

### Task 4: to_table projection

`impl QueryResult { pub fn to_table(&self) -> TableModel }`:
- Compute columns = union of leaf paths across all records, first-seen order:
  - walk each record's `fields` in order; scalar/null leaf `F` → column `"F"`;
    `Parent` → recurse with prefix `"F."` producing dotted leaves; `Children`
    → a single column `"F"` (the subquery column).
- Rows: for each record, for each column, render the cell:
  - scalar → its text (`Value::String` without quotes; numbers/bools via
    `to_string`); `Null`/missing → `""`.
  - dotted parent leaf → walk into the parent; `""` if the parent is null/missing.
  - subquery column → child `total_size` as text; `""` if the field is `Null`.

**Test:** on the fixture model, `to_table().columns ==
["Id","Name","Owner.Name","Contacts"]`; rows == `[["001A","Acme","Alice","1"],
["001B","Globex","",""]]`.
Commit: `feat(features): flat table projection for SOQL results`

### Task 5: run_query + run_query_table

```rust
pub async fn run_query(invoker: &SfInvoker, soql: &str) -> Result<QueryResult, SfError>;
pub async fn run_query_table(invoker: &SfInvoker, soql: &str) -> Result<TableModel, SfError>;
```
`run_query` = `invoker.run_json::<serde_json::Value>(&["data","query","-q",soql])`
then `from_json` (map a serde error into `SfError::Parse`). Note `run_json`
returns the envelope's `result` already, so deserialize that into `QueryResult`
directly — prefer `invoker.run_json::<QueryResult>(&["data","query","-q",soql])`
if the custom Deserialize composes cleanly; otherwise go through `Value`.

**Test (MockRunner):** runner returns the fixture envelope string; assert args
seen are `["data","query","-q",<soql>,"--json"]` and the parsed `QueryResult`
matches Task 3; `run_query_table` columns match Task 4.
Commit: `feat(features): execute SOQL via sf data query`

### Task 6: gated e2e

`crates/features/tests/soql_e2e.rs`, `#[ignore = "hits the live org; run with
--ignored"]`, `#[tokio::test]`: real `SfInvoker::new(Arc::new(ProcessRunner))`,
`run_query(&invoker, "SELECT Id, Name FROM Account LIMIT 1")` → assert
`records.len() == 1` and record0 has a `Name` or `Id` field with a non-empty
scalar.
Commit: `test(features): add gated e2e for SOQL query against staging`

## Self-Review

- [ ] No new external deps (no indexmap / preserve_order).
- [ ] Top-level field order preserved via custom `Record` Deserialize (visit_map).
- [ ] `FieldValue` classifies null / scalar / parent / child correctly.
- [ ] `to_table`: union columns, dotted parent leaves, subquery = count.
- [ ] Unit tests use the fixture + MockRunner; e2e is `#[ignore]`.
- [ ] `cargo test --workspace` + clippy `-D warnings` + fmt all green.
