# Design: tree-sitter Apex foundation + completion rebuild (P0 + P1)

Date: 2026-06-23
Status: Approved (design); implementation pending plan
Scope: **P0 (parsing foundation) + P1 (completion rebuild) only.** Diagnostics
(P2), formatting (P3), and old-code cleanup (P4) are follow-on specs.

## Goal

Replace apex-lang's text-heuristic completion engine with a real parse tree, the
way Illuminated Cloud 2 (IC2) does it on IntelliJ PSI. IC2 = JFlex (`.flex`
lexer) + Grammar-Kit (`.bnf` recursive-descent PSI parser) + IntelliJ PSI
(typed, error-tolerant tree) + a stub index for org symbols. Our Rust analog:
**tree-sitter-sfapex (MIT) as the typed/error-tolerant CST**, keeping the
existing **OST symbol model as the stub-index equivalent**.

Concrete pain this fixes: completion classifies caret position by a flat lexical
heuristic (`context_at`) with only "member-after-dot vs everything-is-a-type".
It suggests type names where a variable is being *named* (`List<Account> accou`
→ offered all `Account*` types), can't distinguish expression vs type position,
etc. A real tree gives caret position structurally.

## Non-goals (this spec)

- Formatting on the CST (P3 — separate spec; reference `afmt`).
- Diagnostics on the CST (P2).
- Deleting `ast/*` / heuristic `lexer`/`parser` (P4 — only the parts P1 strands
  may be removed in P1; the rest stays until their consumers move).
- Generic type-argument substitution beyond built-in collections (deferred).

## Architecture (layering, IC2 mapping)

```
source text
   │  tree-sitter-sfapex (apex grammar: parser_output = repeat(statement))
   ▼
CST (Tree)  ── IC2 analog: PSI tree (typed nodes, named fields, error-tolerant)
   │
   ├─ position classification  ── IC2 analog: getParentOfType(pos, contexts.keySet())
   │     descendant_for_byte_range(offset) → walk ancestors to nearest known context node
   │
   └─ semantic resolution (CST + OST)  ── IC2 analog: ApexExpressionType + stub index
         receiver type via local_variable_declaration.type or OST → enumerate members
   ▼
CompletionContext → candidates → existing CandidateDto (UI unchanged)
```

OST (`symbols.rs`, fed by `acquire`/`store`/`snapshot` from the Tooling API)
stays untouched. The CST supplies *positions and local declarations from the
edited source*; the OST supplies *org type definitions*. They meet only in the
semantic-resolution step.

## apex-lang module fate (after P0 + P1)

| Module | Fate in P0+P1 |
|---|---|
| `symbols.rs` (OST), `acquire.rs`, `store.rs`, `snapshot.rs` | **Keep** unchanged |
| `complete.rs` | **Rewrite** on CST |
| `parser.rs` (`context_at`, `outline`) | **Replace** with CST-based `classify` (internal). `context_at`/`outline` become dead once `complete` no longer calls them and may be removed in P1 |
| `parser.rs` (`soql_region_at`, `needed_type_at`) | **Keep as-is in P1** (still heuristic; they also serve the diagnostics path). Migrate to CST in their own phase (P2). Signatures unchanged throughout |
| `lexer.rs` (heuristic) | **Remove** the parts only `complete`/`context_at` used; keep anything still referenced |
| `ast/*`, `resolve.rs` | **Untouched in P1** (still used by diagnostics path); removed in P4 |
| `format.rs` | **Untouched in P1** (P3) |

## P0 — Parsing foundation

Deliverables:
1. Add deps to `crates/apex-lang/Cargo.toml`: `tree-sitter` and
   `tree-sitter-sfapex` (apex language). Confirm the C grammar compiles inside
   `cargo build -p ultraforce-desktop` on the dev machine (macOS). `afmt` proves
   cross-platform viability; Win/Linux verified later in CI, not blocking P0.
2. New module `crates/apex-lang/src/cst.rs`:
   - `parse(src: &str) -> tree_sitter::Tree` (a configured `Parser` with the
     apex language). One parser per call is fine at anonymous-Apex sizes;
     incremental reparse is a later optimization, not in scope.
   - Helpers: `node_at_offset(tree, offset) -> Node` (deepest named node via
     `descendant_for_byte_range`), `ancestors(node) -> iterator`,
     `find_ancestor(node, kinds: &[&str]) -> Option<Node>`, `node_text<'a>(node,
     src) -> &'a str`, `field(node, name) -> Option<Node>`.
   - Kind/field name constants for the node types P1 needs (see below), so we
     don't scatter string literals.

Verification (spike, do first): a unit test parses `List<Account> accou`
(incomplete) and asserts the caret sits inside a `variable_declarator` whose
enclosing `local_variable_declaration` has a `type` field of text
`List<Account>` — proving error-tolerant parse + field access works.

## P1 — Completion rebuild

### Position classification

