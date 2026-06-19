# soql-panel-completion: SOQL field completion in the standalone SOQL editor — Implementation Plan

> The Apex editor already gets SOQL completion inside `[SELECT …]` literals. Bring the same
> SELECT-field completion to the standalone SOQL panel (the `soql` Monaco language). New
> `features::soql::complete_fields` (describe FROM object → `soql_lang::complete`) + a `soql_complete`
> Tauri command + a Monaco completion provider on the `soql` language. Completion-only / benign.

## Goal

`soql_lang::complete(query, cursor, &SObjectSchema)` already yields SELECT field candidates. Wire it for
the SOQL editor: resolve the FROM object's schema (disk-cached `SchemaStore`) and return field labels;
expose via a Tauri command; register a `soql` completion provider that calls it.

## Scope (MVP) / YAGNI

- IN: top-level FROM object field completion in the SOQL editor; returns field-name labels (the only
  `soql_lang` candidate kind is `Field`).
- OUT: relationship/subquery field schemas; FROM-object (sObject name) completion; SOQL diagnostics in
  the panel. The Apex-literal SOQL path (`ApexCompleter::complete_soql`) is unchanged.

## Global Constraints

- Rust 2021. No lock held across `.await`. TDD for the Rust slice. Gates: `cargo test -p features`,
  `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` (exit-code-checked —
  [[sf-toolkit-fmt-gate]]), `cargo build --manifest-path desktop/src-tauri/Cargo.toml`, and
  `cd desktop && pnpm build`. English; conventional commits. No branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `crates/features/Cargo.toml` already deps `soql-lang` and `sf-schema` (added by soql-in-apex).
  `crates/features/src/soql.rs` exists (query execution); add the completion fn there.
- `soql_lang::outline(q).from_object: Option<String>`; `soql_lang::complete(q, cursor, &SObjectSchema)
  -> Vec<soql_lang::Candidate { label, kind }>` (kind is always `Field`).
- `sf_schema::SchemaStore::new(root: impl Into<PathBuf>, org_id: impl Into<String>)`,
  `SchemaStore::default_root() -> PathBuf`, `async get_or_fetch(&invoker, api_version, object)
  -> Result<SObjectSchema, SfError>` (OWNED — no `.clone()`). `SObjectSchema` has NO `Default`.
- `ApexCompleter` uses `API_VERSION = "60.0"`; mirror that constant in soql.rs.
- Desktop: `desktop/src-tauri/src/lib.rs` registers commands in `tauri::generate_handler![…]`; pattern
  for an org-scoped async command is `apex_complete` (uses `current_org(&state)` →
  `"default"` fallback, maps `SfError`→`String`). `desktop/src/monaco-soql.ts` exports
  `configureMonaco(monaco)` (idempotent, guarded by a module bool); `SoqlEditor.tsx` calls it in
  `beforeMount` with `language="soql"`. The `apex` provider in `monaco-apex.ts` is the reference shape
  (`triggerCharacters`, `invoke`, `getWordUntilPosition` range, map to `CompletionItemKind`).
- Returning `Vec<String>` (field labels) avoids adding a `soql-lang` dependency to the desktop crate —
  the kind is always Field, so the frontend hardcodes it.

---

### Task 1: `features::soql::complete_fields` (RED first)

**Files:** `crates/features/src/soql.rs`.

- [ ] **Step 1: failing test** — add to soql.rs tests (mock a describe(Account) response; assert a
  SELECT field label is returned):
  ```rust
  #[tokio::test]
  async fn complete_fields_returns_select_field_labels() {
      let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string"},{"name":"Industry","type":"picklist"}]}}"#;
      let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
          Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
      });
      let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
      let dir = std::env::temp_dir().join(format!("soql-panel-test-{}", std::process::id()));
      let q = "SELECT Na FROM Account";
      let cursor = q.find("Na").unwrap() + 2;
      let got = complete_fields(&invoker, &dir, "myorg", q, cursor).await;
      assert!(got.iter().any(|l| l == "Name"), "{got:?}");
      let _ = std::fs::remove_dir_all(&dir);
  }
  ```
  (Take a `root` param in the fn so the test can use a temp dir — the Tauri command will pass
  `SchemaStore::default_root()`.)

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — add to soql.rs (near the top add `use std::path::PathBuf;` if needed):
  ```rust
  const API_VERSION: &str = "60.0";

  /// SELECT field-name completion for the standalone SOQL editor. Best-effort: empty when there is no
  /// FROM object or the describe fails (benign). Returns field labels (the only candidate kind).
  pub async fn complete_fields(
      invoker: &SfInvoker,
      root: impl Into<PathBuf>,
      org_id: &str,
      query: &str,
      cursor: usize,
  ) -> Vec<String> {
      let Some(object) = soql_lang::outline(query).from_object else {
          return Vec::new();
      };
      let mut store = sf_schema::SchemaStore::new(root, org_id);
      let Ok(schema) = store.get_or_fetch(invoker, API_VERSION, &object).await else {
          return Vec::new();
      };
      soql_lang::complete(query, cursor, &schema)
          .into_iter()
          .map(|c| c.label)
          .collect()
  }
  ```
  (`SfInvoker` is already imported in soql.rs; add `use std::path::PathBuf;` only if not present.)

