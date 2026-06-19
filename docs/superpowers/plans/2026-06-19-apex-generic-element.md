# apex-generic-element: generic collection element inference — Implementation Plan

> `List<Account> l; l.get(0).` → `Account` members. `Map<Id,Account> m; m.get(k).` → `Account`;
> `m.values().get(0).` → `Account`. Pure `apex-lang` change in `resolve.rs`. Completion-only / benign.

## Goal

Today `resolve_expr_type` strips generics to the base (`List<Account>` → `List`) and walks methods'
declared `return_type`. Stdlib generic accessors (`List.get`, `Map.get/values/keySet`) do not carry the
caller's element type, so the chain dead-ends. Fix: track the receiver's full type **string** (with
generic args) through the chain and, for the well-known collection accessors, derive the element/value
type from those args directly — payload-independent (does not depend on how stdlib encodes generic
return types).

## Scope (MVP) / YAGNI

- IN: base receiver = a local var with a generic declared type; accessor steps `List.get`→arg0,
  `Map.get`→arg1, `Map.values`→`List<arg1>`, `Map.keySet`→`Set<arg0>`. Chains compose
  (`m.values().get(0).`). Generic args parsed with nested-`<>` awareness.
- OUT: array indexing `l[0].` (the chain extractor does not parse `[]` — unchanged); custom generic
  user types; `Iterator<T>`; arg-type-aware overloads. These stay as-is.

## Global Constraints

- Rust 2021. `apex-lang` stays pure. No new crates. No lock/await concerns (sync, pure).
- TDD. Gates: `cargo test -p apex-lang`, `cargo clippy --workspace -- -D warnings`,
  `cargo fmt --check` (exit-code-checked — see [[sf-toolkit-fmt-gate]]). English; conventional commits.
  No branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `crates/apex-lang/src/resolve.rs` has: `base_type_name(t) -> &str` (`split('<').next().trim()`);
  `resolve_type(ost, name) -> Option<&ApexType>`; `resolve_receiver_type(ost, outline, recv)`;
  `resolve_expr_type(ost, &ApexOutline, chain: &[Segment]) -> Option<&ApexType>`.
- `Segment { name: String, is_call: bool }` (from `crate::parser`). `ApexOutline { locals: Vec<LocalVar> }`,
  `LocalVar { name, declared_type }`. `ApexType { name, kind, methods, properties, enum_values }`,
  `Method { name, return_type, params, is_static }`, `Property { name, prop_type, is_static }`.
- The current loop resolves each step's next type via `base_type_name(&m.return_type)` / `&p.prop_type`
  and `resolve_type`, bailing on `void`. Existing test `resolve_expr_type_walks_call_chain` builds a
  synthetic `Ost` inline and asserts the resolved `.name`. Mirror that style.
- `resolve_receiver_type` currently passes the FULL `local.declared_type` to `resolve_type`, so a
  generic local (`List<Account> l`) does NOT resolve today (no exact `"List<Account>"` type). This plan
  fixes that by stripping to the base there too.

---

### Task 1: parse generic type args + collection-accessor element table (RED first)

**Files:** `crates/apex-lang/src/resolve.rs`.

- [ ] **Step 1: failing unit tests** — add to the `tests` module:
  ```rust
  #[test]
  fn generic_args_parses_nested() {
      assert_eq!(generic_args("List<Account>"), vec!["Account".to_string()]);
      assert_eq!(
          generic_args("Map<Id, Account>"),
          vec!["Id".to_string(), "Account".to_string()]
      );
      assert_eq!(
          generic_args("Map<Id, List<Account>>"),
          vec!["Id".to_string(), "List<Account>".to_string()]
      );
      assert!(generic_args("Account").is_empty());
  }

  #[test]
  fn collection_element_known_accessors() {
      let call = |n: &str| Segment { name: n.into(), is_call: true };
      assert_eq!(collection_element("List<Account>", &call("get")).as_deref(), Some("Account"));
      assert_eq!(collection_element("Map<Id,Account>", &call("get")).as_deref(), Some("Account"));
      assert_eq!(collection_element("Map<Id,Account>", &call("values")).as_deref(), Some("List<Account>"));
      assert_eq!(collection_element("Map<Id,Account>", &call("keySet")).as_deref(), Some("Set<Id>"));
      assert!(collection_element("List<Account>", &Segment { name: "size".into(), is_call: true }).is_none());
      assert!(collection_element("Account", &call("get")).is_none());
  }
  ```

- [ ] **Step 2: run → fail (unresolved names).**

- [ ] **Step 3: implement** in resolve.rs (above `resolve_expr_type`):
  ```rust
  /// Top-level generic args of a type string: `Map<Id, List<Account>>` → `["Id", "List<Account>"]`.
  /// Empty when the type is non-generic. Splits on commas only at angle-bracket depth 0.
  fn generic_args(t: &str) -> Vec<String> {
      let t = t.trim();
      let (Some(lt), Some(gt)) = (t.find('<'), t.rfind('>')) else {
          return Vec::new();
      };
      if gt <= lt + 1 {
          return Vec::new();
      }
      let inner = &t[lt + 1..gt];
      let mut args = Vec::new();
      let mut depth = 0i32;
      let mut start = 0usize;
      for (i, c) in inner.char_indices() {
          match c {
              '<' => depth += 1,
              '>' => depth -= 1,
              ',' if depth == 0 => {
                  args.push(inner[start..i].trim().to_string());
                  start = i + 1;
              }
              _ => {}
          }
      }
      let last = inner[start..].trim();
      if !last.is_empty() {
          args.push(last.to_string());
      }
      args
  }

  /// Element/value type for the well-known generic collection accessors, derived from the receiver's
  /// own type args — independent of how stdlib encodes generic return types.
  /// ponytail: hardcoded List/Set/Map accessors; extend the table if more generic APIs need it.
  fn collection_element(receiver_type: &str, seg: &Segment) -> Option<String> {
      if !seg.is_call {
          return None;
      }
      let base = base_type_name(receiver_type).to_ascii_lowercase();
      let args = generic_args(receiver_type);
      let method = seg.name.to_ascii_lowercase();
      match (base.as_str(), method.as_str()) {
          ("list", "get") => args.first().cloned(),
          ("map", "get") => args.get(1).cloned(),
          ("map", "values") => args.get(1).map(|v| format!("List<{v}>")),
          ("map", "keyset") => args.first().map(|k| format!("Set<{k}>")),
          _ => None,
      }
  }
  ```