`classify(tree, src, offset) -> CompletionContext`:
1. `node = node_at_offset(tree, offset)` (and the token to its left for the
   "after `.`" / "after `<`" gating, mirroring IC2's neighbor checks).
2. Walk ancestors to the nearest node whose kind maps to a context. Contexts
   (initial set; superset of today's behavior):

| CST situation | Context | Offer |
|---|---|---|
| caret in `variable_declarator` name slot, after the `type` field of a `local_variable_declaration` / formal parameter | `DeclaratorName(type_text)` | variable-name suggestions only (`Account`→`account`, `List<Account>`→`accounts`); **no types** |
| caret is the `field` of a `field_access` (after `.` / `?.`) | `Member(receiver_node)` | members of the receiver's resolved type |
| inside `new_expression` type slot, `superclass`/`interfaces`, generic type args (`type_arguments`) | `TypeOnly` | types only (OST types + primitives + built-ins) |
| `@`-prefixed `annotation` / `modifiers` slot | `Annotation` | annotation names |
| inside an expression node (`if`/`while`/`for` condition, `return`/`throw` arg, assignment RHS, expression_statement) | `Expression` | locals + types + expr keywords (`new/this/super/null/true/false/instanceof`) |
| at a statement boundary (`block` child start, top-level `parser_output`) | `StatementStart` | statement/decl/modifier keywords + types + locals |
| inside `query_expression` (`[ … ]`) | `Soql` | (P1: delegate to existing SOQL completion via `soql_region_at`) |
| none of the above | `Unknown` | nothing (the "off switch" we lack today) |

Detection is structural (node kind + named field + nearest ancestor), not
lexical — this is the core IC2 idea ported.

### Semantic resolution (CST + OST seam)

`resolve_receiver_type(receiver_node, tree, src, ost) -> Option<&ApexType>`:
- If the receiver is a simple name, look it up among **local declarations**
  collected from the CST (`local_variable_declaration` + formal parameters in
  scope) to get its declared type text, then resolve that text against the OST.
- If the receiver is a type name, resolve directly against the OST (static
  members).
- Member enumeration reuses today's `member_candidates` + parentClass/interface
  walk over `ApexType`.
- Generics: P1 handles **built-in collection element members** only
  (`List/Set/Map` instance methods) via the existing built-in handling; full
  type-argument substitution (`List<Account>.get(0)` → `Account`) is deferred.

### Variable-name suggestions

Reuse the `default_var_name`/`decapitalize` helpers already added; drive them
from `DeclaratorName.type_text` taken from the CST `type` field (more reliable
than the token scan).

### Stable public API (UI/Tauri unchanged)

Only `complete`'s internals change; signatures stay identical:
- `complete(input: &str, cursor: usize, ost: &Ost) -> Vec<Candidate>` — CST-based
- `needed_type_at(input, cursor) -> Option<String>` — unchanged in P1 (heuristic;
  migrates in P2)
- `soql_region_at(input, cursor) -> Option<(usize, usize)>` — unchanged in P1
  (migrates in P2)
- The `apex_complete` Tauri command and the Monaco provider are untouched.

## Data flow (completion request)

`apex_complete(src, offset)` → `state.apex.complete(invoker, org, src, offset)`
→ ensure OST warmed → `cst::parse(src)` → `classify(tree, src, offset)` →
context-specific candidate build (CST locals + OST types/members) →
`Vec<Candidate>` → `CandidateDto` → Monaco.

## Error handling / edge cases

- Parse never fails (tree-sitter always returns a tree, with `ERROR`/`MISSING`
  nodes). `classify` must tolerate `ERROR` ancestors — fall back to the nearest
  *valid* context or `Unknown` (offer nothing) rather than guess.
- Caret at EOF / empty buffer → `node_at_offset` clamps; empty buffer →
  `StatementStart` with empty prefix (offer top-level).
- Incomplete `List<Account> accou` → the `variable_declarator` may be under an
  `ERROR`; classification keys off the recoverable `local_variable_declaration`
  + `type` field, which the grammar still produces.
- Prefix extraction stays as today (identifier chars left of caret), filtered
  case-insensitively.

## Testing

- P0: parse + node-location unit tests on representative snippets (class file,
  anonymous block, incomplete declaration, inline SOQL).
- P1: table-driven `classify` tests asserting the context for each row above,
  plus regression of the existing completion behaviors (the current
  `complete.rs` tests are ported to drive the CST path: member access,
  declarator-name suppression, built-in types, `new` → types).
- The existing `ost()` test fixture is reused for semantic resolution.

## Risks / spikes (do early)

1. **Build chain** (medium): tree-sitter C parser compiling in the Tauri Rust
   build across platforms. Spike: minimal `cst::parse` green under
   `cargo build -p ultraforce-desktop` on macOS first.
2. **While-typing parse** (low): tree-sitter is error-tolerant; validated by the
   P0 incomplete-declaration spike.
3. **Generic substitution** (med-high): deferred; P1 ships without it, so it
   does not block.
4. **OST seam** (med): the CST↔OST interface in `resolve_receiver_type` must be
   defined cleanly in P1 so P2/P3 can reuse it.

## Decomposition (future specs)

- P2: diagnostics on CST (`ERROR`/`MISSING` + semantic) — separate spec.
- P3: formatting on CST (afmt-style, implementing the earlier
  `apex-formatter-spec.md` Tier 1+) — separate spec.
- P4: delete `ast/*`, `resolve.rs`, residual heuristic lexer/parser — separate
  cleanup spec.
