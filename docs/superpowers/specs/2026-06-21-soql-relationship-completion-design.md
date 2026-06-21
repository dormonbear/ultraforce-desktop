# SOQL multi-hop relationship completion + WHERE operator diagnostics — Design

> Date: 2026-06-21 · Status: Approved (design) · Crates: soql-lang (pure), features (IO), desktop (no change)
> Closes the SP-E gap deferred in `2026-06-18-soql-lang-design.md` ("WHERE-clause completion,
> relationship paths, type-aware operator checks land in later SP-E slices").

## Goal & scope

Make SOQL completion and diagnostics understand **relationship paths** (`Owner.Name`,
`Account.Owner.Manager.Email`) at arbitrary depth, and flag **type-incompatible WHERE
operators**. soql-lang stays pure; all IO (fetching related-object describes) lives in
`features`.

**In scope**
1. Multi-hop relationship field completion in SELECT and WHERE (`A.B.C.<partial>`).
2. Relationship-name candidates at the root and at each hop (so the user can build the path).
3. Unknown-field diagnostics on dotted relationship fields (currently skipped).
4. Type-aware WHERE operator diagnostics — conservative, only SF-illegal combos.

**Out of scope**
- Child subquery completion (`SELECT Id, (SELECT … FROM Contacts)`) — separate slice.
- Polymorphic relationship intersection: a multi-target reference resolves to its **first**
  `referenceTo` only (`// ponytail: first ref_to; intersect if it matters`).
- Operator/value *value* validation (e.g. picklist value membership) — only operator-vs-type.

## Architecture

`SObjectSchema.fields[]` already carries `relationship_name: Option<String>` (e.g. `OwnerId`
→ `Owner`) and `reference_to: Vec<String>` (→ `["User"]`). A hop = find the field whose
`relationship_name` matches the segment, take `reference_to[0]` as the target object, resolve
that object's schema, repeat.

soql-lang cannot do IO, so it takes a **resolver** `&dyn Fn(&str) -> Option<&SObjectSchema>`
(object name → schema). `features` builds the resolver by iteratively fetching target schemas
via `SchemaStore::get_or_fetch`, then calls the pure functions.

### Unit 1 — soql-lang: path extraction (pure)

New `pub fn relationship_chain_at(input: &str, cursor: usize) -> Vec<String>`.
Walks back from `cursor`: over the trailing identifier (the partial), then over each
`.<ident>` pair, collecting the relationship segments **before** the final partial.

- `SELECT Owner.Ma|`        → `["Owner"]`        (partial `Ma`)
- `SELECT Account.Owner.|`  → `["Account","Owner"]` (partial empty)
- `SELECT Na|`              → `[]`
- `WHERE Owner.Na|`         → `["Owner"]`

Purely lexical, so it is clause-independent. `partial_at` is unchanged (it already stops at `.`).

### Unit 2 — soql-lang: completion with a resolver

`complete` gains a last parameter:

```rust
pub fn complete(
    input: &str, cursor: usize,
    schema: &SObjectSchema, objects: &[String],
    resolve: &dyn Fn(&str) -> Option<&SObjectSchema>,
) -> Vec<Candidate>
```

- Compute `chain = relationship_chain_at(input, cursor)`.
- **chain empty** → current behavior, plus: in the field-completion arms
  (Select/Where/OrderBy/GroupBy/Having) also push each field's `relationship_name`
  as a `Relationship` candidate.
- **chain non-empty** → walk it: `cur = schema`; for each `seg`, find a field with
  `relationship_name.eq_ignore_ascii_case(seg)`, take `reference_to.first()`, set
  `cur = resolve(target)?`. Any miss → return `[]` (no guess). Then offer `cur`'s fields
  (`Field`) and relationship names (`Relationship`), filtered by `partial`.

All existing callers pass `&|_| None` (no traversal — backward compatible).

### Unit 3 — soql-lang: WHERE condition parsing (pure)

Add to `parse.rs`:

```rust
pub struct Condition { pub field: FieldRef, pub op: String, pub op_start: usize, pub op_end: usize }
pub fn where_conditions(input: &str) -> Vec<Condition>
```

Scan tokens after the `WHERE` keyword (stop at GROUP/ORDER/LIMIT/OFFSET/HAVING). A condition
is `field-path operator value`. Operators recognized: `= != <> < > <= >= LIKE IN NOT IN
INCLUDES EXCLUDES`. `field` keeps the dotted path + span. Parentheses/AND/OR are skipped
between conditions; malformed fragments are ignored (best-effort, never panics).

### Unit 4 — soql-lang: diagnostics with a resolver + operator checks

`diagnostics` gains the resolver:

```rust
pub fn diagnostics(
    input: &str, schema: &SObjectSchema,
    resolve: &dyn Fn(&str) -> Option<&SObjectSchema>,
) -> Vec<Diagnostic>
```

1. **Unknown SELECT fields** (existing) — now dotted fields resolve through the chain instead
   of being skipped: walk `A.B.C` via `resolve`; the final segment must be a real field on the
   resolved object, else `Error`. Unresolvable hop (resolver returns `None`) → skip (no false
   positive, same as today's callers passing `&|_| None`).
2. **WHERE operator vs field type** — for each `Condition`, resolve the field's type (root or
   via chain) and flag, conservatively, only clearly-illegal combinations:
   - `LIKE` on a non-text type. Text-ish = string, picklist, multipicklist, textarea, email,
     phone, url, combobox, reference, id, encryptedstring.
   - `< > <= >=` on `boolean`.
   - `INCLUDES`/`EXCLUDES` on a non-`multipicklist` type.
   Field type unresolved → no diagnostic. Severity `Error`, span covers the operator.

All existing callers pass `&|_| None` → dotted SELECT fields still skipped, no WHERE-op checks
unless a resolver is supplied: behavior preserved.

### Unit 5 — features: build the resolver (IO)

- `complete_fields`: after the root schema, if `relationship_chain_at` is non-empty, loop the
  segments resolving each `relationship_name → reference_to[0]` target and
  `store.get_or_fetch` its schema into a `HashMap<String, SObjectSchema>` (keyed by object
  name). Pass `&|name| map.get(name)` to `complete`. Multi-hop = the loop continues until the
  chain is consumed or a hop fails.
- `soql_query_diagnostics`: collect every dotted field path in the query (SELECT list +
  `where_conditions`), resolve and fetch their target objects into the same kind of map, pass
  the resolver to `diagnostics`.
- Resolution failures degrade gracefully (skip that path), never error the whole call.

### Unit 6 — desktop

No change. `complete_fields` / `diagnose` signatures are unchanged (the resolver is internal to
features). `CandidateKind::Relationship` already maps in `dto.rs`.

## Testing

- **soql-lang unit**: `relationship_chain_at` (the four cases above + WHERE); `complete`
  multi-hop with a stub `HashMap` resolver; relationship-name candidates at root and at a hop;
  `where_conditions` parsing (simple, dotted field, AND/OR, parens, malformed); operator
  diagnostics (LIKE on number, `>` on boolean, INCLUDES on text → flagged; LIKE on string,
  `>` on number → clean); dotted unknown-field flagged when resolver supplies the object.
- **features integration** (`MockRunner`): describe Account then User; `SELECT Owner.<cur>`
  completes User fields; a two-hop path drives two fetches; `diagnose` flags `Owner.Bogus`.
- **e2e** (`#[ignore]`, live org): `SELECT Owner. FROM Account` returns real User fields.
- Gates: `cargo test --workspace`, `cargo clippy --workspace --all-targets -D warnings`,
  `cargo fmt --check` all clean.

## Risks

- **Resolver lifetime**: the `HashMap` of fetched schemas must outlive the `complete`/
  `diagnostics` call. features owns the map locally and passes a borrowing closure — fine.
- **Over-flagging operators**: SOQL is permissive; the rules above are deliberately the
  minimal SF-illegal set to avoid false positives. New rules only added with evidence.
- **Cost**: a deep path triggers one describe per new hop. All are disk-cached after first use;
  acceptable for an editor completion triggered on `.`.
