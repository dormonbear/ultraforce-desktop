# sf-schema (SP-D thin slice) — design

> Date: 2026-06-18 · Status: Approved · Crate: `crates/sf-schema` · Depends on: sf-core

## Purpose

The schema engine that later powers SOQL/Apex completion & validation (the reference plugin
"精华"). This **thin first slice** does on-demand single-object describe →
trimmed model → disk + in-memory cache → basic query. No UI. No bulk
describe-all. It is the on-disk schema source that SP-E (SOQL completion) will
read.

Scope decision (2026-06-18): thin slice, mirroring the SP-A pattern. **Deferred**
to later SP-D slices: `describeGlobal` (`sobject list`) caching, multi-hop
relationship-path resolution (`Account.Owner.Name`), tooling objects (`-t`),
incremental/background refresh, REST composite batch-describe speedup.

## Verified `sf` API shapes (pre-checked against staging, sf 2.127)

- `sf sobject describe -s <obj> --json` → `result` is the describe object:
  - top-level: `name`, `label`, `labelPlural`, `keyPrefix`, `queryable`,
    `custom`, `customSetting`, `fields[]`, `childRelationships[]` (+ many unused).
  - `fields[]` (Account: 1053): each has `name`, `label`, `type`,
    `referenceTo` (array of strings), `relationshipName` (string|null),
    `picklistValues[]`, `nillable`, `createable`, `updateable`, `length`,
    `precision`, `scale` (+ many unused).
  - `picklistValues[]`: `{ value, label, active, defaultValue, validFor }`.
  - `childRelationships[]` (Account: 554): `{ childSObject, field, relationshipName }`.
- `sf sobject list --json` → `result` is a flat array of ~4914 object-name
  strings. **(verified but deferred — not used in this slice.)**

> Account describe ≈ 1053 fields; full describe-all over 4914 objects is slow
> and large → on-demand single-object only. Cache so each object is described
> at most once per (org, apiVersion).

## Crate layout

```
crates/sf-schema/
├── src/
│   ├── lib.rs        # re-exports
│   ├── model.rs      # SObjectSchema / Field / PicklistValue / ChildRelationship (serde)
│   ├── puller.rs     # describe one object via sf-core SfInvoker
│   ├── store.rs      # disk (JSON) + in-memory cache, keyed by (org, apiVersion, obj)
│   └── query.rs      # lookups over a cached SObjectSchema
└── Cargo.toml        # deps: sf-core, serde, serde_json, tokio; dev: sf-core/test-util
```

Dependency direction: `sf-schema → sf-core` only (design §3, single-direction).

## Model (trimmed — store only what completion/validation needs)

```rust
pub struct SObjectSchema {
    pub name: String,
    pub label: String,
    pub label_plural: String,
    pub key_prefix: Option<String>,
    pub queryable: bool,
    pub custom: bool,
    pub fields: Vec<Field>,
    pub child_relationships: Vec<ChildRelationship>,
}
pub struct Field {
    pub name: String,
    pub label: String,
    pub field_type: String,            // serde rename "type"
    pub reference_to: Vec<String>,     // [] unless reference
    pub relationship_name: Option<String>,
    pub picklist_values: Vec<PicklistValue>,
    pub nillable: bool,
    pub createable: bool,
    pub updateable: bool,
    pub length: i64,
}
pub struct PicklistValue { pub value: String, pub label: String, pub active: bool, pub default_value: bool }
pub struct ChildRelationship { pub child_sobject: String, pub field: String, pub relationship_name: Option<String> }
```

The describe JSON carries dozens of unused keys; `#[serde(default)]` + only the
fields above are deserialized (serde ignores unknown keys by default). `field_type`
uses `#[serde(rename = "type")]`.

## Surface

```rust
// puller: describe one object on demand (sf sobject describe -s <obj>)
pub async fn describe_object(invoker: &SfInvoker, object: &str) -> Result<SObjectSchema, SfError>;

// store: cache keyed by (org_id, api_version, object_name)
pub struct SchemaStore { /* cache_root: PathBuf, mem: HashMap<Key, SObjectSchema> */ }
impl SchemaStore {
    pub fn new(cache_root: PathBuf, org_id: String, api_version: String) -> Self;
    pub fn default_root() -> PathBuf;                  // <os cache dir>/sf-toolkit
    pub fn get(&self, object: &str) -> Option<&SObjectSchema>;          // mem only
    pub fn load_disk(&mut self, object: &str) -> std::io::Result<Option<&SObjectSchema>>; // disk→mem
    pub async fn get_or_fetch(&mut self, invoker: &SfInvoker, object: &str)
        -> Result<&SObjectSchema, SfError>;            // mem → disk → describe+persist
    pub fn invalidate(&mut self, object: &str);        // drop mem + delete disk file (refresh)
}

// query: lookups over a SObjectSchema
impl SObjectSchema {
    pub fn field(&self, name: &str) -> Option<&Field>;            // case-insensitive
    pub fn picklist_values(&self, field: &str) -> &[PicklistValue];
    pub fn child_relationship(&self, name: &str) -> Option<&ChildRelationship>;
}
```

Cache file path: `<cache_root>/<org_id>/<api_version>/<object>.json` (one trimmed
`SObjectSchema` per file). `org_id` = sanitized org username/alias supplied by the
caller (features layer pulls it from sf-core's OrgRegistry); `api_version` supplied
by the caller too — no extra `sf` round-trip in this slice.

## Decisions

1. **On-demand single object only.** No describeGlobal, no describe-all. Bulk
   would be 4914 objects × big payloads — deferred per design §9 risk.
2. **Trimmed model, not raw describe.** Deserialize only completion-relevant
   keys; serde drops the rest. Keeps cache files small and the model stable
   against describe-contract churn.
3. **sf-first, no direct REST.** `sf sobject describe` only. REST composite
   batch-describe speedup is a later optimization (design §9), not the floor.
4. **Cache keyed by (org, apiVersion).** Different orgs / API versions get
   isolated cache trees; `api_version` + `org_id` are caller-supplied to avoid
   an extra `sf org display` per store. Relationship-path resolution and
   global-list caching are deferred.
5. **`get_or_fetch` is the one orchestration entry**: mem hit → disk hit (lazy
   load) → describe + persist. `invalidate` = the refresh primitive.

## Testing

- **Unit (MockRunner):** `describe_object` against a recorded
  `sf sobject describe -s Account` envelope (trimmed fixture) → assert name,
  a reference field's `reference_to`/`relationship_name`, a picklist field's
  values, a child relationship. `field()` case-insensitivity. `picklist_values`
  for non-picklist → empty.
- **Store (tmpdir):** `get_or_fetch` describes once then serves from mem;
  a fresh store `load_disk` reads the persisted file; `invalidate` deletes the
  file and forces a re-describe. Use `tempfile` for `cache_root`.
- **e2e (gated, `#[ignore]`):** real `sf` against staging — `describe_object`
  for `Account` → assert >100 fields, the `Owner` reference field resolves to
  `User`, and at least one picklist field has values. Run with
  `cargo test -p sf-schema -- --ignored` as the post-stage verification
  (standing project rule: e2e after the stage is merged).
