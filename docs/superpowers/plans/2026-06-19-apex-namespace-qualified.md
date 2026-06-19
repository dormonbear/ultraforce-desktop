# apex-namespace-qualified: resolve `Namespace.Type` chain heads — Implementation Plan

> `Schema.DescribeSObjectResult.`, `Database.QueryLocator.`, `System.Pattern.` etc. — a chain whose head
> is a known namespace followed by a type in it should resolve to that type (members complete; future
> diagnostics stop false-flagging `Schema.*`/`Database.*`). Pure `apex-lang/resolve.rs` change. Benign.

## Goal

`resolve_expr_type` resolves the chain head as a local var or a bare type today. Add a third head form:
when the head ident is NOT a type but the next segment names a type inside the namespace `head`
(`Ost::type_in(head, next)`), consume both as the head and continue. Stdlib namespace types are already
in the OST (`parse_stdlib` ingests every `publicDeclarations` namespace), so no fetch/describe is needed.

## Scope (MVP) / YAGNI

- IN: 2-segment namespace-qualified head `Namespace.Type` (both non-call), then the normal chain walk
  continues from there (`Schema.SObjectType.getDescribe()` → …). `Namespace.Type.` alone → that Type.
- OUT: nested namespaces; namespace-qualified as a non-head mid-chain segment; disambiguating a type
  that is BOTH a namespace name and a type name (type wins — existing behavior preserved).

## Global Constraints

- Rust 2021. `apex-lang` pure. No new crates. TDD. Gates: `cargo test -p apex-lang`,
  `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` (exit-code-checked —
  [[sf-toolkit-fmt-gate]]). English; conventional commits. No branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `resolve.rs` (current, post generic-element work): `resolve_expr_type(ost, outline, chain)` resolves
  the head via `outline.locals` (declared type, stripped by `base_type_name`) else
  `resolve_type(ost, base_type_name(&head))`, then walks `rest` updating a tracked `cur_str`/`cur`,
  using `collection_element` + method/property return types. Keep ALL of that loop intact.
- `Ost::type_in(&self, namespace: &str, name: &str) -> Option<&ApexType>` exists (case-insensitive on
  both). `resolve_type` searches org_types then every namespace's types by simple name.
- `Segment { name, is_call }`. `complete.rs` routes a `[Schema, SObjectType]`-shaped trailing-dot chain
  to `ChainMember → resolve_expr_type` (a 2+-segment chain is never StaticMember/InstanceMember).
- `base_type_name(t)` strips generics. The existing tests `resolve_expr_type_walks_call_chain`,
  `resolve_expr_type_unwraps_generic_collections`, `resolves_types_and_receiver_types` MUST stay green.

---

### Task 1: namespace-qualified chain head (RED first)

**Files:** `crates/apex-lang/src/resolve.rs`.

- [ ] **Step 1: failing test** — add:
  ```rust
  #[test]
  fn resolve_expr_type_resolves_namespace_qualified_head() {
      use crate::parser::Segment;
      let described = ApexType {
          name: "DescribeSObjectResult".into(),
          kind: TypeKind::Class,
          methods: vec![Method { name: "getName".into(), return_type: "String".into(), params: vec![], is_static: false }],
          properties: vec![],
          enum_values: vec![],
      };
      let ost = Ost {
          namespaces: vec![Namespace { name: "Schema".into(), types: vec![described] }],
          org_types: vec![],
      };
      let outline = ApexOutline::default();
      let seg = |n: &str| Segment { name: n.into(), is_call: false };
      // `Schema.DescribeSObjectResult.` → the type itself
      let t = resolve_expr_type(&ost, &outline, &[seg("Schema"), seg("DescribeSObjectResult")]).unwrap();
      assert_eq!(t.name, "DescribeSObjectResult");
      // unknown namespace member → None
      assert!(resolve_expr_type(&ost, &outline, &[seg("Schema"), seg("Nope")]).is_none());
      // a bare unknown head with no namespace match → None
      assert!(resolve_expr_type(&ost, &outline, &[seg("Bogus"), seg("X")]).is_none());
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — in `resolve_expr_type`, replace the head-resolution prologue (the part that
  computes the initial `cur`/`cur_str` from `base` before the `for seg in rest` loop) with a version
  that also tries the namespace-qualified head. Keep the existing `for seg in rest { … }` loop body
  EXACTLY as-is; only change how `cur`, `cur_str`, and `rest` are initialized:
  ```rust
  pub fn resolve_expr_type<'a>(
      ost: &'a Ost,
      outline: &ApexOutline,
      chain: &[Segment],
  ) -> Option<&'a ApexType> {
      let (base, rest) = chain.split_first()?;
      if base.is_call {
          return None; // free function / unqualified call — unsupported in MVP
      }

      let (mut cur, mut cur_str, mut rest): (&ApexType, String, &[Segment]) =
          if let Some(local) = outline
              .locals
              .iter()
              .find(|local| local.name.eq_ignore_ascii_case(&base.name))
          {
              let s = local.declared_type.clone();
              (resolve_type(ost, base_type_name(&s))?, s, rest)
          } else if let Some(ty) = resolve_type(ost, base_type_name(&base.name)) {
              (ty, base.name.clone(), rest)
          } else if let Some((next, tail)) = rest.split_first() {
              // namespace-qualified head: `Namespace.Type`
              if next.is_call {
                  return None;
              }
              (ost.type_in(&base.name, &next.name)?, next.name.clone(), tail)
          } else {
              return None;
          };

      for seg in rest.iter() {
          // … EXISTING loop body unchanged (collection_element / method / property / void / resolve_type),
          // assigning `cur` and `cur_str` each iteration …
      }
      Some(cur)
  }
  ```
  Note: `rest` becomes mutable and is iterated with `.iter()`. Make sure `cur`/`cur_str` stay `mut`.
  Adjust only as needed so the loop body compiles unchanged.

- [ ] **Step 4: run → green**; then `cargo test -p apex-lang && cargo clippy --workspace -- -D warnings
  && cargo fmt --check`.
- [ ] **Step 5: commit** `feat(apex-lang): resolve namespace-qualified chain heads`

---

## Self-Review

- **Priority preserved:** local var → bare type → namespace head. A name that is both a type and a
  namespace resolves as the type (unchanged behavior).
- **No fetch:** namespace types are already in the stdlib OST; this is pure resolution.
- **Benign:** unknown namespace/member → `None` → no completion. Never errors.
- **Limits:** head-position only; single namespace level.

## When finished, print

```
cargo test -p apex-lang
cargo clippy --workspace -- -D warnings
cargo fmt --check
git log --oneline <BASE_SHA>..HEAD
```
