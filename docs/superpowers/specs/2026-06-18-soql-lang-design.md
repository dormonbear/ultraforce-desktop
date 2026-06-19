# soql-lang (SP-E thin slice) — design

> Date: 2026-06-18 · Status: Approved · Crate: `crates/soql-lang` · Depends on: sf-schema

## Purpose

The that plugin "精华" for SOQL: an **in-process, cache-fed** completion + diagnostics
engine. This thin first slice does: tokenize a SOQL string, find the `FROM`
object, and — given that object's already-cached `sf_schema::SObjectSchema` —
offer SELECT field-name completion and flag unknown fields/objects. Pure: zero
IO, zero `sf` (design §3 "补全在进程内、吃缓存"). The `features` layer wires a
`SchemaStore` to it; `soql-lang` only reads `SObjectSchema`.

Scope (2026-06-18, thin-slice policy): **in scope** — lexer, a lightweight
parse that extracts the FROM object + locates the cursor in the SELECT list,
SELECT field-name completion (prefix-filtered), and unknown-field /
unknown-object diagnostics. **Deferred**: FROM object-name completion (needs the
describeGlobal object list, itself deferred in SP-D), WHERE-clause completion,
relationship-path (`Owner.`) dotted completion, subquery completion, function /
keyword candidates, type-aware operator checks. Those land in later SP-E slices
alongside SP-D's global list + relationship resolution.

## Dependency

`soql-lang → sf-schema` (type-only: reads `SObjectSchema`/`Field`). No sf-core,
no IO. `sf-schema` is a normal dep for the types; a gated e2e dev-deps sf-core +
sf-schema to pull a real schema.

## Crate layout

```
crates/soql-lang/
├── src/
│   ├── lib.rs        # re-exports
│   ├── lexer.rs      # SOQL text → Vec<Token> with byte spans
│   ├── parse.rs      # tokens → SoqlOutline (from_object, select fields + spans)
│   ├── complete.rs   # (outline, cursor, &SObjectSchema) → Vec<Candidate>
│   └── diagnostics.rs# (outline, &SObjectSchema) → Vec<Diagnostic>
```

## Model

```rust
pub enum TokenKind { Ident, Keyword, Comma, Dot, LParen, RParen, Star, Whitespace, Other }
pub struct Token { pub kind: TokenKind, pub text: String, pub start: usize, pub end: usize }

pub struct SoqlOutline {
    pub from_object: Option<String>,        // identifier after FROM
    pub select_fields: Vec<FieldRef>,       // identifiers between SELECT and FROM
}
pub struct FieldRef { pub name: String, pub start: usize, pub end: usize }

pub enum Clause { Select, From, Other }
pub struct Candidate { pub label: String, pub kind: CandidateKind }
pub enum CandidateKind { Field }

pub struct Diagnostic { pub message: String, pub start: usize, pub end: usize, pub severity: Severity }
pub enum Severity { Error, Warning }
```

Keywords (case-insensitive): `SELECT`, `FROM`, `WHERE`, `LIMIT`, `ORDER`, `BY`,
`GROUP`, `HAVING`, `AND`, `OR`, `NOT`, `NULL`, `ASC`, `DESC` (enough to delimit
SELECT/FROM in the slice).

## Surface

```rust
pub fn lex(input: &str) -> Vec<Token>;
pub fn outline(input: &str) -> SoqlOutline;                       // lex + parse-lite
pub fn clause_at(outline: &SoqlOutline, input: &str, cursor: usize) -> Clause;
pub fn complete(input: &str, cursor: usize, schema: &SObjectSchema) -> Vec<Candidate>;
pub fn diagnostics(input: &str, schema: &SObjectSchema) -> Vec<Diagnostic>;
```

- `complete`: build the outline; if the cursor sits in the SELECT field list,
  take the partial identifier under/just-before the cursor and return the
  object's fields whose name starts with it (case-insensitive), as `Field`
  candidates, sorted, deduped. If not in SELECT (or no FROM object), return `[]`.
- `diagnostics`: for each `select_fields` entry that is not `*` and not a known
  field of `schema` (case-insensitive, ignoring dotted relationship refs — a
  name containing `.` is skipped in this slice), emit an `Error`
  "Unknown field 'X' on <Object>" at its span. If the outline's `from_object`
  differs in case from `schema.name` it is fine; if `from_object` is `None`,
  emit nothing (can't resolve).

The caller (features) decides which object to load and passes the schema. An
unknown-OBJECT diagnostic is produced by the caller when `from_object` has no
schema; `soql-lang` exposes `from_object` via `outline` so the caller can check.
(Keeps soql-lang free of a schema registry in this slice.)

## Decisions

1. **Pure, schema-injected.** `complete`/`diagnostics` take `&SObjectSchema`;
   no IO, no registry. Matches design §3 (in-process, cache-fed).
2. **Parse-lite, not a full AST.** Only FROM object + SELECT field list with
   spans — enough for field completion + unknown-field diagnostics. Full AST
   (WHERE, relationship paths, subqueries) is a later slice.
3. **SELECT field completion only.** FROM object-name completion needs the
   global object list (deferred in SP-D), so it is deferred here too.
4. **Dotted refs skipped, not flagged.** A `select_fields` name with `.`
   (relationship path) is neither completed nor diagnosed in this slice
   (relationship resolution is deferred), avoiding false "unknown field" errors.

## Testing

- **lexer:** `lex("SELECT Id, Name FROM Account")` → expected token kinds/spans
  for keywords, idents, comma, whitespace.
- **outline:** the same input → `from_object == Some("Account")`,
  `select_fields` names `["Id","Name"]` with correct spans; a query with no FROM
  → `from_object == None`.
- **complete (in-code `SObjectSchema`):** build a small schema (name "Account",
  fields Id, Name, Industry, OwnerId). `complete("SELECT Na| FROM Account", cursorAtNa, &schema)`
  → candidate labels contain "Name" and not "Id". Cursor in FROM → `[]`. No
  partial (cursor after "SELECT ") → all field names.
- **diagnostics:** `diagnostics("SELECT Id, Bogus FROM Account", &schema)` → one
  Error on "Bogus" with the right span; `SELECT Id, Name` → no diagnostics;
  `SELECT Owner.Name` (dotted) → no diagnostics (skipped).
- **e2e (gated, `#[ignore]`):** dev-dep sf-core + sf-schema; pull the real
  `Account` schema via `sf_schema::describe_object` against staging, then
  `complete("SELECT Nam| FROM Account", …, &schema)` → assert a candidate
  "Name" appears, and `diagnostics("SELECT NotARealField123 FROM Account", &schema)`
  → exactly one Error. Run with `cargo test -p soql-lang --test e2e -- --ignored`.
