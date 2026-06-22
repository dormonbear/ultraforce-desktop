# apex-lang (SP-F) — design

> Date: 2026-06-19 · Crate: `crates/apex-lang` · Depends on: sf-schema → sf-core
> Mechanism: an Offline Symbol Table (OST), generated from the user's own org
> via Salesforce first-party endpoints — never from the reference plugin's bundled data.

## Goal & non-goals

**Goal.** The Apex half of the reference plugin "精华": an **in-process, cache-fed** Apex
completion engine. It builds an Offline Symbol Table (OST) that covers (a) the
Apex `System`-namespace standard library, (b) sObject fields/relationships, and
(c) the org's own `ApexClass` symbols, then completes against that cached table
**in-process — never spawning `sf` per keystroke**. Phase 1 ships OST
acquisition + basic completion; later phases add inference and diagnostics.

**Mechanism, not data (LOCKED).** The *mechanism* is the same as
the established Salesforce IDE plugin's OST. The *data* is ours: we GENERATE the symbol table from
the user's connected org through Salesforce **first-party** endpoints. We never
copy, embed, or redistribute the reference plugin's bundled symbol data. (Mirrors the
sf-toolkit rule: completion data comes from Salesforce endpoints only.)

**Non-goals (this design, all phases).** No code formatting, no execution, no
full Apex compiler, no LSP server process. No bundled/precomputed System-library
dataset checked into the repo — the OST is always derived from a live org and
cached on disk. No UI here (desktop wiring is Phase 3, likely its own slice).

## The OST mechanism + first-party data sources

The OST is an offline, on-disk + in-memory symbol table, versioned per
`(org, apiVersion)` exactly like `sf_schema::SchemaStore`. Three first-party
sources feed it; each is acquired once and cached, then completion reads the
cache with zero `sf` calls.

| OST part | First-party source | Invocation (verification status) |
|---|---|---|
| Apex `System` stdlib (types, methods, properties, enums, interfaces) | Tooling API `completions` resource, `type=apex` | `sf api request rest '/services/data/vXX.0/tooling/completions?type=apex' --target-org <org> --json` — **VERIFIED** the `sf api request rest [URL]` subcommand exists in sf 2.x (GET default, `--json` supported). The **response shape** of the completions payload is **NOT yet verified** — see Risks + a verification TODO before asserting the parser. |
| sObject fields/relationships | **Reuse `sf-schema`** (`describe_object` / `SchemaStore`) | Already shipped and verified (SP-D, sf 2.127). apex-lang does NOT re-describe. |
| org `ApexClass` symbols (methods/properties) | Tooling query of `ApexClass.SymbolTable` | `sf data query --query "SELECT Name, SymbolTable FROM ApexClass" --use-tooling-api --json` — **VERIFIED** `--use-tooling-api` is the correct sf 2.x flag. The `SymbolTable` field's JSON shape is documented by Salesforce but should be pinned against a real fixture (verification TODO). |

> The completions endpoint is the largest unknown. The `acquire` layer must keep
> the raw payload → OST mapping behind a single parser module so that, once the
> real shape is pinned from a recorded fixture, only that module changes.

## Crate / module layout

```
crates/apex-lang/
├── src/
│   ├── lib.rs         # re-exports
│   ├── acquire.rs     # sf-backed fetch of the three sources → raw payloads
│   ├── symbols.rs     # OST model: ApexType, Method, Property, Enum, Interface, Namespace
│   ├── store.rs       # disk+memory OST cache, versioned by (org, apiVersion)
│   ├── lexer.rs       # Apex text → Vec<Token> with byte spans (pure, sf-free)
│   ├── parser.rs      # tokens → lightweight outline (decls, locals, cursor context)
│   ├── resolve.rs     # name → OST symbol lookup (Type./expr. member access, basic)
│   ├── complete.rs    # (context, &Ost) → Vec<Candidate>  (pure)
│   └── diagnostics.rs # (Phase 3) unknown symbol/type/method  (pure)
```

`acquire` + `store` are the only sf-touching modules. `lexer`, `parser`,
`resolve`, `complete`, `diagnostics` are **pure** — they take borrowed OST data
and a source string, do zero IO, and are TDD-friendly with fixtures.

## Phasing

### Phase 1 — generate the offline table + basic completion (DETAILED in the plan)

