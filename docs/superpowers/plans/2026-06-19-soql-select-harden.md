# soql-select-harden: stop false-flagging functions/aliases in SOQL SELECT — Implementation Plan

> The shipped SOQL diagnostic false-flags `SELECT COUNT(Id) FROM Account` — `outline` collects EVERY
> ident in the SELECT region, so `COUNT` (and `toLabel`, `FORMAT`, `MIN`/`MAX`/`SUM`, aliases…) get
> reported as "unknown field". Harden `outline` to collect a field only at a SELECT-item start position
> and only when it is NOT a function call. Pure `soql-lang` change. This protects the zero-false-positive
> guarantee the diagnostics feature was built on.

## Goal

A SELECT item is `expr [alias]`, comma-separated. Only the FIRST token of an item, when it is an
identifier NOT immediately followed by `(`, is a field reference (possibly a dotted run). Function-call
names, function arguments, and trailing aliases are no longer collected — so they can never be flagged.
Strictly REDUCES what `select_fields` contains (never adds) → strictly fewer diagnostics, never more.

## Scope (MVP) / YAGNI

- IN: `outline`'s SELECT-field extraction tracks item-start (after `SELECT` / after a `,`); skips an
  item whose first ident is a function call (`ident (`); skips alias idents (any ident not at item
  start). Dotted runs at item start still captured (`Owner.Name`).
- OUT: validating function arguments (`COUNT(Bogus)` → `Bogus` no longer checked — benign miss);
  subquery handling (pre-existing limitation, unchanged); WHERE/ORDER BY field validation.

## Global Constraints

- Rust 2021. `soql-lang` pure. No new crates. TDD. Gates: `cargo test -p soql-lang`,
  `cargo test -p features` (diagnostics consumers), `cargo clippy --workspace -- -D warnings`,
  `cargo fmt --check` (exit-code-checked — [[sf-toolkit-fmt-gate]]). English; conventional commits. No
  branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `crates/soql-lang/src/parse.rs` `outline(input) -> SoqlOutline { from_object, select_fields }`. Current
  loop: filters out `Whitespace`; on `Keyword SELECT` sets `in_select=true`; on `Keyword FROM` sets
  `expect_from_object=true`; an `Ident` while `in_select` is collected as a dotted run via
  `Ident (Dot Ident)*`; a `_` arm clears `expect_from_object`. There is NO item-start / comma / function
  awareness today — every SELECT-region ident is collected.
- `crates/soql-lang/src/lexer.rs` `TokenKind` = `{ Keyword, Ident, Comma, Dot, LParen, RParen, Star,
  Whitespace, Other }`. `SELECT *` lexes `*` as `Star` (never an Ident → never a select field).
  Keywords (`ASC`/`DESC`/`NULLS`/…) lex as `Keyword`, not `Ident`.
- `crates/soql-lang/src/diagnostics.rs` `diagnostics(input, &schema)` filters `select_fields` by
  `name != "*" && !name.contains('.') && schema.field(name).is_none()`. It is the only consumer that
  depends on the exact `select_fields` contents. `complete.rs`/`clause_at` use `outline().from_object`
  (verify complete tests stay green — do not change `from_object` behavior).
- Existing parse tests `outlines_simple_query` (Id, Name), `outlines_dotted_field` (Owner.Name),
  `outline_without_from` MUST stay green.

---

### Task 1: item-start-aware SELECT field extraction (RED first)

**Files:** `crates/soql-lang/src/parse.rs`, `crates/soql-lang/src/diagnostics.rs`.

- [ ] **Step 1: failing tests** — add to parse.rs tests:
  ```rust
  #[test]
  fn aggregate_function_is_not_a_field() {
      let o = outline("SELECT COUNT(Id) FROM Account");
      assert_eq!(o.from_object.as_deref(), Some("Account"));
      let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
      assert!(names.is_empty(), "function name/args must not be collected, got {names:?}");
  }

  #[test]
  fn alias_is_not_a_field() {
      let o = outline("SELECT Name n, Id FROM Account");
      let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
      assert_eq!(names, vec!["Name", "Id"]); // alias `n` skipped
  }

  #[test]
  fn function_then_real_field() {
      let o = outline("SELECT toLabel(Status), Name FROM Case");
      let names: Vec<&str> = o.select_fields.iter().map(|f| f.name.as_str()).collect();
      assert_eq!(names, vec!["Name"]); // toLabel + its arg skipped; Name kept
  }
  ```
  and to diagnostics.rs tests (regression — the shipped false positive):
  ```rust
  #[test]
  fn aggregate_function_no_false_diagnostic() {
      let schema = account_schema();
      assert!(diagnostics("SELECT COUNT(Id) FROM Account", &schema).is_empty());
  }
  ```

