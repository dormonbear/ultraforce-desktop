# soql-panel-diagnostics: unknown-field red squiggles in the SOQL editor — Implementation Plan

> Wire the EXISTING `soql_lang::diagnostics(query, &schema)` (unknown SELECT fields vs the live describe)
> into the SOQL editor as Monaco markers. This is the FIRST diagnostic we ship — and the only safe one
> today: the describe is ground truth, so an "unknown field" squiggle cannot false-positive from OST
> incompleteness. Debounced; clears when valid.

## Goal

On edit, resolve the FROM object's schema (disk-cached `SchemaStore`) and run `soql_lang::diagnostics`;
surface each as a Monaco error marker spanning the offending field. No marker when there is no FROM
object, the describe fails, or all fields are known.

## Scope (MVP) / YAGNI

- IN: SELECT unknown-field diagnostics in the standalone SOQL editor (`soql` Monaco language), debounced
  on change, mapped to `MarkerSeverity` via byte-offset → `model.getPositionAt`.
- OUT: diagnostics inside Apex `[SELECT …]` literals (separate, needs literal-offset mapping); WHERE/
  ORDER BY field checks; relationship/dotted-field validation (the engine already skips dotted + `*`);
  object-name validation. Follow-ups, not now.

## Global Constraints

- Rust 2021. No lock across `.await`. TDD for the Rust slice. Gates: `cargo test -p features`,
  `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` (exit-code-checked —
  [[sf-toolkit-fmt-gate]]), `cargo build --manifest-path desktop/src-tauri/Cargo.toml`,
  `cd desktop && pnpm build`. English; conventional commits. No branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `soql_lang::diagnostics(input: &str, schema: &SObjectSchema) -> Vec<soql_lang::Diagnostic>` exists and
  is exported. `Diagnostic { message: String, start: usize, end: usize, severity: Severity }`,
  `Severity { Error, Warning }` (byte offsets into `input`). Returns `[]` when no FROM object.
- `features/src/soql.rs` already deps `soql-lang` + `sf-schema`, imports `sf_core::{SfError, SfInvoker}`,
  has `const API_VERSION = "60.0"` and `complete_fields(invoker, root, org_id, query, cursor)` using
  `sf_schema::SchemaStore::new(root, org_id).get_or_fetch(invoker, API_VERSION, &object)`. Mirror that
  describe path. `features` deps `serde` (derive available).
- `desktop/src-tauri/src/lib.rs`: `soql_complete` command is the reference (`current_org` → `"default"`,
  passes `sf_schema::SchemaStore::default_root()`); add the new command to `tauri::generate_handler![…]`.
  `sf-schema` is already a src-tauri dep.
- `desktop/src/components/SoqlEditor.tsx`: `<Editor language="soql" value=… onMount=(editorInstance,
  monaco)=>… onChange=…>`. Currently NO marker logic and NO editor/monaco refs retained. `useRef` is
  imported; add `useEffect`. `invoke` from `@tauri-apps/api/core` (see SoqlView for import).
- Monaco markers: `monaco.editor.setModelMarkers(model, "soql", markers)`; each marker needs
  `{ message, severity, startLineNumber, startColumn, endLineNumber, endColumn }`; positions via
  `model.getPositionAt(byteOffset)` (Monaco offsets are UTF-16 code units — fine for ASCII SOQL).
  `monaco.MarkerSeverity.{Error,Warning}`.

---

### Task 1: `features::soql::diagnose` + serializable diagnostic (RED first)

**Files:** `crates/features/src/soql.rs`.

