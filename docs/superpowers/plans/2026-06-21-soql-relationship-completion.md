# SOQL Relationship Completion + WHERE Operator Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SOQL completion and diagnostics resolve multi-hop relationship paths (`Owner.Name`, `Account.Owner.Manager.Email`) and flag type-incompatible WHERE operators.

**Architecture:** `soql-lang` stays pure and takes a resolver closure `&dyn Fn(&str) -> Option<&SObjectSchema>` (object name → schema). The `features` crate builds that resolver by fetching related-object describes via `SchemaStore::get_or_fetch`, then calls the pure functions. `desktop` is unchanged.

**Tech Stack:** Rust, tokio, sf-schema (`SObjectSchema`/`Field` with `relationship_name` + `reference_to`), sf-core `MockRunner` for tests.

---

## Key facts (read before starting)

- `Field { name, label, field_type, custom, nillable, reference_to: Vec<String>, relationship_name: Option<String>, picklist_values }`. A lookup field `OwnerId` has `relationship_name = Some("Owner")`, `reference_to = ["User"]`.
- `SObjectSchema { name, label, label_plural, key_prefix, custom, fields: Vec<Field>, child_relationships }`, with method `schema.field(name) -> Option<&Field>`.
- Lexer: `=`,`<`,`>`,`!` each become a single `TokenKind::Other` token (`<=` is two adjacent `Other`s). `LIKE`/`IN` are `Keyword`. `INCLUDES`/`EXCLUDES` are `Ident` (not in the keyword set).
- **Resolver lifetime**: the param MUST be written `resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>` with the root `schema: &'a SObjectSchema` sharing `'a`. The explicit output lifetime stops the input `&str` from binding the output. Callers that don't traverse pass `&|_| None`.

---

## Task 1: `relationship_chain_at` (soql-lang, pure)

**Files:**
- Modify: `crates/soql-lang/src/complete.rs` (add fn + tests)
- Modify: `crates/soql-lang/src/lib.rs` (re-export)

- [ ] **Step 1: Write the failing tests** — add to the `tests` module in `complete.rs`:

```rust
    #[test]
    fn chain_single_hop() {
        assert_eq!(relationship_chain_at("SELECT Owner.Ma", "SELECT Owner.Ma".len()), vec!["Owner"]);
    }

    #[test]
    fn chain_multi_hop_empty_partial() {
        let input = "SELECT Account.Owner.";
        assert_eq!(relationship_chain_at(input, input.len()), vec!["Account", "Owner"]);
    }

    #[test]
    fn chain_plain_field_is_empty() {
        assert_eq!(relationship_chain_at("SELECT Na", "SELECT Na".len()), Vec::<String>::new());
    }

    #[test]
    fn chain_in_where_clause() {
        let input = "SELECT Id FROM Account WHERE Owner.Na";
        assert_eq!(relationship_chain_at(input, input.len()), vec!["Owner"]);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p soql-lang chain_ 2>&1 | tail -5`
Expected: FAIL — `cannot find function relationship_chain_at`.

- [ ] **Step 3: Implement** — add to `complete.rs` (after `partial_at`):

```rust
/// The relationship segments of a dotted path immediately before the cursor's
/// partial. `SELECT Account.Owner.Ma|` → `["Account","Owner"]`; `SELECT Na|` → `[]`.
/// Purely lexical, so it is clause-independent (works in SELECT and WHERE).
pub fn relationship_chain_at(input: &str, cursor: usize) -> Vec<String> {
    let bytes = input.as_bytes();
    let is_ident = |c: u8| (c as char).is_ascii_alphanumeric() || c == b'_';
    // Skip the trailing partial.
    let mut pos = cursor;
    while pos > 0 && is_ident(bytes[pos - 1]) {
        pos -= 1;
    }
    let mut segments: Vec<String> = Vec::new();
    // Each preceding `.<ident>` contributes one segment (innermost first).
    while pos > 0 && bytes[pos - 1] == b'.' {
        pos -= 1; // consume '.'
        let end = pos;
        while pos > 0 && is_ident(bytes[pos - 1]) {
            pos -= 1;
        }
        if pos == end {
            break; // a dot with no identifier before it
        }
        segments.push(input[pos..end].to_string());
    }
    segments.reverse();
    segments
}
```