- [ ] **Step 4: run → green**; clippy + fmt clean (workspace).
- [ ] **Step 5: commit** `feat(apex-lang): parse generic type args + collection element table`

---

### Task 2: thread the receiver type string through `resolve_expr_type` (RED first)

**Files:** `crates/apex-lang/src/resolve.rs`.

- [ ] **Step 1: failing test** — add:
  ```rust
  #[test]
  fn resolve_expr_type_unwraps_generic_collections() {
      use crate::parser::Segment;
      let elem = ApexType {
          name: "Account".into(),
          kind: TypeKind::Class,
          methods: vec![],
          properties: vec![Property { name: "Name".into(), prop_type: "String".into(), is_static: false }],
          enum_values: vec![],
      };
      // List/Map need only to EXIST in the OST (their stdlib get() return type is irrelevant now).
      let collection = |name: &str| ApexType {
          name: name.into(),
          kind: TypeKind::Class,
          methods: vec![Method { name: "get".into(), return_type: "Object".into(), params: vec![], is_static: false },
                        Method { name: "values".into(), return_type: "List".into(), params: vec![], is_static: false }],
          properties: vec![],
          enum_values: vec![],
      };
      let ost = Ost {
          namespaces: vec![Namespace {
              name: "System".into(),
              types: vec![collection("List"), collection("Map"), elem],
          }],
          org_types: vec![],
      };
      let call = |n: &str| Segment { name: n.into(), is_call: true };
      let var = |n: &str| Segment { name: n.into(), is_call: false };

      let lst = ApexOutline { locals: vec![LocalVar { name: "l".into(), declared_type: "List<Account>".into() }] };
      assert_eq!(resolve_expr_type(&ost, &lst, &[var("l"), call("get")]).unwrap().name, "Account");

      let map = ApexOutline { locals: vec![LocalVar { name: "m".into(), declared_type: "Map<Id, Account>".into() }] };
      assert_eq!(resolve_expr_type(&ost, &map, &[var("m"), call("get")]).unwrap().name, "Account");
      // values() → List<Account>, then get() → Account
      assert_eq!(resolve_expr_type(&ost, &map, &[var("m"), call("values"), call("get")]).unwrap().name, "Account");
  }
  ```
  Note: the `Property` import is needed — add `Property` to the `use crate::symbols::{...}` line in the
  tests module if absent.

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — rewrite the body of `resolve_expr_type` to track the current type string:
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
      // Base type string: a local's declared type (keeps generics) or the receiver name itself.
      let mut cur_str = outline
          .locals
          .iter()
          .find(|local| local.name.eq_ignore_ascii_case(&base.name))
          .map(|local| local.declared_type.clone())
          .unwrap_or_else(|| base.name.clone());
      let mut cur = resolve_type(ost, base_type_name(&cur_str))?;

      for seg in rest {
          let next_str: String = if let Some(elem) = collection_element(&cur_str, seg) {
              elem
          } else if seg.is_call {
              cur.methods
                  .iter()
                  .find(|m| m.name.eq_ignore_ascii_case(&seg.name))?
                  .return_type
                  .clone()
          } else if let Some(p) = cur
              .properties
              .iter()
              .find(|p| p.name.eq_ignore_ascii_case(&seg.name))
          {
              p.prop_type.clone()
          } else {
              cur.methods
                  .iter()
                  .find(|m| m.name.eq_ignore_ascii_case(&seg.name))?
                  .return_type
                  .clone()
          };
          if base_type_name(&next_str).eq_ignore_ascii_case("void") {
              return None;
          }
          cur = resolve_type(ost, base_type_name(&next_str))?;
          cur_str = next_str;
      }
      Some(cur)
  }
  ```
  Also make the base generic local resolvable via the InstanceMember path: in
  `resolve_receiver_type`, change `resolve_type(ost, &local.declared_type)` to
  `resolve_type(ost, base_type_name(&local.declared_type))`. (One line; existing
  `resolves_types_and_receiver_types` test still passes — `Account`/`String` have no generics.)

- [ ] **Step 4: run → green**; then `cargo test -p apex-lang && cargo clippy --workspace -- -D warnings
  && cargo fmt --check`.
- [ ] **Step 5: commit** `feat(apex-lang): unwrap generic collection element types in chains`

---

## Self-Review

- **Payload-independent:** element type comes from the caller's declared generic args, not from stdlib
  generic return-type encoding — so it is correct regardless of how `List.get` is described.
- **Benign:** unknown receiver / non-collection / missing args → falls back to the existing
  return_type walk or returns `None` (no completion). Never errors, never false-positives.
- **Limits:** local-var base only; no `[]` indexing; no user generics; no overload arg matching.

## When finished, print

```
cargo test -p apex-lang
cargo clippy --workspace -- -D warnings
cargo fmt --check
git log --oneline <BASE_SHA>..HEAD
```
