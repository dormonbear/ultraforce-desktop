# SOQL child-subquery completion + diagnostics — Design

> Date: 2026-06-21 · Status: Approved · Crates: soql-lang (pure), features (IO)
> Feasible-tier item #1 of `2026-06-21-remaining-work-roadmap.md`.

## Goal

Inside a child subquery `SELECT Id, (SELECT LastName FROM Contacts) FROM Account`:
- complete the subquery's SELECT fields against the **child** sObject (Contact),
- complete the subquery's FROM against the parent's **child-relationship names**,
- stop the parent outline from mis-reading subquery contents as parent fields (today this
  yields false "unknown field" diagnostics and a wrong FROM object).

`Contacts` is a child relationship of Account; `ChildRelationship.child_sobject` = `Contact`.

## Design

### soql-lang (pure)

1. `outline` (parse.rs): treat a parenthesized group at SELECT-item start as opaque — skip from
   `(` to its matching `)` so subquery fields/FROM never leak into the parent outline. (Mirrors
   how `ident(` function calls are already skipped.)

2. `subquery_at(input, cursor) -> Option<Subquery>` (complete.rs): if the cursor sits inside the
   innermost unclosed `(` whose body starts with `SELECT`, return
   `Subquery { inner: String, cursor: usize, from_rel: Option<String> }` where `inner` is the body
   text, `cursor` is the offset into it, and `from_rel = outline(inner).from_object`.

3. `complete`: at the top, if `subquery_at` matches, resolve the child schema
   (`resolve_child(parent, from_rel, resolve)` → parent.child_relationships matched by
   `relationship_name` → `resolve(child_sobject)`) and recurse:
   `complete(inner, sub.cursor, child_or_parent, &child_rel_names, resolve)`.
   - SELECT/field position → child sObject's fields (+ relationships).
   - FROM position → `child_rel_names` (parent's child-relationship names) as Object candidates.

4. `diagnostics`: validate each subquery's SELECT fields against the child schema; unresolved
   child (resolver returns None) → skip (no false positive). Parent diagnostics already ignore
   subquery contents once `outline` skips them.

### features (IO)

- `complete_fields` / `soql_query_diagnostics`: when a subquery is present, resolve the child
  sObject via the parent schema's `child_relationships[rel].child_sobject` and add it to the
  resolver map (same `resolve_related`-style fetch).

## Testing

- soql-lang unit: `outline` skips subquery; `subquery_at` cases (inside SELECT, inside FROM,
  outside); `complete` returns child fields inside the subquery and child-rel names in its FROM;
  `diagnostics` flags an unknown child field, clean for a real one, no false positive on the
  parent.
- features integration (MockRunner): Account + Contact describes; `(SELECT La|` completes
  Contact's `LastName`.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`.

## Out of scope

- Nested subqueries (SOQL only allows one child level anyway).
- Subquery WHERE/ORDER BY type diagnostics (covered generically once the child schema resolves).