- [ ] **Step 4: Re-export** — in `lib.rs`, change the complete re-export line to:

```rust
pub use complete::{clause_at, complete, relationship_chain_at, Candidate, CandidateKind, Clause};
```

- [ ] **Step 5: Run to verify pass**

Run: `cargo test -p soql-lang chain_ 2>&1 | tail -5`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add crates/soql-lang/src/complete.rs crates/soql-lang/src/lib.rs
git commit -m "feat(soql-lang): relationship_chain_at — dotted path segments at cursor"
```

---

## Task 2: `complete` resolver + multi-hop traversal + relationship candidates (soql-lang)

**Files:**
- Modify: `crates/soql-lang/src/complete.rs`

- [ ] **Step 1: Write the failing tests** — add to the `tests` module. Add a `user_schema()` helper and a resolver-backed test plus a relationship-candidate test:

```rust
    fn user_schema() -> SObjectSchema {
        SObjectSchema {
            name: "User".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), field("Email"), field("ManagerId")],
            child_relationships: vec![],
        }
    }

    #[test]
    fn completes_related_object_fields_single_hop() {
        let account = account_schema();
        let mut map = std::collections::HashMap::new();
        map.insert("User".to_string(), user_schema());
        let resolve = |name: &str| map.get(name);
        let input = "SELECT Owner.Em FROM Account";
        let cursor = "SELECT Owner.Em".len();
        let labels: Vec<String> = complete(input, cursor, &account, &[], &resolve)
            .into_iter().map(|c| c.label).collect();
        assert!(labels.contains(&"Email".to_string()), "{labels:?}");
        assert!(!labels.contains(&"Industry".to_string()), "no root fields: {labels:?}");
    }

    #[test]
    fn unresolvable_hop_yields_no_candidates() {
        let account = account_schema();
        let resolve = |_: &str| None;
        let input = "SELECT Owner.Em FROM Account";
        let cursor = "SELECT Owner.Em".len();
        assert!(complete(input, cursor, &account, &[], &resolve).is_empty());
    }

    #[test]
    fn offers_relationship_names_at_root() {
        // account_schema has OwnerId with relationship_name "Owner".
        let mut schema = account_schema();
        schema.fields[3].relationship_name = Some("Owner".to_string());
        schema.fields[3].reference_to = vec!["User".to_string()];
        let input = "SELECT  FROM Account";
        let cursor = "SELECT ".len();
        let cands = complete(input, cursor, &schema, &[], &|_| None);
        assert!(cands.iter().any(|c| c.label == "Owner" && c.kind == CandidateKind::Relationship), "{cands:?}");
    }
```

Then update **every existing** call in this file's tests to add the `&|_| None` argument (lines that call `complete(input, cursor, &schema, ...)` / `complete(input, cursor, &schema, &objects)`): append `, &|_| None` before the closing paren. There are 11 such calls in the existing tests.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p soql-lang --lib complete 2>&1 | tail -15`
Expected: FAIL — arity mismatch on `complete` (compile error) until Step 3.

- [ ] **Step 3: Implement** — replace the `complete` fn and add two helpers in `complete.rs`:

