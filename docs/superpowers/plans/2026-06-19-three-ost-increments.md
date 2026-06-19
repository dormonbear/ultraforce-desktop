# Plan: three OST / robustness increments

Three independent, additive, test-backed changes. TDD: write the test, watch it
fail, implement, watch it pass. One atomic commit per task. Work on branch
`feat/three-ost-increments` (already created). **NEVER `git push`.**

Workspace: Cargo at repo root, crates under `crates/`.
Verify after EACH task:
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo fmt --all --check`
(`cargo build --workspace` is implied by test.)

---

## Task 1 — Detect org API version (stop hardcoding "60.0")

**Problem.** `const API_VERSION: &str = "60.0"` is hardcoded in
`crates/features/src/soql.rs:9` and `crates/features/src/apex_complete.rs:14`.
Replace with a best-effort per-org detection that falls back to `"60.0"` (so a
detection failure is a no-op regression-wise).

Verified facts (do not re-derive):
- `sf org display --json` → `{ "result": { "apiVersion": "67.0", ... } }`.
- `SfInvoker::run_json` auto-appends `--json` and returns the `result` object.
- The `org`/`org_id` string flowing into these features is a **username/alias**
  (or the literal `"default"` when none selected), NOT a 00D id — so it is a
  valid `--target-org` value. For `"default"`, omit `--target-org` entirely.

### 1a. `crates/sf-core/src/org.rs` — add `OrgRegistry::api_version`

Add a private struct + method on `OrgRegistry`:

```rust
#[derive(Debug, Deserialize)]
struct OrgDisplay {
    #[serde(rename = "apiVersion", default)]
    api_version: Option<String>,
}

impl OrgRegistry {
    /// The org's API version via `sf org display`. `target` is a username/alias;
    /// pass `None` for the default org. `Ok(None)` if the field is absent.
    pub async fn api_version(
        invoker: &SfInvoker,
        target: Option<&str>,
    ) -> Result<Option<String>, SfError> {
        let mut args = vec!["org", "display"];
        if let Some(t) = target {
            args.push("--target-org");
            args.push(t);
        }
        let d: OrgDisplay = invoker.run_json(&args).await?;
        Ok(d.api_version)
    }
}
```

Test (in org.rs `mod tests`), reuse the existing `invoker_returning` helper:

```rust
#[tokio::test]
async fn reads_api_version_from_org_display() {
    let json = r#"{"status":0,"result":{"apiVersion":"67.0"}}"#;
    let v = OrgRegistry::api_version(&invoker_returning(json), Some("me@x.com"))
        .await
        .unwrap();
    assert_eq!(v.as_deref(), Some("67.0"));
}
```

### 1b. `crates/features/src/api_version.rs` — new cached helper

```rust
//! Best-effort, org-keyed cache of the org's API version. Detection failures fall
//! back to `DEFAULT_API_VERSION` (no regression vs the previously hardcoded const).

use sf_core::{OrgRegistry, SfInvoker};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const DEFAULT_API_VERSION: &str = "60.0";

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static C: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// API version for `org` (a username/alias, or `"default"`). Detected once per org
/// via `sf org display`, then cached process-wide; `"60.0"` on any failure.
/// ponytail: failures are NOT cached, so a transient error retries next call.
pub async fn api_version_for(invoker: &SfInvoker, org: &str) -> String {
    if let Some(v) = cache().lock().unwrap().get(org).cloned() {
        return v;
    }
    let target = if org == "default" { None } else { Some(org) };
    match OrgRegistry::api_version(invoker, target).await {
        Ok(Some(v)) => {
            cache().lock().unwrap().insert(org.to_string(), v.clone());
            v
        }
        _ => DEFAULT_API_VERSION.to_string(),
    }
}
```

Register the module in `crates/features/src/lib.rs` (add `pub mod api_version;`
alongside the other `pub mod` lines).

Test (use a UNIQUE org key so the process-wide cache can't collide with other
tests; assert the detected value is returned):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::Arc;

    #[tokio::test]
    async fn returns_detected_version() {
        let json = r#"{"status":0,"result":{"apiVersion":"67.0"}}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let v = api_version_for(&invoker, "unique-org-detected@x.com").await;
        assert_eq!(v, "67.0");
    }

    #[tokio::test]
    async fn falls_back_on_failure() {
        // MockRunner returning a non-zero / unparseable envelope → fallback.
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":1}"#)));
        let v = api_version_for(&invoker, "unique-org-fallback@x.com").await;
        assert_eq!(v, "60.0");
    }
}
```

If `MockRunner::ok_json(r#"{"status":1}"#)` does not actually make `run_json`
return `Err`, inspect `parse_envelope` / `MockRunner` and craft a payload that
does (e.g. malformed JSON). The point: a detection failure yields `"60.0"`.

### 1c. Wire into `apex_complete.rs`

