# apex-inheritance: flatten superclass members into the OST — Implementation Plan

> A class `B extends A` currently exposes only its own members; `A`'s inherited methods/properties are
> invisible (completion misses them AND future diagnostics would false-flag `b.inheritedMethod()`).
> Flatten each org type's `parentClass` chain (org types only) into its member set. Pure
> `apex-lang/acquire.rs` change. Benign.

## Goal

`parse_org_types` returns each type with only its declared members. Capture each type's `parentClass`
during parse, then run a cycle-safe transitive merge: a type inherits every parent member it does not
already declare (child wins on name collision). Parents that are not org types (stdlib supers like
`Exception`, external/managed) are simply not merged — a documented ceiling.

## Scope (MVP) / YAGNI

- IN: single-inheritance `parentClass` chains among ORG types (the records we parse), transitive
  (A←B←C), cycle-guarded. Applies to inner classes too (they are already in the flat type set).
- OUT: `interfaces` (interface method flattening); stdlib/external superclass members; generic
  substitution in inherited signatures; field/method visibility filtering.

## Global Constraints

- Rust 2021. `apex-lang` pure. No new crates (use `std::collections::HashMap`). TDD. Gates:
  `cargo test -p apex-lang`, `cargo clippy --workspace -- -D warnings`, `cargo fmt --check`
  (exit-code-checked — [[sf-toolkit-fmt-gate]]). English; conventional commits. No branch
  creation/switch; NEVER `git push`.

## Pre-verified facts

- `acquire.rs` (post inner-classes work) has `pub fn parse_org_types(records) -> Vec<ApexType>` calling
  `collect_symbol_table_types(symbol_table, name_fallback, &mut out: Vec<ApexType>)` which appends the
  type + recurses `innerClasses`. Reuses `parse_org_methods` / `parse_org_properties`.
- `ApexType { name, kind: TypeKind, methods: Vec<Method>, properties: Vec<Property>, enum_values }`;
  `Method { name, return_type, params, is_static }`, `Property { name, prop_type, is_static }`. All
  derive `Clone`. `TypeKind` derives `Clone` (not `Copy`).
- Salesforce `SymbolTable.parentClass` is normally a STRING superclass name (may be namespaced/qualified,
  e.g. `MyNs.Base` or just `Base`); occasionally an object with a `name`. Parse defensively: string, else
  `.get("name").as_str()`. Take the simple name (last `.`-segment, strip generics) for lookup.
- Existing test `parse_org_types_maps_symbol_table_records` asserts on the parsed set (AccountService +
  inner LineItem). Adding a subclass record changes the set — update that test and add inheritance
  assertions.

---

### Task 1: capture parentClass + cycle-safe transitive flatten (RED first)

**Files:** `crates/apex-lang/src/acquire.rs`,
`crates/apex-lang/tests/fixtures/apexclass_symboltable.json`.

- [ ] **Step 1: extend the fixture** — add a SECOND record to `result.records` (after AccountService):
  ```json
  {
    "Name": "PremiumAccountService",
    "SymbolTable": {
      "name": "PremiumAccountService",
      "namespace": null,
      "parentClass": "AccountService",
      "constructors": [],
      "interfaces": [],
      "innerClasses": [],
      "variables": [],
      "methods": [
        {
          "name": "upgrade",
          "returnType": "void",
          "modifiers": [],
          "parameters": [],
          "annotations": [],
          "references": []
        }
      ],
      "properties": []
    }
  }
  ```
  Bump `totalSize` to `2`.

- [ ] **Step 2: failing test** — extend `parse_org_types_maps_symbol_table_records` so it also asserts the
  subclass inherits the parent's member:
  ```rust
  let premium = by_name("PremiumAccountService").expect("subclass");
  assert!(premium.methods.iter().any(|m| m.name == "upgrade"), "own method");
  assert!(premium.methods.iter().any(|m| m.name == "save"), "inherited from AccountService");
  ```
  (Use the same `by_name` lookup helper added previously; keep the AccountService + LineItem assertions.)

- [ ] **Step 3: run → fail** (`save` not inherited).