```rust
/// Walk a relationship chain from `schema`, returning the final hop's schema.
fn resolve_chain<'a>(
    schema: &'a SObjectSchema,
    chain: &[String],
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Option<&'a SObjectSchema> {
    let mut cur = schema;
    for seg in chain {
        let field = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = field.reference_to.first()?;
        cur = resolve(target)?;
    }
    Some(cur)
}

/// Push every field (as `Field`) and every relationship name (as `Relationship`).
fn push_fields_and_relationships(candidates: &mut Vec<Candidate>, schema: &SObjectSchema) {
    for field in &schema.fields {
        push_candidate(candidates, field.name.clone(), CandidateKind::Field, None);
        if let Some(rel) = &field.relationship_name {
            push_candidate(candidates, rel.clone(), CandidateKind::Relationship, None);
        }
    }
}

/// Produce context-aware completions for `input` at `cursor`.
///
/// Pure: reads `schema`, `objects`, and `resolve` (object name → schema, used to
/// traverse relationship paths). Callers without related schemas pass `&|_| None`.
pub fn complete<'a>(
    input: &str,
    cursor: usize,
    schema: &'a SObjectSchema,
    objects: &[String],
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Vec<Candidate> {
    let o = outline(input);
    let clause = clause_at(&o, input, cursor);
    let partial = partial_at(input, cursor);
    let chain = relationship_chain_at(input, cursor);
    let mut candidates = Vec::new();

    // A dotted path completes against the related object, in any clause.
    if !chain.is_empty() {
        if let Some(target) = resolve_chain(schema, &chain, resolve) {
            push_fields_and_relationships(&mut candidates, target);
        }
        return finish_candidates(candidates, partial);
    }

    match clause {
        Clause::Select | Clause::Where | Clause::OrderBy | Clause::GroupBy | Clause::Having => {
            push_fields_and_relationships(&mut candidates, schema);
            for function in SOQL_FUNCTIONS {
                push_candidate(&mut candidates, *function, CandidateKind::Function, None);
            }
            for keyword in keyword_candidates_for(clause) {
                push_candidate(&mut candidates, *keyword, CandidateKind::Keyword, None);
            }
        }
        Clause::From => {
            if from_object_named(input, cursor, partial) {
                for keyword in ["WHERE", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET"] {
                    push_candidate(&mut candidates, keyword, CandidateKind::Keyword, None);
                }
            } else {
                for object in objects {
                    push_candidate(&mut candidates, object.clone(), CandidateKind::Object, None);
                }
            }
        }
        Clause::None => {
            for keyword in keyword_candidates_for(clause) {
                push_candidate(&mut candidates, *keyword, CandidateKind::Keyword, None);
            }
        }
        Clause::Limit | Clause::Offset => {}
    }

    finish_candidates(candidates, partial)
}
```

Note: the old `complete` had an inline field-push loop in the field arm; it is now replaced by `push_fields_and_relationships`. Remove the old inline loop.

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p soql-lang --lib 2>&1 | tail -8`
Expected: PASS (all complete.rs tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add crates/soql-lang/src/complete.rs
git commit -m "feat(soql-lang): multi-hop relationship completion + relationship candidates"
```

---

## Task 3: `where_conditions` parser (soql-lang, pure)

**Files:**
- Modify: `crates/soql-lang/src/parse.rs`
- Modify: `crates/soql-lang/src/lib.rs` (re-export)

- [ ] **Step 1: Write the failing tests** — add to the `tests` module in `parse.rs`:

```rust
    #[test]
    fn extracts_simple_condition() {
        let c = where_conditions("SELECT Id FROM Account WHERE Name = 'x'");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].field.name, "Name");
        assert_eq!(c[0].op, "=");
    }

    #[test]
    fn extracts_dotted_field_and_two_char_op() {
        let c = where_conditions("SELECT Id FROM Account WHERE Owner.Age >= 18");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].field.name, "Owner.Age");
        assert_eq!(c[0].op, ">=");
    }

    #[test]
    fn extracts_like_and_and() {
        let c = where_conditions("SELECT Id FROM Account WHERE Name LIKE 'a%' AND Industry = 'Tech'");
        let pairs: Vec<(&str, &str)> = c.iter().map(|x| (x.field.name.as_str(), x.op.as_str())).collect();
        assert_eq!(pairs, vec![("Name", "LIKE"), ("Industry", "=")]);
    }

    #[test]
    fn stops_at_order_by() {
        let c = where_conditions("SELECT Id FROM Account WHERE Amount > 1 ORDER BY Name");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].op, ">");
    }

    #[test]
    fn no_where_no_conditions() {
        assert!(where_conditions("SELECT Id FROM Account").is_empty());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p soql-lang where_ 2>&1 | tail -5`
Expected: FAIL — `cannot find function where_conditions`.

- [ ] **Step 3: Implement** — add to `parse.rs`:

```rust
/// A WHERE condition: a (possibly dotted) field, an operator, and the operator span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Condition {
    pub field: FieldRef,
    pub op: String,
    pub op_start: usize,
    pub op_end: usize,
}

/// Recognized comparison operators built from one or two `Other` tokens.
fn comparison_op(s: &str) -> bool {
    matches!(s, "=" | "!=" | "<>" | "<" | ">" | "<=" | ">=")
}

/// Extract `field operator …` conditions from the WHERE clause (best-effort, never panics).
/// Operators: `= != <> < > <= >=`, keyword `LIKE`/`IN`, ident `INCLUDES`/`EXCLUDES`.
pub fn where_conditions(input: &str) -> Vec<Condition> {
    let toks: Vec<_> = lex(input)
        .into_iter()
        .filter(|t| t.kind != TokenKind::Whitespace)
        .collect();

    // Locate the WHERE keyword; bound the scan at the next top-level clause keyword.
    let Some(where_i) = toks.iter().position(|t| {
        t.kind == TokenKind::Keyword && t.text.eq_ignore_ascii_case("WHERE")
    }) else {
        return Vec::new();
    };
    let stop = ["GROUP", "ORDER", "LIMIT", "OFFSET", "HAVING", "WITH", "FOR"];
    let end = toks[where_i + 1..]
        .iter()
        .position(|t| t.kind == TokenKind::Keyword && stop.iter().any(|s| t.text.eq_ignore_ascii_case(s)))
        .map(|p| where_i + 1 + p)
        .unwrap_or(toks.len());

    let mut out = Vec::new();
    let mut i = where_i + 1;
    while i < end {
        // A field path: Ident (Dot Ident)*.
        if toks[i].kind != TokenKind::Ident {
            i += 1;
            continue;
        }
        let start = toks[i].start;
        let mut last_end = toks[i].end;
        let mut name = toks[i].text.clone();
        i += 1;
        while i + 1 < end && toks[i].kind == TokenKind::Dot && toks[i + 1].kind == TokenKind::Ident {
            name.push('.');
            name.push_str(&toks[i + 1].text);
            last_end = toks[i + 1].end;
            i += 2;
        }
        let field = FieldRef { name, start, end: last_end };

        // The operator immediately following the field path.
        if i >= end {
            break;
        }
        let t = &toks[i];
        if t.kind == TokenKind::Keyword && (t.text.eq_ignore_ascii_case("LIKE") || t.text.eq_ignore_ascii_case("IN")) {
            out.push(Condition { field, op: t.text.to_ascii_uppercase(), op_start: t.start, op_end: t.end });
            i += 1;
        } else if t.kind == TokenKind::Ident && (t.text.eq_ignore_ascii_case("INCLUDES") || t.text.eq_ignore_ascii_case("EXCLUDES")) {
            out.push(Condition { field, op: t.text.to_ascii_uppercase(), op_start: t.start, op_end: t.end });
            i += 1;
        } else if t.kind == TokenKind::Other {
            // Join up to two adjacent `Other` tokens into the operator text.
            let mut op = t.text.clone();
            let op_start = t.start;
            let mut op_end = t.end;
            if i + 1 < end && toks[i + 1].kind == TokenKind::Other && toks[i + 1].start == op_end {
                let joined = format!("{op}{}", toks[i + 1].text);
                if comparison_op(&joined) {
                    op = joined;
                    op_end = toks[i + 1].end;
                    i += 1;
                }
            }
            if comparison_op(&op) {
                out.push(Condition { field, op, op_start, op_end });
            }
            i += 1;
        }
        // else: not an operator (e.g. a bare keyword) — skip and resume scanning.
    }
    out
}
```

- [ ] **Step 4: Re-export** — in `lib.rs`, change the parse re-export to:

```rust
pub use parse::{outline, where_conditions, Condition, FieldRef, SoqlOutline};
```

- [ ] **Step 5: Run to verify pass**

