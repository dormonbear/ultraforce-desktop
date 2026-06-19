# features::soql (SP-B thin slice) — design

> Date: 2026-06-18 · Status: Approved · Crate: `crates/features` (module `soql`) · Depends on: sf-core

## Purpose

The second feature vertical slice: execute a SOQL string and turn the result
into a typed `QueryResult` plus a flat table model for display. No UI. No
schema-aware editing yet (that is SP-E). Mirrors SP-A's shape: a thin
`sf`-orchestration + pure projection, MockRunner unit tests + a gated e2e.

Scope decision (2026-06-18): thin slice (same policy as SP-D). **Deferred**:
the tree/nested view rendering (a UI concern for SP-G; the typed `QueryResult`
already preserves nesting so the tree derives from it later), Tooling API
(`-t`), `--all-rows`, and bulk export for huge result sets. `sf data query`
handles `queryMore` internally (design §4), so pagination is out of scope.

## Verified `sf` API shape (pre-checked against staging, sf 2.127)

`sf data query -q "<soql>" --json` → `result` is
`{ totalSize: int, done: bool, records: [ Record ] }` where each `Record` is:

- `attributes`: `{ type: String, url: String }` (always present).
- scalar field → JSON scalar, e.g. `"Name": "Acme"` or `null`.
- **parent relationship** (e.g. `Owner.Name`) → a nested object
  `{ attributes, <fields…> }`, or `null` when the lookup is empty.
- **child subquery** (e.g. `(SELECT … FROM Contacts)`) → a nested
  `{ totalSize, done, records: [...] }`, or `null` when there are no children.

Canonical fixture: `crates/features/tests/fixtures/query_accounts.json` (2 rows:
scalars Id/Name, parent `Owner.Name` + a null Owner, child `Contacts` + a null
Contacts).

## Model

```rust
pub struct QueryResult {
    pub total_size: u64,
    pub done: bool,
    pub records: Vec<Record>,
}
pub struct Record {
    pub sobject_type: String,            // attributes.type
    pub fields: Vec<(String, FieldValue)>, // insertion order preserved
}
pub enum FieldValue {
    Null,
    Scalar(serde_json::Value),           // string/number/bool
    Parent(Box<Record>),                 // parent relationship object
    Children(QueryResult),               // child subquery
}
```

`attributes` is consumed into `sobject_type`; the `url` is dropped (not needed
for display). Field order is preserved (serde_json `preserve_order` or parse via
`serde_json::Map` which keeps order with the `preserve_order` feature — see
plan).

## Table model (flat projection)

```rust
pub struct TableModel { pub columns: Vec<String>, pub rows: Vec<Vec<String>> }
impl QueryResult { pub fn to_table(&self) -> TableModel; }
```

Column derivation (no SOQL parsing — that is SP-E):

- Walk records; the column set is the **union of leaf paths across all records**
  (so a null in row 1 still yields the column from row 2), in first-seen order.
- A scalar field `F` → column `"F"`; cell = the scalar rendered as text (`""`
  for `Null`).
- A parent field `P` (object) → recurse with dotted prefix: leaves become
  `"P.Name"`, `"P.Owner.Name"`, etc. A null parent contributes nothing on that
  row (its columns, discovered from other rows, render `""`).
- A child subquery field `C` → a single column `"C"`; cell = the child count
  as text (e.g. `"1"`, `"0"` for an empty subquery, `""` for null). The nested
  rows are NOT flattened into the parent table (they live in `QueryResult` for a
  later tree view).

## Surface

```rust
// execute a SOQL query
pub async fn run_query(invoker: &SfInvoker, soql: &str) -> Result<QueryResult, SfError>;
// run_query then project
pub async fn run_query_table(invoker: &SfInvoker, soql: &str) -> Result<TableModel, SfError>;
impl QueryResult { pub fn from_json(result: &serde_json::Value) -> QueryResult; } // pure
```

`from_json` is pure (the parse/projection seam, unit-testable without `sf`).
`run_query` = `sf data query -q <soql>` then `from_json` on the envelope result.

## Decisions

1. **Typed `FieldValue` enum over raw JSON.** Distinguishes scalar / parent /
   child so both the flat table now and a tree later read one model. Detection:
   a JSON object with a `records` key → `Children`; an object with `attributes`
   but no `records` → `Parent`; null → `Null`; else `Scalar`.
2. **Flat table = scalars + dotted parent leaves + subquery counts.** Child rows
   are not exploded into the parent grid (that is the tree view, deferred).
3. **Union-of-rows columns** so nullable parent/subquery fields still get a
   column. First-seen order; no SOQL SELECT parsing (SP-E owns that).
4. **`sf data query` only.** No `-t`, no `--all-rows`, no bulk export, no manual
   queryMore — single call, sf handles continuation (design §4).

## Testing

- **Unit (pure `from_json` / `to_table`):** load
  `tests/fixtures/query_accounts.json`'s `result`; assert `total_size == 2`,
  `records.len() == 2`, record 0 has a `Parent(Owner)` whose `Name` is
  `Scalar("Alice")` and a `Children(Contacts)` with `total_size == 1`, record 1
  has `Owner == Null` and `Contacts == Null`. `to_table` columns ==
  `["Id","Name","Owner.Name","Contacts"]`; row 0 == `["001A","Acme","Alice","1"]`,
  row 1 == `["001B","Globex","",""]`.
- **Integration (MockRunner):** `run_query` against the full fixture envelope
  string; assert the runner saw `["data","query","-q",<soql>,"--json"]` and the
  parsed `QueryResult` matches.
- **e2e (gated, `#[ignore]`):** real `sf` against staging:
  `run_query(invoker, "SELECT Id, Name FROM Account LIMIT 1")` → assert
  `records.len() == 1` and the first record has a non-empty `Name` (or Id).
  Run with `cargo test -p features --test soql_e2e -- --ignored` as the
  post-stage verification (standing rule: e2e after the stage is merged).