- [ ] **Step 4: run → green**; `cargo test -p features && cargo clippy --workspace -- -D warnings &&
  cargo fmt --check`.
- [ ] **Step 5: commit** `feat(features): SOQL SELECT field completion for the standalone editor`

---

### Task 2: `soql_complete` Tauri command (RED-light)

**Files:** `desktop/src-tauri/src/lib.rs`.

- [ ] **Step 1: implement** the command (mirror `apex_complete`):
  ```rust
  #[tauri::command]
  async fn soql_complete(
      query: String,
      offset: usize,
      state: State<'_, AppState>,
  ) -> Result<Vec<String>, String> {
      let org = current_org(&state).unwrap_or_else(|| "default".to_string());
      Ok(features::soql::complete_fields(
          &state.invoker,
          sf_schema::SchemaStore::default_root(),
          &org,
          &query,
          offset,
      )
      .await)
  }
  ```
  Add `soql_complete` to the `tauri::generate_handler![…]` list. If `sf_schema` is not already a
  dependency of `desktop/src-tauri/Cargo.toml`, add `sf-schema = { path = "../../crates/sf-schema" }`
  (verify the correct relative path against the existing `features`/`sf-core` path entries in that
  Cargo.toml before adding).

- [ ] **Step 2: verify** `cargo build --manifest-path desktop/src-tauri/Cargo.toml`.
- [ ] **Step 3: commit** `feat(desktop): soql_complete Tauri command`

---

### Task 3: Monaco `soql` completion provider (frontend)

**Files:** `desktop/src/monaco-soql.ts`.

- [ ] **Step 1: implement** — add a guarded provider and call it from `configureMonaco`:
  ```ts
  import { invoke } from "@tauri-apps/api/core";
  // …existing imports…

  let soqlCompletionRegistered = false;

  /** Register a SOQL CompletionItemProvider backed by the `soql_complete` Tauri command. */
  export function registerSoqlCompletion(monaco: Monaco): void {
    if (soqlCompletionRegistered) return;
    soqlCompletionRegistered = true;
    monaco.languages.registerCompletionItemProvider("soql", {
      triggerCharacters: [" ", ",", "."],
      provideCompletionItems: async (model, position) => {
        const offset = model.getOffsetAt(position);
        const query = model.getValue();
        let labels: string[];
        try {
          labels = await invoke<string[]>("soql_complete", { query, offset });
        } catch {
          return { suggestions: [] };
        }
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: labels.map((label) => ({
            label,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: label,
            range,
          })),
        };
      },
    });
  }
  ```
  At the END of `configureMonaco(monaco)` (after the language/theme registration, inside the
  idempotent path), add `registerSoqlCompletion(monaco);`.

- [ ] **Step 2: verify** `cd desktop && pnpm build` (tsc + vite). Fix any type errors.
- [ ] **Step 3: commit** `feat(desktop): wire SOQL field completion into the SOQL editor`

---

## Self-Review

- **Reuse:** same `soql_lang::complete` + disk-cached `SchemaStore` the Apex-literal path uses; no new
  schema plumbing (root defaults inside the command).
- **Benign:** no FROM object / describe failure / outside SELECT → empty suggestions; provider swallows
  invoke errors. Field-only labels keep the DTO surface zero (plain `Vec<String>`).
- **Isolated:** the `soql` provider only fires in SOQL models; the Apex provider and Apex-literal SOQL
  path are untouched.

## When finished, print

```
cargo test -p features
cargo clippy --workspace -- -D warnings
cargo fmt --check
cargo build --manifest-path desktop/src-tauri/Cargo.toml
cd desktop && pnpm build
git log --oneline <BASE_SHA>..HEAD
```
