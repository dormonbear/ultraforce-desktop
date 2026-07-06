# Plan: OST agent enrichment — Phase 1 (SOQL validation + Tier-1 field detail)

Grilled & locked with the user. Scope = **B (offline SOQL validation) + all
Tier-1 C (everything derivable from the REST describe we already pull)**.
Per-record-type picklist availability and Apex field-path validation are
explicitly **deferred to Phase 2** (need a new UI-API source / apex-lang infer).

## Motivation (from omni-stack session history, 208 sessions)
The dominant, expensive, recurring failure is **SOQL field/relationship path
errors** — `No such column '<custom field>' on <custom object>` (169 sessions
with `INVALID_FIELD`, 105 with `No such column`) and
`Didn't understand relationship '...__r'`. The agent guesses API names, runs
`sf data query`, fails, retries. OST is positioned to prevent this offline but
today (a) has no SOQL validator and (b) doesn't even surface `relationshipName`
(it's indexed but `ost_object` drops it).

---

## B — `ost_soql(org, query)`  (the high-leverage win; mostly reuse)

The validator already exists: `soql-lang::diagnostics(input, &root_schema,
resolve)` parses SELECT fields, walks **multi-hop relationship paths**
(`relationship_name → reference_to → resolve(target)`), and runs WHERE
operator/type checks. Its only dependency is a closure
`resolve: &dyn Fn(&str) -> Option<&SObjectSchema>`.

- **New tool** in `crates/uf-ost/src/server.rs` + `query.rs`:
  parse FROM object, load its schema from the snapshot, run `diagnostics()`
  with a snapshot-backed `resolve`.
- **Owned-schema cache (the one non-trivial bit):** `read_object` returns owned
  `SObjectSchema`, but `resolve` must hand out `&'a` refs. Preload FROM +
  referenced targets (walk relationship chains from the parsed select fields)
  into a `HashMap<String, SObjectSchema>`, then `resolve = |n| map.get(n)`.
  Iterate to a fixpoint if a chain reveals new targets.
- **Did-you-mean suggestions (locked):** post-process in the uf-ost query layer
  (keep `soql-lang` pure) — for each "Unknown field/relationship" diagnostic,
  fuzzy-rank the object's field/relationship names (reuse the existing FTS5 /
  fuzzy match behind `ost_search`) and append `did you mean 'X'?`.
- **Output:** compact text — one line per diagnostic
  (`ERROR @<col>: <message> [did you mean 'X'?]`), or `OK — N fields resolved`
  when clean.
- **SOQL only** this phase (no Apex path validation).

---

## C (Tier 1) — enrichment from the existing REST describe

All additive; requires capturing more keys + a **reindex** (bump the index
format version so stale snapshots are flagged — verify the version guard in
`apex-lang::db`/`sqlite` and wire it).

### 1. Capture more (`crates/sf-schema`)
- `model.rs` `Field`: `controller_name: Option<String>`, `dependent_picklist:
  bool`, `calculated: bool`, `calculated_formula: Option<String>`,
  `length/precision/scale`, `unique: bool`, `restricted_picklist: bool`,
  `default_value_formula: Option<String>`.
- `model.rs` `PicklistValue`: `valid_for: Option<String>` (raw base64 —
  decoded lazily at query time, not at index time).
- `model.rs` `SObjectSchema`: `record_type_infos: Vec<RecordTypeInfo>`
  (`record_type_id`, `name`, `developer_name`, `active`, `master`, `available`)
  from describe's `recordTypeInfos`.
- `sqlite.rs`: new field columns + `valid_for`; a `record_types` table; update
  INSERT/SELECT.

### 2. Surface — three-piece split (locked)
Keep `ost_object` compact; put heavy bodies behind a batch detail tool.
- **`ost_object`** (`query.rs`): add relationship name to reference lines
  (`AccountId  reference→Account [Account]`); **tag** formula fields
  (`type=formula`) and dependent picklists (`dep→<ControllerField>`) — **no
  bodies**.
- **`ost_fields(org, object, fields: Vec<String>)`** — new batch detail tool:
  per requested field returns formula body, decoded **dependency map**
  (`value X valid when <Controller> ∈ {…}`), length/precision, unique,
  restricted, defaultValueFormula. Batch to avoid N calls.
- **`ost_recordtype(org, object)`** — `[{developerName, id, active, master}]`.

### 3. `validFor` decode (query-time helper)
base64-decode the dependent entry's `valid_for`; controlling value at index `i`
is valid iff `bytes[i>>3] & (0x80 >> (i & 7)) != 0`, mapped against the
controller field's ordered **active** values (same object, available at query
time). Unit-test the decode with a known fixture.

---

## Docs
Update `omni-stack/.claude/skills/ost/SKILL.md` Tools table: add `ost_soql`,
`ost_fields`, `ost_recordtype`; note formula/dependency/record-type coverage and
that a reindex is required for the new attributes. Rebuild the release binary.

## Verify
- `cargo test -p soql-lang -p sf-schema -p uf-ost` green.
- New unit tests: `validFor` decode; `ost_soql` flags a bad field + a bad
  relationship and suggests the nearest name; `ost_fields` returns a formula
  body + dependency map; `ost_recordtype` lists RTs.
- Extend `crates/uf-ost/tests/mcp_contract.rs` for the three new tools.

## Deferred → Phase 2 (do NOT build now)
- **Per-record-type picklist availability** — not in describe; needs UI API
  (`/ui-api/object-info/{obj}/picklist-values/{rtId}/{field}`) per record type,
  a new index step + table, and `ost_picklist(recordType?)`.
- **Apex field-path validation** — needs apex-lang expression type inference
  (`ast/infer.rs`).

## Suggested execution order (incremental commits)
1. B: `ost_soql` + snapshot resolve + suggestions (pure win, no index change).
2. C-capture: model + sqlite + record_types table + format bump + reindex path.
3. C-surface: `ost_object` tags/relationshipName; `ost_fields`; `ost_recordtype`.
4. Docs + release rebuild.