- [ ] **Step 1: failing test** — add (mock describe Account; assert one diagnostic on `Bogus`):
  ```rust
  #[tokio::test]
  async fn diagnose_flags_unknown_select_field() {
      let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Id","type":"id"},{"name":"Name","type":"string"}]}}"#;
      let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
          Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
      });
      let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
      let dir = std::env::temp_dir().join(format!("soql-diag-test-{}", std::process::id()));
      let diags = diagnose(&invoker, &dir, "myorg", "SELECT Id, Bogus FROM Account").await;
      assert_eq!(diags.len(), 1, "{diags:?}");
      assert!(diags[0].message.contains("Bogus"));
      assert_eq!(diags[0].severity, "error");
      let _ = std::fs::remove_dir_all(&dir);
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — add to soql.rs:
  ```rust
  use serde::Serialize;

  /// One SOQL diagnostic for the editor (byte offsets into the query; severity as a lowercase string).
  #[derive(Debug, Clone, Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct SoqlDiagnostic {
      pub message: String,
      pub start: usize,
      pub end: usize,
      pub severity: String,
  }

  /// Unknown-field diagnostics for the standalone SOQL editor. Best-effort: empty when there is no FROM
  /// object or the describe fails (benign — never invents errors).
  pub async fn diagnose(
      invoker: &SfInvoker,
      root: impl Into<PathBuf>,
      org_id: &str,
      query: &str,
  ) -> Vec<SoqlDiagnostic> {
      let Some(object) = soql_lang::outline(query).from_object else {
          return Vec::new();
      };
      let mut store = sf_schema::SchemaStore::new(root, org_id);
      let Ok(schema) = store.get_or_fetch(invoker, API_VERSION, &object).await else {
          return Vec::new();
      };
      soql_lang::diagnostics(query, &schema)
          .into_iter()
          .map(|d| SoqlDiagnostic {
              message: d.message,
              start: d.start,
              end: d.end,
              severity: match d.severity {
                  soql_lang::Severity::Error => "error",
                  soql_lang::Severity::Warning => "warning",
              }
              .to_string(),
          })
          .collect()
  }
  ```
  (`use std::path::PathBuf;` already present from `complete_fields`; add `use serde::Serialize;` if not
  already imported — soql.rs already uses serde for `QueryResult`, so `Serialize` may need adding to an
  existing `use serde::…` line.)

- [ ] **Step 4: run → green**; `cargo test -p features && cargo clippy --workspace -- -D warnings &&
  cargo fmt --check`.
- [ ] **Step 5: commit** `feat(features): SOQL unknown-field diagnostics for the editor`

---

### Task 2: `soql_diagnostics` Tauri command

**Files:** `desktop/src-tauri/src/lib.rs`.

- [ ] **Step 1: implement** (mirror `soql_complete`):
  ```rust
  #[tauri::command]
  async fn soql_diagnostics(
      query: String,
      state: State<'_, AppState>,
  ) -> Result<Vec<features::soql::SoqlDiagnostic>, String> {
      let org = current_org(&state).unwrap_or_else(|| "default".to_string());
      Ok(features::soql::diagnose(
          &state.invoker,
          sf_schema::SchemaStore::default_root(),
          &org,
          &query,
      )
      .await)
  }
  ```
  Add `soql_diagnostics` to the `tauri::generate_handler![…]` list.

- [ ] **Step 2: verify** `cargo build --manifest-path desktop/src-tauri/Cargo.toml`.
- [ ] **Step 3: commit** `feat(desktop): soql_diagnostics Tauri command`

---

### Task 3: Monaco markers in the SOQL editor (frontend)

**Files:** `desktop/src/components/SoqlEditor.tsx`, `desktop/src/types.ts`.

- [ ] **Step 1: types** — add to types.ts:
  ```ts
  export interface SoqlDiagnosticDto {
    message: string;
    start: number;
    end: number;
    severity: "error" | "warning";
  }
  ```

- [ ] **Step 2: implement** — in SoqlEditor.tsx:
  - `import { useEffect, useRef } from "react";` and `import { invoke } from "@tauri-apps/api/core";`
    and `import type { SoqlDiagnosticDto } from "../types";`.
  - Retain refs in `onMount`:
    ```ts
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<Monaco | null>(null);
    ```
    set `editorRef.current = editorInstance; monacoRef.current = monaco;` inside `onMount` (keep the
    existing addCommand).
  - Add a debounced effect that recomputes markers when `value` changes:
    ```ts
    useEffect(() => {
      const editorInstance = editorRef.current;
      const monaco = monacoRef.current;
      if (!editorInstance || !monaco) return;
      const model = editorInstance.getModel();
      if (!model) return;
      const handle = setTimeout(async () => {
        let diags: SoqlDiagnosticDto[];
        try {
          diags = await invoke<SoqlDiagnosticDto[]>("soql_diagnostics", { query: value });
        } catch {
          return;
        }
        monaco.editor.setModelMarkers(
          model,
          "soql",
          diags.map((d) => {
            const s = model.getPositionAt(d.start);
            const e = model.getPositionAt(d.end);
            return {
              message: d.message,
              severity:
                d.severity === "warning"
                  ? monaco.MarkerSeverity.Warning
                  : monaco.MarkerSeverity.Error,
              startLineNumber: s.lineNumber,
              startColumn: s.column,
              endLineNumber: e.lineNumber,
              endColumn: e.column,
            };
          }),
        );
      }, 350);
      return () => clearTimeout(handle);
    }, [value]);
    ```
    Note: the effect depends on `value`; the refs are set on mount. If the very first value never sees a
    mounted editor, the next keystroke re-runs it — acceptable.

- [ ] **Step 3: verify** `cd desktop && pnpm build` (tsc + vite). Fix any type errors (e.g. the marker
  object may need `as editor.IMarkerData`).
- [ ] **Step 4: commit** `feat(desktop): show SOQL unknown-field diagnostics as editor markers`

---

## Self-Review

- **Safe-by-construction:** the only diagnostic is "field not on the described object" — the describe is
  ground truth, so no OST-completeness false-positives. Dotted fields / `*` already skipped by the engine.
- **Benign degradation:** no FROM / describe fail / invoke error → no markers (never a spurious squiggle).
- **Reuse:** same describe path + disk cache as `complete_fields`; engine (`soql_lang::diagnostics`) and
  its tests already exist.
- **Limits:** SELECT-list fields only; SOQL panel only (not Apex literals); no object-name check.

## When finished, print

```
cargo test -p features
cargo clippy --workspace -- -D warnings
cargo fmt --check
cargo build --manifest-path desktop/src-tauri/Cargo.toml
cd desktop && pnpm build
git log --oneline <BASE_SHA>..HEAD
```