Run: `cargo test -p soql-lang where_ 2>&1 | tail -5`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add crates/soql-lang/src/parse.rs crates/soql-lang/src/lib.rs
git commit -m "feat(soql-lang): where_conditions — field/operator extraction"
```

---

## Task 4: `diagnostics` resolver + dotted unknown-field + operator checks (soql-lang)

**Files:**
- Modify: `crates/soql-lang/src/diagnostics.rs`

- [ ] **Step 1: Write the failing tests** — add a `user_schema()` helper (same shape as Task 2, with fields `Id`, `Email`, `Age` where `Age` has `field_type: "double"`) and these tests; also append `, &|_| None` to the 4 existing `diagnostics(input, &schema)` calls in this file's tests:

```rust
    fn user_schema() -> SObjectSchema {
        let mut age = field("Age");
        age.field_type = "double".to_string();
        SObjectSchema {
            name: "User".to_string(),
            label: String::new(),
            label_plural: String::new(),
            key_prefix: None,
            custom: false,
            fields: vec![field("Id"), field("Email"), age],
            child_relationships: vec![],
        }
    }

    fn account_with_owner() -> SObjectSchema {
        let mut s = account_schema();
        s.fields[3].relationship_name = Some("Owner".to_string()); // OwnerId
        s.fields[3].reference_to = vec!["User".to_string()];
        s
    }

    fn user_resolver() -> impl Fn(&str) -> Option<&'static SObjectSchema> {
        // leak a static so the closure can return a 'static ref in tests
        let boxed: &'static SObjectSchema = Box::leak(Box::new(user_schema()));
        move |name: &str| if name == "User" { Some(boxed) } else { None }
    }

    #[test]
    fn flags_unknown_dotted_field_via_resolver() {
        let schema = account_with_owner();
        let resolve = user_resolver();
        let input = "SELECT Owner.Bogus FROM Account";
        let diags = diagnostics(input, &schema, &resolve);
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert!(diags[0].message.contains("Bogus"));
    }

    #[test]
    fn known_dotted_field_clean() {
        let schema = account_with_owner();
        let resolve = user_resolver();
        assert!(diagnostics("SELECT Owner.Email FROM Account", &schema, &resolve).is_empty());
    }

    #[test]
    fn flags_like_on_number() {
        let schema = account_with_owner();
        let resolve = user_resolver();
        let input = "SELECT Id FROM Account WHERE Owner.Age LIKE 'x'";
        let diags = diagnostics(input, &schema, &resolve);
        assert!(diags.iter().any(|d| d.message.contains("LIKE")), "{diags:?}");
    }

    #[test]
    fn like_on_string_clean() {
        let schema = account_schema();
        assert!(diagnostics("SELECT Id FROM Account WHERE Name LIKE 'a%'", &schema, &|_| None).is_empty());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p soql-lang --lib diagnostics 2>&1 | tail -10`
Expected: FAIL — arity mismatch on `diagnostics` until Step 3.

- [ ] **Step 3: Implement** — replace the body of `diagnostics.rs` (keep `Severity`/`Diagnostic` structs) with:

```rust
use crate::parse::{outline, where_conditions};
use sf_schema::SObjectSchema;

// (Severity and Diagnostic struct definitions stay unchanged above this point.)

/// Text-ish field types `LIKE` is valid against.
fn is_text_type(t: &str) -> bool {
    matches!(
        t.to_ascii_lowercase().as_str(),
        "string" | "picklist" | "multipicklist" | "textarea" | "email"
            | "phone" | "url" | "combobox" | "reference" | "id" | "encryptedstring"
    )
}

/// Resolve a (possibly dotted) field path to its `Field`, walking relationships via `resolve`.
/// Returns `None` if any hop or the final field cannot be resolved.
fn resolve_field<'a>(
    schema: &'a SObjectSchema,
    path: &str,
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Option<&'a sf_schema::model::Field> {
    let segs: Vec<&str> = path.split('.').collect();
    let mut cur = schema;
    for seg in &segs[..segs.len() - 1] {
        let rel = cur.fields.iter().find(|f| {
            f.relationship_name.as_deref().is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = rel.reference_to.first()?;
        cur = resolve(target)?;
    }
    cur.field(segs[segs.len() - 1])
}

/// Final object name a dotted path lands on (for messages). `None` if unresolved.
fn resolve_object<'a>(
    schema: &'a SObjectSchema,
    segs: &[&str],
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Option<&'a SObjectSchema> {
    let mut cur = schema;
    for seg in segs {
        let rel = cur.fields.iter().find(|f| {
            f.relationship_name.as_deref().is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = rel.reference_to.first()?;
        cur = resolve(target)?;
    }
    Some(cur)
}

/// SELECT unknown-field + WHERE operator/type diagnostics.
///
/// Pure: reads `schema` and `resolve` (object name → schema). With `&|_| None`,
/// dotted fields are skipped and no operator checks run (legacy behavior).
pub fn diagnostics<'a>(
    input: &str,
    schema: &'a SObjectSchema,
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
) -> Vec<Diagnostic> {
    let o = outline(input);
    if o.from_object.is_none() {
        return Vec::new();
    }
    let mut diags = Vec::new();

    // 1. Unknown SELECT fields (dotted paths resolved through relationships).
    for f in &o.select_fields {
        if f.name == "*" {
            continue;
        }
        if f.name.contains('.') {
            let segs: Vec<&str> = f.name.split('.').collect();
            // Skip when the relationship chain cannot be resolved (no false positive).
            if resolve_object(schema, &segs[..segs.len() - 1], resolve).is_none() {
                continue;
            }
            if resolve_field(schema, &f.name, resolve).is_none() {
                let last = segs[segs.len() - 1];
                let obj = resolve_object(schema, &segs[..segs.len() - 1], resolve)
                    .map(|s| s.name.as_str())
                    .unwrap_or("");
                diags.push(Diagnostic {
                    message: format!("Unknown field '{last}' on {obj}"),
                    start: f.start,
                    end: f.end,
                    severity: Severity::Error,
                });
            }
        } else if schema.field(&f.name).is_none() {
            diags.push(Diagnostic {
                message: format!("Unknown field '{}' on {}", f.name, schema.name),
                start: f.start,
                end: f.end,
                severity: Severity::Error,
            });
        }
    }

    // 2. WHERE operator vs field type (conservative — only SF-illegal combos).
    for c in where_conditions(input) {
        let Some(field) = resolve_field(schema, &c.field.name, resolve) else {
            continue;
        };
        let t = field.field_type.to_ascii_lowercase();
        let bad = match c.op.as_str() {
            "LIKE" => !is_text_type(&t),
            "<" | ">" | "<=" | ">=" => t == "boolean",
            "INCLUDES" | "EXCLUDES" => t != "multipicklist",
            _ => false,
        };
        if bad {
            diags.push(Diagnostic {
                message: format!("Operator {} is not valid for {} field '{}'", c.op, t, c.field.name),
                start: c.op_start,
                end: c.op_end,
                severity: Severity::Error,
            });
        }
    }

    diags
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p soql-lang --lib diagnostics 2>&1 | tail -10`
Expected: PASS (existing 4 + new 4).

- [ ] **Step 5: Commit**

```bash
git add crates/soql-lang/src/diagnostics.rs
git commit -m "feat(soql-lang): dotted unknown-field + WHERE operator/type diagnostics"
```

---

## Task 5: features `complete_fields` builds the resolver (IO)

**Files:**
- Modify: `crates/features/src/soql.rs`

- [ ] **Step 1: Write the failing test** — add to the `tests` module in `soql.rs`. It uses a `MockRunner` that returns the Account describe, then the User describe, on successive `sobject describe` calls. Model it on the existing `complete_fields_returns_select_field_labels` test. Minimal describe JSON:

```rust
    #[tokio::test]
    async fn complete_fields_traverses_relationship() {
        use std::sync::{Arc, Mutex};
        let calls: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
        let calls2 = calls.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            // Return Account first (has Owner→User), then User (has Email).
            let body = if args.iter().any(|a| a == "User") {
                r#"{"name":"User","label":"","labelPlural":"","custom":false,"fields":[{"name":"Email","label":"","type":"string","custom":false,"nillable":true,"referenceTo":[],"relationshipName":null,"picklistValues":[]}],"childRelationships":[]}"#
            } else {
                r#"{"name":"Account","label":"","labelPlural":"","custom":false,"fields":[{"name":"OwnerId","label":"","type":"reference","custom":false,"nillable":true,"referenceTo":["User"],"relationshipName":"Owner","picklistValues":[]}],"childRelationships":[]}"#
            };
            *calls2.lock().unwrap() += 1;
            Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-rel-complete-{}", std::process::id()));
        let q = "SELECT Owner.Em FROM Account";
        let cursor = "SELECT Owner.Em".len();
        let got = complete_fields(&invoker, &dir, "myorg", q, cursor, &[]).await;
        let labels: Vec<String> = got.into_iter().map(|c| c.label).collect();
        assert!(labels.contains(&"Email".to_string()), "{labels:?}");
    }
```

(Check the existing test's describe-JSON field casing — the real `SObjectSchema` derives use serde rename for `labelPlural`/`referenceTo`/`relationshipName`/`childRelationships`/`type`. Reuse whatever the existing passing test uses; copy its JSON shape verbatim and just swap names/relationships.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p features complete_fields_traverses 2>&1 | tail -8`
Expected: FAIL — `Email` not present (current code completes only Account's fields).

- [ ] **Step 3: Implement** — replace `complete_fields` and add `resolve_related` in `soql.rs`:

```rust
/// Follow `chain` from `root`, fetching each hop's target object schema into a
/// map keyed by object name. Stops at the first hop that cannot be resolved.
async fn resolve_related(
    store: &mut sf_schema::SchemaStore,
    invoker: &SfInvoker,
    api: &str,
    root: &sf_schema::SObjectSchema,
    chain: &[String],
) -> std::collections::HashMap<String, sf_schema::SObjectSchema> {
    let mut map = std::collections::HashMap::new();
    let mut cur = root.clone();
    for seg in chain {
        let Some(field) = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        }) else {
            break;
        };
        let Some(target) = field.reference_to.first().cloned() else {
            break;
        };
        let Ok(schema) = store.get_or_fetch(invoker, api, &target).await else {
            break;
        };
        map.insert(target, schema.clone());
        cur = schema;
    }
    map
}

pub async fn complete_fields(
    invoker: &SfInvoker,
    root: impl Into<PathBuf>,
    org_id: &str,
    query: &str,
    cursor: usize,
    objects: &[String],
) -> Vec<soql_lang::Candidate> {
    let object = soql_lang::outline(query).from_object;
    let mut store = sf_schema::SchemaStore::new(root, org_id);
    let Some(object) = object else {
        return soql_lang::complete(query, cursor, &empty_schema(), objects, &|_| None);
    };
    let api = crate::api_version::api_version_for(invoker, org_id).await;
    let root_schema = store
        .get_or_fetch(invoker, &api, &object)
        .await
        .unwrap_or_else(|_| empty_schema());
    let chain = soql_lang::relationship_chain_at(query, cursor);
    let map = resolve_related(&mut store, invoker, &api, &root_schema, &chain).await;
    soql_lang::complete(query, cursor, &root_schema, objects, &|name| map.get(name))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p features complete_fields 2>&1 | tail -8`
Expected: PASS (new test + existing `complete_fields_*`).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/soql.rs
git commit -m "feat(features): complete_fields resolves relationship-path schemas"
```

---

## Task 6: features `soql_query_diagnostics` builds the resolver (IO)

**Files:**
- Modify: `crates/features/src/soql.rs`

- [ ] **Step 1: Write the failing test** — add to the `tests` module:

```rust
    #[tokio::test]
    async fn diagnose_flags_unknown_dotted_field() {
        use std::sync::Arc;
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            let body = if args.iter().any(|a| a == "User") {
                r#"{"name":"User","label":"","labelPlural":"","custom":false,"fields":[{"name":"Email","label":"","type":"string","custom":false,"nillable":true,"referenceTo":[],"relationshipName":null,"picklistValues":[]}],"childRelationships":[]}"#
            } else {
                r#"{"name":"Account","label":"","labelPlural":"","custom":false,"fields":[{"name":"OwnerId","label":"","type":"reference","custom":false,"nillable":true,"referenceTo":["User"],"relationshipName":"Owner","picklistValues":[]}],"childRelationships":[]}"#
            };
            Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-rel-diag-{}", std::process::id()));
        let diags = diagnose(&invoker, &dir, "myorg", "SELECT Owner.Bogus FROM Account").await;
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert!(diags[0].message.contains("Bogus"));
    }
```

(Confirm `diagnose` returns `Vec<SoqlDiagnostic>` with a `message` field — it does; adjust if the public return type differs.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p features diagnose_flags_unknown_dotted 2>&1 | tail -8`
Expected: FAIL — 0 diagnostics (dotted fields currently skipped).

- [ ] **Step 3: Implement** — replace `soql_query_diagnostics` in `soql.rs`:

```rust
/// Diagnose ONE SOQL string against its FROM describe + any relationship targets
/// referenced by dotted fields. Empty when no FROM / describe fails.
async fn soql_query_diagnostics(
    store: &mut sf_schema::SchemaStore,
    invoker: &SfInvoker,
    api: &str,
    query: &str,
) -> Vec<soql_lang::Diagnostic> {
    let outline = soql_lang::outline(query);
    let Some(object) = outline.from_object else {
        return Vec::new();
    };
    let Ok(root_schema) = store.get_or_fetch(invoker, api, &object).await else {
        return Vec::new();
    };

    // Collect dotted paths (SELECT + WHERE) and fetch their relationship targets.
    let mut paths: Vec<String> = outline.select_fields.iter().map(|f| f.name.clone()).collect();
    paths.extend(soql_lang::where_conditions(query).into_iter().map(|c| c.field.name));
    let mut map: std::collections::HashMap<String, sf_schema::SObjectSchema> =
        std::collections::HashMap::new();
    for path in paths {
        let segs: Vec<&str> = path.split('.').collect();
        if segs.len() < 2 {
            continue;
        }
        let chain: Vec<String> = segs[..segs.len() - 1].iter().map(|s| s.to_string()).collect();
        let hop = resolve_related(store, invoker, api, &root_schema, &chain).await;
        map.extend(hop);
    }
    soql_lang::diagnostics(query, &root_schema, &|name| map.get(name))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p features 2>&1 | tail -8`
Expected: PASS (new test + all existing diagnose/diagnose_apex tests).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/soql.rs
git commit -m "feat(features): soql diagnostics resolve relationship-path schemas"
```

---

## Task 7: update remaining call sites + e2e + full verification

**Files:**
- Modify: `crates/features/src/apex_complete.rs:131`
- Modify: `crates/soql-lang/tests/e2e.rs`

- [ ] **Step 1: Fix the inline-SOQL-in-apex call** — in `apex_complete.rs` line ~131, change:

```rust
let fields = soql_lang::complete(inner, rel_cursor, &schema, &[]);
```
to:
```rust
let fields = soql_lang::complete(inner, rel_cursor, &schema, &[], &|_| None);
```

- [ ] **Step 2: Update + extend the soql-lang e2e** — in `crates/soql-lang/tests/e2e.rs`, add `, &|_| None` to the existing `complete(...)` and `diagnostics(...)` calls, and add a new ignored relationship test:

```rust
#[tokio::test]
#[ignore]
async fn relationship_completion_against_real_account() {
    use std::collections::HashMap;
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    let account = sf_schema::describe_object(&invoker, "default", "Account").await.expect("Account");
    let user = sf_schema::describe_object(&invoker, "default", "User").await.expect("User");
    let mut map = HashMap::new();
    map.insert("User".to_string(), user);
    let input = "SELECT Owner. FROM Account";
    let cursor = "SELECT Owner.".len();
    let labels: Vec<String> = complete(input, cursor, &account, &[], &|n| map.get(n))
        .into_iter().map(|c| c.label).collect();
    assert!(labels.iter().any(|l| l == "Email" || l == "Username"), "User fields: {labels:?}");
}
```

- [ ] **Step 3: Full workspace verification**

Run: `cargo test --workspace 2>&1 | tail -6`
Expected: all pass, ignored count increased by the new e2e test.

Run: `cargo clippy --workspace --all-targets -- -D warnings 2>&1 | tail -5`
Expected: no warnings.

Run: `cargo fmt --check 2>&1 | tail -3 && echo fmt-clean`
Expected: `fmt-clean`.

- [ ] **Step 4: Commit**

```bash
git add crates/features/src/apex_complete.rs crates/soql-lang/tests/e2e.rs
git commit -m "test(soql): relationship completion e2e + update call sites"
```

---

## Self-review notes

- **Spec coverage:** Unit1→Task1, Unit2→Task2, Unit3(where_conditions)→Task3, Unit4(diagnostics)→Task4, Unit5(features)→Tasks 5-6, Unit6(desktop)→no change (verified by Task 7 workspace build). All covered.
- **Type consistency:** `resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>` is identical across `complete`, `diagnostics`, `resolve_chain`, `resolve_field`, `resolve_object`. `Condition` fields (`field`,`op`,`op_start`,`op_end`) match between Task 3 (definition) and Tasks 4/6 (use).
- **Closure coercion:** if `&|_| None` fails type inference at any call site, write `&(|_: &str| None)`. The resolver in features is `&|name| map.get(name)` where `map: HashMap<String, SObjectSchema>`.
- **Polymorphic refs:** `reference_to.first()` only — documented limitation, matches spec.