- `symbols.rs`: OST model — `Ost`, `Namespace`, `ApexType`, `Method`,
  `Property`, `EnumValue`, plus `kind` (class/interface/enum). serde-derived,
  unknown keys ignored (mirror sf-schema's trimming discipline).
- `acquire.rs`: three first-party fetchers returning raw payloads — stdlib
  completions, sObject describe (delegated to `sf-schema`), `ApexClass`
  SymbolTable query. Each behind `SfInvoker`, MockRunner-testable.
- A parser per source mapping raw payload → OST entries (stdlib completions →
  System namespace; SymbolTable rows → org-class types).
- `store.rs`: disk + memory OST cache keyed `(api_version, source)`, file path
  `<cache_root>/<org_id>/<api_version>/apex-ost/<source>.json`, with
  `get_or_fetch` / `load_disk` / `invalidate` mirroring `SchemaStore`.
- `lexer.rs`: Apex lexer with byte spans (idents, keywords, `.`, `(`, `)`, `;`,
  `{` `}`, `,`, `<` `>`, string/number literals lumped, whitespace, other).
- `parser.rs` + cursor-context classification: locate the cursor and classify
  it — top-level (type/keyword/local-var position), `Type.` (static member
  access), or `expr.` (instance member access).
- `complete.rs`: completion against the OST — top-level type/keyword/local-var
  candidates; `Type.` static members and `expr.` instance members at a **basic**
  level (string-name resolution; no full inference yet).
- A gated `#[ignore]` real-sf e2e (mirrors SP-D/SP-E siblings).

### Phase 2 — inference (OUTLINE only in the plan)

Type inference for local variables and expression results; method overload
resolution; generics and collection element types (`List<T>`, `Map<K,V>`,
`Set<T>`). Tasks named, not coded; detailed after Phase 1 lands.

### Phase 3 — diagnostics + desktop (OUTLINE only in the plan)

Diagnostics (unknown symbol/type/method against the OST); SOQL-in-Apex
awareness (delegate inline `[SELECT …]` to `soql-lang`); desktop wiring (a Tauri
command + Monaco completion provider). The desktop wiring likely becomes its own
desktop slice rather than living in `apex-lang`.

## Data freshness / caching

- OST is versioned per `(org, apiVersion)` — a new org or API version is a cold
  cache. Mirrors `sf_schema::SchemaStore` semantics exactly.
- `get_or_fetch` = memory → disk → acquire-and-persist. `invalidate(source)`
  drops mem + deletes the file → next read re-acquires.
- The org `ApexClass` SymbolTable is the most volatile source (changes whenever
  the user edits Apex); it must be independently invalidatable from the stable
  stdlib source. Stdlib changes only on API-version bumps.
- No background/incremental refresh in Phase 1 — explicit `invalidate` only,
  matching SP-D's deferral.

## Risks

1. **Completions-endpoint shape unknown until verified (highest).** The sf
   subcommand is confirmed, but the `tooling/completions?type=apex` payload
   structure is not yet pinned. Mitigation: record one real payload as a fixture
   first; isolate parsing in one module; gate assertions behind the fixture; do
   NOT fabricate the shape in code.
2. **Large System namespace size.** The full System stdlib is large; loading and
   completing must stay fast. Mitigation: trim the OST model to
   completion-relevant keys, cache pretty-JSON on disk, build prefix indexes
   lazily, keep `complete` allocation-light.
3. **Type inference complexity.** Real Apex inference (generics, overloads,
   chained calls) is hard. Mitigation: Phase 1 stays string-name-only; defer all
   inference to Phase 2 behind a clear `resolve` boundary.
4. **SymbolTable JSON drift.** `ApexClass.SymbolTable` shape is documented but
   versioned. Mitigation: pin against a recorded fixture; serde-ignore unknowns.

## Testing strategy

- **Unit (pure, no sf).** `lexer`, `parser`, cursor classification, `resolve`,
  `complete` tested against in-code/fixture OSTs. RED→GREEN per task.
- **Acquisition (MockRunner).** `acquire` + parsers tested against **recorded**
  fixtures: a trimmed `completions?type=apex` envelope and a trimmed
  `SELECT Name, SymbolTable FROM ApexClass` envelope, plus the existing
  `sf-schema` describe fixture. Assert the exact `sf` args the runner sees.
  **No live `sf` in unit tests.**
- **Store (tmpdir).** `get_or_fetch` acquires once then serves from memory; a
  fresh store `load_disk` reads the persisted file; `invalidate` forces
  re-acquire. Unique temp root per run (no `tempfile` crate), mirroring
  `SchemaStore` tests.
- **e2e (gated, `#[ignore]`).** Real `sf` against staging: acquire the OST,
  assert the System namespace has core types (e.g. `String`, `List`), then
  complete `System.deb` → a `debug`-bearing candidate. Run with
  `cargo test -p apex-lang -- --ignored` as the post-stage verification
  (standing project rule: e2e after the stage is merged).

## Dependency boundaries

- `apex-lang → sf-schema → sf-core`. `sf-schema` is a normal dep (OST reuses its
  describe + `SObjectSchema` for the field source). `sf-core` is reached only
  transitively for `acquire`/`store` (and directly as a dev-dep for the gated
  e2e), exactly as `soql-lang` does.
- Pure modules (`lexer`/`parser`/`resolve`/`complete`/`diagnostics`) take
  borrowed OST data — no network, no registry, no `sf`.
- **No new external crates** beyond what `soql-lang`/`sf-schema` already use
  (`serde`, `serde_json`, `thiserror`, `tokio`) unless justified.