- Delete `const API_VERSION: &str = "60.0";` (line 14).
- In `build`, `describe_schema`, and `complete_soql`, before the
  `store.get_or_fetch(...)` call, add:
  `let api = crate::api_version::api_version_for(invoker, org_id).await;`
  and pass `&api` where `API_VERSION` was used.
  (`build` has two `get_or_fetch` calls — detect `api` once at the top, reuse for both.)

### 1d. Wire into `soql.rs`

- Delete `const API_VERSION: &str = "60.0";` (line 9).
- `complete_fields`: add `let api = crate::api_version::api_version_for(invoker, org_id).await;`
  before the `store.get_or_fetch(...)` call; pass `&api`.
- `soql_query_diagnostics`: add a parameter `api: &str` and use it in place of
  `API_VERSION`.
- `diagnose` and `diagnose_apex_soql`: before calling `soql_query_diagnostics`,
  detect once: `let api = crate::api_version::api_version_for(invoker, org_id).await;`
  and pass `&api` to every `soql_query_diagnostics(&mut store, invoker, &api, ...)` call.

Existing soql.rs tests that drive `complete_fields`/`diagnose`/`diagnose_apex_soql`
through a `MockRunner` will now also issue an `sf org display` call first. Update
those mocks if they assert on exact arg sequences or a single invocation — the
detection adds one `org display` call before the describe. If a mock is a simple
"return this describe JSON for any args" closure, it already tolerates the extra
call (it just returns describe JSON for `org display` too, whose `apiVersion` is
absent → safe fallback to "60.0"). Prefer making the test mocks return a payload
whose `result.apiVersion` is present OR simply assert on outcomes, not call counts.

Commit: `feat(features): detect org API version instead of hardcoding 60.0`

---

## Task 2 — `outline` captures dotted declared types (`Outer.Inner x;`)

**File:** `crates/apex-lang/src/parser.rs`.

**Problem.** `outline` only reads a single `Ident` as `declared_type`. For
`Outer.Inner x;` it currently records `declared_type = "Inner"` (the qualifier is
dropped), which is wrong for a faithful declaration and blocks future Apex
diagnostics. Capture the FULL dotted type, and resolve it so completion still works.

### 2a. Rewrite the `outline` capture loop (lines 30–53)

Recognize the pattern `Ident (Dot Ident)* Ident ;`-ish: greedily join
dot-separated idents into the type, then the next ident is the variable name.

```rust
pub fn outline(input: &str) -> ApexOutline {
    let tokens = lex(input);
    let mut locals = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        if tokens[i].kind == TokenKind::Ident {
            // Greedily consume `Ident (Dot Ident)*` as a (possibly dotted) type.
            let mut type_text = tokens[i].text.clone();
            let mut last = i;
            loop {
                let Some(dot) = next_non_ws(&tokens, last + 1) else { break };
                if tokens[dot].kind != TokenKind::Dot {
                    break;
                }
                let Some(seg) = next_non_ws(&tokens, dot + 1) else { break };
                if tokens[seg].kind != TokenKind::Ident {
                    break;
                }
                type_text.push('.');
                type_text.push_str(&tokens[seg].text);
                last = seg;
            }
            // The next ident after the type is the variable name.
            if let Some(name_idx) = next_non_ws(&tokens, last + 1) {
                if tokens[name_idx].kind == TokenKind::Ident
                    && statement_has_semicolon(&tokens, name_idx + 1)
                {
                    locals.push(LocalVar {
                        declared_type: type_text,
                        name: tokens[name_idx].text.clone(),
                    });
                }
                i = name_idx;
            } else {
                i = last;
            }
        }
        i += 1;
    }

    ApexOutline { locals }
}
```

Confirm the existing test `outline_collects_simple_local_declarations`
(`"Account a; Integer n = 0;"`) still passes (simple types unchanged). Note
`Integer n = 0;` — after `n`, `statement_has_semicolon` walks to the `;`; keep
that behavior identical (do not change `statement_has_semicolon`).

Add test:

```rust
#[test]
fn outline_collects_dotted_declared_type() {
    let o = outline("Outer.Inner x;");
    assert_eq!(
        o.locals,
        vec![LocalVar {
            name: "x".to_string(),
            declared_type: "Outer.Inner".to_string(),
        }]
    );
}
```

### 2b. Resolve dotted local types — `crates/apex-lang/src/resolve.rs`

`resolve_receiver_type` (line 23) calls `resolve_type(ost, base_type_name(decl))`.
Inner classes are stored under their SIMPLE name, so `resolve_type("Outer.Inner")`
misses. Add a last-segment fallback. Replace line 23's single return with:

```rust
let ty = base_type_name(&local.declared_type);
return resolve_type(ost, ty).or_else(|| {
    // Dotted declared type (e.g. `Outer.Inner`): inner/qualified types are stored
    // under their simple name — retry with the last `.` segment.
    ty.rsplit('.').next().filter(|s| *s != ty).and_then(|simple| resolve_type(ost, simple))
});
```