- [ ] **Step 4: implement** — capture parent during collection and flatten at the end:
  - Change `collect_symbol_table_types` to push `(ApexType, Option<String>)` into
    `out: &mut Vec<(ApexType, Option<String>)>`, recording `parent_name(symbol_table)` for the type it
    emits (inner classes pass their own parent, or `None`).
  - Add helpers:
    ```rust
    /// Superclass name from a SymbolTable (`parentClass` string, or its `name` if an object). None when
    /// absent/empty.
    fn parent_name(symbol_table: &Value) -> Option<String> {
        let pc = symbol_table.get("parentClass")?;
        let name = pc
            .as_str()
            .map(str::to_string)
            .or_else(|| pc.get("name").and_then(Value::as_str).map(str::to_string))?;
        let name = name.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    /// Simple, generics-stripped, namespace-stripped name for parent lookup: `MyNs.Base<Foo>` → `base`.
    fn simple_key(name: &str) -> String {
        name.split('<')
            .next()
            .unwrap_or(name)
            .rsplit('.')
            .next()
            .unwrap_or(name)
            .trim()
            .to_ascii_lowercase()
    }
    ```
  - Rewrite `parse_org_types` to collect into a `Vec<(ApexType, Option<String>)>`, then flatten:
    ```rust
    pub fn parse_org_types(records: &[serde_json::Value]) -> Vec<ApexType> {
        let mut entries: Vec<(ApexType, Option<String>)> = Vec::new();
        for record in records {
            let Some(symbol_table) = record.get("SymbolTable") else {
                continue;
            };
            let fallback = record.get("Name").and_then(Value::as_str);
            collect_symbol_table_types(symbol_table, fallback, &mut entries);
        }
        flatten_inheritance(entries)
    }

    /// Merge each type's transitive `parentClass` members (org types only; child wins; cycle-safe).
    /// ponytail: only org-type supers are merged — stdlib/external supers are out of reach here.
    fn flatten_inheritance(entries: Vec<(ApexType, Option<String>)>) -> Vec<ApexType> {
        use std::collections::HashMap;
        let index: HashMap<String, usize> = entries
            .iter()
            .enumerate()
            .map(|(i, (ty, _))| (simple_key(&ty.name), i))
            .collect();

        let mut out = Vec::with_capacity(entries.len());
        for i in 0..entries.len() {
            let mut methods = entries[i].0.methods.clone();
            let mut properties = entries[i].0.properties.clone();
            let mut visited = vec![i];
            let mut parent = entries[i].1.clone();
            while let Some(pname) = parent {
                let Some(&pi) = index.get(&simple_key(&pname)) else {
                    break;
                };
                if visited.contains(&pi) {
                    break; // cycle / self-reference guard
                }
                visited.push(pi);
                for m in &entries[pi].0.methods {
                    if !methods.iter().any(|x| x.name.eq_ignore_ascii_case(&m.name)) {
                        methods.push(m.clone());
                    }
                }
                for p in &entries[pi].0.properties {
                    if !properties.iter().any(|x| x.name.eq_ignore_ascii_case(&p.name)) {
                        properties.push(p.clone());
                    }
                }
                parent = entries[pi].1.clone();
            }
            let base = &entries[i].0;
            out.push(ApexType {
                name: base.name.clone(),
                kind: base.kind.clone(),
                methods,
                properties,
                enum_values: base.enum_values.clone(),
            });
        }
        out
    }
    ```
    Update `collect_symbol_table_types`'s signature/body to push the `(ApexType, Option<String>)` tuple
    (carry `parent_name(symbol_table)` for the emitted type; inner-class recursion records each inner's
    own `parent_name`).

- [ ] **Step 5: run → green**; then `cargo test -p apex-lang && cargo clippy --workspace -- -D warnings
  && cargo fmt --check`.
- [ ] **Step 6: commit** `feat(apex-lang): flatten superclass members into org types`

---

## Self-Review

- **Cycle-safe:** a `visited` set stops `A extends B extends A` and self-reference.
- **Child wins:** a subclass override (same method/property name) is kept; parents only add missing names.
- **Transitive:** walks the full parent chain, not one level.
- **Limits:** org-type supers only (stdlib/external supers not merged); `interfaces` not flattened;
  no generic substitution. These are documented ceilings, not silent gaps.

## When finished, print

```
cargo test -p apex-lang
cargo clippy --workspace -- -D warnings
cargo fmt --check
git log --oneline <BASE_SHA>..HEAD
```
