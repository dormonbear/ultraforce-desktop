# soql-in-apex: SOQL completion inside Apex `[SELECT …]` literals — Implementation Plan

> When the cursor is inside an inline `[SELECT … FROM Obj …]` SOQL literal in the Apex editor, return
> SOQL field completions (delegated to `soql-lang`) instead of Apex completions. Pure detection in
> `apex-lang`; the describe + delegation lives in `features::apex_complete`. No Tauri/React change — the
> existing `apex_complete` command + Monaco provider pick it up (the backend decides Apex vs SOQL).
> Completion-only / benign.

## Goal

`soql_lang::complete(inner, rel_cursor, &schema)` already does SOQL field completion given the FROM
object's `SObjectSchema`. Wire it in: detect the SOQL bracket region at the cursor, slice the inner
SOQL + relative cursor, resolve the FROM object's schema via `sf-schema` (disk-cached), and return the
fields. Falls back to Apex completion when not in a SOQL literal.

## Scope (MVP) / YAGNI

- IN: `[ … ]` whose trimmed content starts with `SELECT` (case-insensitive); SOQL field completion for
  the top-level FROM object. Unclosed brackets while typing (`[SELECT Na FROM Account`) handled (region
  ends at EOF). `soql-lang` only emits `Field` candidates → mapped to apex `Property` (Field icon).