Add a test in resolve.rs proving `Outer.Inner x; x.` resolves to the inner type's
members. Build a small `Ost` whose `org_types` contains an `ApexType` named
`Inner` with one method (e.g. `ping`), an `ApexOutline` with
`LocalVar { name: "x", declared_type: "Outer.Inner" }`, and assert
`resolve_receiver_type(&ost, &outline, "x")` returns the `Inner` type. Mirror the
construction style already used in resolve.rs's existing tests.

Commit: `feat(apex-lang): capture and resolve dotted declared types in outline`

---

## Task 3 — Flatten implemented-interface members into org types

**File:** `crates/apex-lang/src/acquire.rs`.

**Problem.** `flatten_inheritance` merges only the single `parentClass`. A class's
`implements` interfaces (the SymbolTable `interfaces` array) are NOT merged, so a
class implementing an interface doesn't surface the interface's methods. Generalize
the existing single-parent merge to multiple supertypes (parentClass + interfaces).
Org types only — same limitation as today (external/stdlib supertypes not merged).

### Changes

1. Change the entry tuple's second element from `Option<String>` (single parent)
   to `Vec<String>` (supertypes). Update:
   - `parse_org_types`: `let mut entries: Vec<(ApexType, Vec<String>)> = Vec::new();`
   - `collect_symbol_table_types`: `out: &mut Vec<(ApexType, Vec<String>)>` and push
     `super_types(symbol_table)` instead of `parent_name(symbol_table)`.
   - `flatten_inheritance(entries: Vec<(ApexType, Vec<String>)>)`.

2. Replace `parent_name` with `super_types` returning all supertype names
   (parentClass first if present, then each interface):

```rust
/// All org-supertype names: `parentClass` (if any) followed by `interfaces[]`.
fn super_types(symbol_table: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(p) = symbol_table.get("parentClass") {
        if let Some(name) = type_ref_name(p) {
            names.push(name);
        }
    }
    if let Some(arr) = symbol_table.get("interfaces").and_then(Value::as_array) {
        for iface in arr {
            if let Some(name) = type_ref_name(iface) {
                names.push(name);
            }
        }
    }
    names
}

/// A SymbolTable type reference is either a bare string or an object with `name`.
fn type_ref_name(v: &Value) -> Option<String> {
    let name = v.as_str().map(str::to_string).or_else(|| {
        v.get("name").and_then(Value::as_str).map(str::to_string)
    })?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}
```

3. Generalize `flatten_inheritance` to walk a worklist of supertypes instead of a
   single `parent` chain. Keep: cycle-safe via `visited`, child-wins on name
   collision, simple_key lookup. Replace the `while let Some(parent_name) = parent`
   loop with a stack/worklist seeded from `entries[i].1` (the Vec), pushing each
   resolved supertype's own supertypes:

```rust
let mut methods = entries[i].0.methods.clone();
let mut properties = entries[i].0.properties.clone();
let mut visited = vec![i];
let mut worklist: Vec<String> = entries[i].1.clone();
while let Some(super_name) = worklist.pop() {
    let Some(&si) = index.get(&simple_key(&super_name)) else { continue };
    if visited.contains(&si) {
        continue;
    }
    visited.push(si);
    for method in &entries[si].0.methods {
        if !methods.iter().any(|e| e.name.eq_ignore_ascii_case(&method.name)) {
            methods.push(method.clone());
        }
    }
    for property in &entries[si].0.properties {
        if !properties.iter().any(|e| e.name.eq_ignore_ascii_case(&property.name)) {
            properties.push(property.clone());
        }
    }
    worklist.extend(entries[si].1.clone());
}
```

The existing `parse_org_types_maps_symbol_table_records` test (single-parent
`PremiumAccountService` inherits `save`) MUST still pass.

### New test (inline records, no fixture edit)

```rust
#[test]
fn parse_org_types_flattens_implemented_interface_members() {
    let records = vec![
        serde_json::json!({
            "Name": "Payable",
            "SymbolTable": {
                "name": "Payable",
                "methods": [{ "name": "pay", "returnType": "void", "modifiers": [] }]
            }
        }),
        serde_json::json!({
            "Name": "Invoice",
            "SymbolTable": {
                "name": "Invoice",
                "interfaces": ["Payable"],
                "methods": [{ "name": "total", "returnType": "Decimal", "modifiers": [] }]
            }
        }),
    ];
    let types = parse_org_types(&records);
    let invoice = types.iter().find(|t| t.name == "Invoice").expect("Invoice");
    assert!(invoice.methods.iter().any(|m| m.name == "total"), "own method");
    assert!(invoice.methods.iter().any(|m| m.name == "pay"), "interface method");
}
```

Commit: `feat(apex-lang): flatten implemented-interface members into org types`

---

## Final report (REQUIRED, end of run)

Print `git log --oneline 0f913e6..HEAD` and confirm all three commits landed,
plus the result of the three verification commands. If any task is BLOCKED, roll
back its uncommitted files and report which commits DID land.