- [ ] **Step 2: run → fail** (`COUNT`/`n`/`toLabel`/`Status` collected today).

- [ ] **Step 3: implement** — rewrite the `outline` loop to track item-start:
  ```rust
  pub fn outline(input: &str) -> SoqlOutline {
      let toks: Vec<_> = lex(input)
          .into_iter()
          .filter(|t| t.kind != TokenKind::Whitespace)
          .collect();

      let mut out = SoqlOutline::default();
      let mut in_select = false;
      let mut expect_from_object = false;
      let mut at_item_start = false;
      let mut i = 0;

      while i < toks.len() {
          let t = &toks[i];
          match t.kind {
              TokenKind::Keyword if t.text.eq_ignore_ascii_case("SELECT") => {
                  in_select = true;
                  expect_from_object = false;
                  at_item_start = true;
                  i += 1;
              }
              TokenKind::Keyword if t.text.eq_ignore_ascii_case("FROM") => {
                  in_select = false;
                  at_item_start = false;
                  expect_from_object = true;
                  i += 1;
              }
              TokenKind::Ident if expect_from_object => {
                  out.from_object = Some(t.text.clone());
                  expect_from_object = false;
                  i += 1;
              }
              TokenKind::Comma if in_select => {
                  at_item_start = true;
                  i += 1;
              }
              TokenKind::Ident if in_select && at_item_start => {
                  // A function call at item start (`ident (`) is not a field — skip the whole item.
                  if toks.get(i + 1).map(|n| n.kind) == Some(TokenKind::LParen) {
                      at_item_start = false;
                      i += 1;
                  } else {
                      // Dotted field run at item start: Ident (Dot Ident)*.
                      let start = t.start;
                      let mut end = t.end;
                      let mut name = t.text.clone();
                      i += 1;
                      while i + 1 < toks.len()
                          && toks[i].kind == TokenKind::Dot
                          && toks[i + 1].kind == TokenKind::Ident
                      {
                          name.push('.');
                          name.push_str(&toks[i + 1].text);
                          end = toks[i + 1].end;
                          i += 2;
                      }
                      out.select_fields.push(FieldRef { name, start, end });
                      at_item_start = false; // trailing idents in this item (alias) are not fields
                  }
              }
              _ => {
                  expect_from_object = false;
                  at_item_start = false;
                  i += 1;
              }
          }
      }

      out
  }
  ```

- [ ] **Step 4: run → green**; then `cargo test -p soql-lang && cargo test -p features &&
  cargo clippy --workspace -- -D warnings && cargo fmt --check`.
- [ ] **Step 5: commit** `fix(soql-lang): only treat item-start non-call idents as SELECT fields`

---

## Self-Review

- **Strictly safer:** the new logic collects a subset of what it did before, so it can only REMOVE
  diagnostics — it cannot introduce a new false positive. Existing simple/dotted tests still pass.
- **Fixes a real shipped bug:** `SELECT COUNT(Id) FROM Account` no longer paints a red squiggle on
  `COUNT` (in both the SOQL panel and Apex `[SELECT…]` literals, which share this engine).
- **Benign misses:** function arguments and aliases are no longer validated — acceptable (a missed
  squiggle is harmless; a false one is not).
- **Limits:** subqueries still confuse `from_object` (pre-existing, unchanged); WHERE/ORDER BY not
  validated.

## When finished, print

```
cargo test -p soql-lang
cargo test -p features
cargo clippy --workspace -- -D warnings
cargo fmt --check
git log --oneline <BASE_SHA>..HEAD
```