- OUT: subquery/relationship-field schema resolution; bind-variable (`:apexVar`) awareness; SOQL
  diagnostics; wiring SOQL completion into the standalone SOQL panel (separate). Array indexing `arr[0]`
  is correctly NOT treated as SOQL (content doesn't start with SELECT).

## Global Constraints

- Rust 2021. `apex-lang` stays pure (the detector is pure text analysis). Describe + delegation in
  `features::apex_complete`. No lock held across `.await`. No new external crates.
- TDD per task. Gates: `cargo test -p apex-lang`, `cargo test -p features`,
  `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` (exit-code-checked — see
  [[sf-toolkit-fmt-gate]]). English; conventional commits; no author attribution. No branch/push.

## Pre-verified facts

- `soql_lang::outline(input) -> SoqlOutline { from_object: Option<String>, .. }`;
  `soql_lang::complete(input, cursor, schema: &SObjectSchema) -> Vec<soql_lang::Candidate>`;
  `soql_lang::Candidate { label: String, kind: soql_lang::CandidateKind }` where `CandidateKind` has the
  SINGLE variant `Field`. (So no clause-keyword candidates; field names only.)
- `sf_schema::SObjectSchema` does NOT derive `Default` — never construct an empty one; if there is no
  FROM object, return `vec![]` without calling `soql_lang::complete`.
- `apex_lang`: pure crate; add the detector + re-export. `features::apex_complete::ApexCompleter` has
  `root: PathBuf`, `cache`, `complete(invoker, org_id, src, cursor)`, an `ensure_base`, a
  `describe_sobject(...) -> Option<ApexType>` using `SchemaStore::new(self.root.clone(), org_id)` +
  `get_or_fetch(.., API_VERSION, name) -> Result<SObjectSchema, SfError>` (OWNED; no `.clone()`).
- `features/Cargo.toml` deps already include `apex-lang`, `sf-core`, `sf-schema`, `serde`, `serde_json`.
  Add `soql-lang = { path = "../soql-lang" }`.
- The `apex_complete` Tauri command maps `apex_lang::complete::Candidate -> dto::CandidateDto` and the
  Monaco provider renders `kind` strings; both stay unchanged (ApexCompleter still returns apex `Candidate`s).

---

### Task 1: apex-lang `soql_region_at` detector (pure) (RED first)

**Files:** modify `crates/apex-lang/src/parser.rs` (add fn) + `crates/apex-lang/src/lib.rs` (re-export).

- [ ] **Step 1: failing tests** — add to parser.rs tests:
  ```rust
  #[test]
  fn soql_region_detection() {
      // cursor inside a SOQL literal → inner range (excludes brackets)
      let s = "Account a = [SELECT Na FROM Account];";
      let cur = s.find("Na").unwrap() + 2;
      let (start, end) = soql_region_at(s, cur).expect("in soql");
      assert_eq!(&s[start..end], "SELECT Na FROM Account");

      // array indexing is NOT soql
      assert!(soql_region_at("x = arr[0];", "x = arr[0".len()).is_none());

      // outside any bracket
      assert!(soql_region_at("Integer x = 1;", 5).is_none());

      // unclosed bracket while typing → region runs to EOF
      let u = "List<Account> l = [SELECT Id FROM Acc";
      assert!(soql_region_at(u, u.len()).is_some());
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** in parser.rs:
  ```rust
  /// If `cursor` sits inside an inline SOQL literal `[SELECT …]`, return the byte range of the inner
  /// SOQL text (brackets excluded). `None` for array indexing (`arr[0]`) or outside any bracket.
  /// Tolerates an unclosed bracket (region ends at EOF) for live typing.
  pub fn soql_region_at(input: &str, cursor: usize) -> Option<(usize, usize)> {
      let cursor = cursor.min(input.len());
      let bytes = input.as_bytes();

      // Nearest enclosing '[' to the left (skip balanced ']' … '[').
      let mut depth = 0i32;
      let mut open = None;
      let mut i = cursor;
      while i > 0 {
          i -= 1;
          match bytes[i] {
              b']' => depth += 1,
              b'[' => {
                  if depth == 0 {
                      open = Some(i);
                      break;
                  }
                  depth -= 1;
              }
              _ => {}
          }
      }
      let open = open?;

      // Matching ']' at/after the open (EOF if unclosed).
      let mut depth = 0i32;
      let mut close = input.len();
      let mut j = open + 1;
      while j < input.len() {
          match bytes[j] {
              b'[' => depth += 1,
              b']' => {
                  if depth == 0 {
                      close = j;
                      break;
                  }
                  depth -= 1;
              }
              _ => {}
          }
          j += 1;
      }

      let inner = &input[open + 1..close];
      let is_soql = inner
          .trim_start()
          .get(..6)
          .is_some_and(|s| s.eq_ignore_ascii_case("select"));
      if is_soql {
          Some((open + 1, close))
      } else {
          None
      }
  }
  ```
  And in lib.rs: `pub use parser::soql_region_at;`

- [ ] **Step 4: run → green**; clippy + fmt clean (workspace).
- [ ] **Step 5: commit** `feat(apex-lang): detect inline SOQL literal region at cursor`

---

### Task 2: features — delegate SOQL completion inside the region (RED first)

**Files:** modify `crates/features/Cargo.toml` (+`soql-lang`), `crates/features/src/apex_complete.rs`.

- [ ] **Step 1: dep** — add to `crates/features/Cargo.toml` `[dependencies]`:
  `soql-lang = { path = "../soql-lang" }`.

- [ ] **Step 2: failing test** — in apex_complete.rs tests, script a single describe(Account) response
  and assert a SOQL field completes (the SOQL branch must NOT need stdlib/org-types — it short-circuits
  before `ensure_base`):
  ```rust
  #[tokio::test]
  async fn completes_soql_field_inside_apex_literal() {
      let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string"},{"name":"Industry","type":"picklist"}]}}"#;
      let runner = MockRunner::new(move |_p, _args| {
          Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
      });
      let invoker = sf_core::SfInvoker::new(Arc::new(runner));
      let dir = std::env::temp_dir().join(format!("soql-in-apex-test-{}", std::process::id()));
      let completer = ApexCompleter::new(dir.clone());

      let src = "Account a = [SELECT Na FROM Account];";
      let cursor = src.find("Na").unwrap() + 2;
      let got = completer.complete(&invoker, "myorg", src, cursor).await.unwrap();
      assert!(got.iter().any(|c| c.label == "Name"), "{got:?}");

      let _ = std::fs::remove_dir_all(&dir);
  }
  ```

- [ ] **Step 3: run → fail.**

- [ ] **Step 4: implement** in apex_complete.rs:
  - Imports: `use sf_schema::SObjectSchema;` (already importing SchemaStore).
  - At the TOP of `complete`, before `ensure_base`, short-circuit into SOQL:
    ```rust
    if let Some((s, e)) = apex_lang::soql_region_at(src, cursor) {
        return self.complete_soql(invoker, org_id, &src[s..e], cursor.saturating_sub(s)).await;
    }
    ```
  - Add the helpers:
    ```rust
    /// SOQL field completion inside an Apex `[SELECT …]` literal. Empty when there is no FROM object
    /// or its describe fails (benign).
    async fn complete_soql(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        inner: &str,
        rel_cursor: usize,
    ) -> Result<Vec<Candidate>, SfError> {
        let Some(object) = soql_lang::outline(inner).from_object else {
            return Ok(Vec::new());
        };
        let Some(schema) = self.describe_schema(invoker, org_id, &object).await else {
            return Ok(Vec::new());
        };
        let fields = soql_lang::complete(inner, rel_cursor, &schema);
        Ok(fields
            .into_iter()
            .map(|c| Candidate { label: c.label, kind: CandidateKind::Property })
            .collect())
    }

    /// Best-effort raw describe (None if not a real sObject / describe fails).
    async fn describe_schema(&self, invoker: &SfInvoker, org_id: &str, object: &str) -> Option<SObjectSchema> {
        let mut store = SchemaStore::new(self.root.clone(), org_id);
        store.get_or_fetch(invoker, API_VERSION, object).await.ok()
    }
    ```
  - Refactor `describe_sobject` to reuse `describe_schema` (no behavior change):
    `self.describe_schema(invoker, org_id, name).await.map(|s| schema_to_apex_type(&s))`.
  - Ensure `CandidateKind` is in scope (it is — used by ApexCompleter already; if not, import
    `use apex_lang::complete::{Candidate, CandidateKind};`).

- [ ] **Step 5: run → green**; then `cargo test -p apex-lang && cargo test -p features &&
  cargo clippy --workspace -- -D warnings && cargo fmt --check`.
- [ ] **Step 6: commit** `feat(features): SOQL field completion inside Apex literals`

---

## Self-Review

- **Spec coverage:** pure region detector (T1); FROM-object describe + `soql-lang` delegation + kind map (T2).
  Desktop unchanged — `apex_complete` + Monaco provider route SOQL vs Apex by what the backend returns.
- **Short-circuit:** the SOQL branch runs BEFORE `ensure_base`, so editing a SOQL literal never triggers
  the (slow) stdlib OST fetch — only a (disk-cached) describe of the FROM object.
- **Benign:** no FROM / describe failure / non-SELECT brackets → empty or Apex fallback; never errors.
- **Known limits:** top-level FROM only (no subquery/relationship schema); no bind-var awareness; SOQL
  diagnostics and the standalone SOQL-panel completion are out of scope.
