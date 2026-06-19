# apex-soql-diagnostics: unknown-field squiggles inside Apex `[SELECT …]` literals — Implementation Plan

> Extend the (safe, ground-truth) SOQL unknown-field diagnostic to inline SOQL literals in the Apex
> editor. Find every `[SELECT …]` region, diagnose each against its FROM describe, and map the byte
> spans back to the full Apex source. Same engine as the SOQL panel — still no OST-completeness
> false-positive risk (describe is ground truth).

## Goal

`apex_lang::soql_regions(src)` returns all inline SOQL inner ranges. `features` diagnoses each region and
offsets the diagnostics into Apex-source coordinates. A Tauri command + a debounced Apex-editor marker
effect (mirroring the SOQL panel) renders them.

## Scope (MVP) / YAGNI

- IN: all top-level `[SELECT …]` literals in the Apex source; SELECT unknown-field diagnostics per
  literal (each literal's own FROM object); spans mapped to Apex offsets; Monaco markers on the `apex`
  model, debounced. Multiple literals with different FROM objects handled (one reused `SchemaStore`).
- OUT: Apex semantic diagnostics of any kind (unknown types/members) — still deferred, still unsafe;
  bind-variable awareness; nested subquery field schemas.

## Global Constraints

- Rust 2021. `apex-lang` pure for `soql_regions`. No lock across `.await`. TDD for the Rust slices.
  Gates: `cargo test -p apex-lang`, `cargo test -p features`, `cargo clippy --workspace -- -D warnings`,
  `cargo fmt --check` (exit-code-checked — [[sf-toolkit-fmt-gate]]),
  `cargo build --manifest-path desktop/src-tauri/Cargo.toml`, `cd desktop && pnpm build`. English;
  conventional commits. No branch creation/switch; NEVER `git push`.

## Pre-verified facts

- `apex_lang::soql_region_at(input, cursor)` exists (cursor-based, single region). `lib.rs` re-exports
  `parser::soql_region_at`; add `pub use parser::soql_regions;`.
- `features/src/soql.rs` has `const API_VERSION = "60.0"`, `use std::path::PathBuf;`,
  `use serde::{…, Serialize}`, `pub struct SoqlDiagnostic { message, start, end, severity: String }`
  (`#[serde(rename_all="camelCase")]`), and `pub async fn diagnose(invoker, root, org_id, query) ->
  Vec<SoqlDiagnostic>` which builds `SchemaStore::new(root, org_id)`, resolves `soql_lang::outline`'s
  `from_object`, `get_or_fetch(invoker, API_VERSION, &object)` (OWNED — no `.clone()`), runs
  `soql_lang::diagnostics`, maps `Severity::{Error,Warning}` → `"error"/"warning"`.
- `desktop/src-tauri/src/lib.rs`: `soql_diagnostics` command is the reference; `apex-lang` IS a src-tauri
  dep (used by dto.rs); `sf-schema` IS a dep. Add the new command to `tauri::generate_handler![…]`.
- `desktop/src/panels/ApexPanel.tsx` (`ApexView`): already imports `useEffect, useRef, Monaco, editor,
  invoke`. The `<Editor language="apex" value={src} onMount={onMount} onChange=…>` lives here; `onMount`
  currently only does `addCommand(CtrlCmd+Enter, run)`. `SoqlDiagnosticDto` type already in
  `desktop/src/types.ts`.

---

### Task 1: `apex_lang::soql_regions` — all inline SOQL ranges (RED first)

**Files:** `crates/apex-lang/src/parser.rs`, `crates/apex-lang/src/lib.rs`.

- [ ] **Step 1: failing test** — add to parser.rs tests:
  ```rust
  #[test]
  fn soql_regions_finds_all_select_literals() {
      let src = "List<Account> a = [SELECT Id FROM Account]; Integer n = arr[0]; Account b = [SELECT Bogus FROM Account];";
      let r = soql_regions(src);
      assert_eq!(r.len(), 2);
      assert_eq!(&src[r[0].0..r[0].1], "SELECT Id FROM Account");
      assert_eq!(&src[r[1].0..r[1].1], "SELECT Bogus FROM Account");
      // a non-SELECT bracket (array index) is not a region
      assert!(soql_regions("x = arr[0];").is_empty());
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** in parser.rs (next to `soql_region_at`):
  ```rust
  /// All inline SOQL literal inner ranges `[SELECT …]` in `input` (brackets excluded), left→right.
  /// Skips non-SELECT brackets (e.g. array indexing). Bracket bytes are ASCII so byte indexing is safe.
  pub fn soql_regions(input: &str) -> Vec<(usize, usize)> {
      let bytes = input.as_bytes();
      let mut out = Vec::new();
      let mut i = 0usize;
      while i < input.len() {
          if bytes[i] != b'[' {
              i += 1;
              continue;
          }
          // matching ']' (depth-aware), EOF if unclosed
          let mut depth = 0i32;
          let mut close = input.len();
          let mut j = i + 1;
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
          let inner = &input[i + 1..close];
          if inner
              .trim_start()
              .get(..6)
              .is_some_and(|s| s.eq_ignore_ascii_case("select"))
          {
              out.push((i + 1, close));
          }
          i = close + 1;
      }
      out
  }
  ```
  And in lib.rs: `pub use parser::soql_regions;`

- [ ] **Step 4: run → green**; clippy + fmt clean (workspace).
- [ ] **Step 5: commit** `feat(apex-lang): find all inline SOQL literal regions`

---

### Task 2: `features::soql::diagnose_apex_soql` (RED first)

**Files:** `crates/features/src/soql.rs`.

- [ ] **Step 1: failing test** — add (one describe scripted; assert the diagnostic span lands on `Bogus`
  in the FULL Apex source):
  ```rust
  #[tokio::test]
  async fn diagnose_apex_soql_offsets_into_source() {
      let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Id","type":"id"}]}}"#;
      let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
          Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
      });
      let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
      let dir = std::env::temp_dir().join(format!("apex-soql-diag-{}", std::process::id()));
      let src = "Account a = [SELECT Bogus FROM Account];";
      let diags = diagnose_apex_soql(&invoker, &dir, "myorg", src).await;
      assert_eq!(diags.len(), 1, "{diags:?}");
      assert_eq!(&src[diags[0].start..diags[0].end], "Bogus");
      let _ = std::fs::remove_dir_all(&dir);
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — refactor `diagnose` to reuse a shared per-query helper, then add the Apex
  variant that reuses one store across regions:
  ```rust
  /// Diagnose ONE SOQL string against its FROM describe (empty when no FROM / describe fails).
  async fn soql_query_diagnostics(
      store: &mut sf_schema::SchemaStore,
      invoker: &SfInvoker,
      query: &str,
  ) -> Vec<soql_lang::Diagnostic> {
      let Some(object) = soql_lang::outline(query).from_object else {
          return Vec::new();
      };
      let Ok(schema) = store.get_or_fetch(invoker, API_VERSION, &object).await else {
          return Vec::new();
      };
      soql_lang::diagnostics(query, &schema)
  }

  fn to_dto(d: soql_lang::Diagnostic, offset: usize) -> SoqlDiagnostic {
      SoqlDiagnostic {
          message: d.message,
          start: offset + d.start,
          end: offset + d.end,
          severity: match d.severity {
              soql_lang::Severity::Error => "error",
              soql_lang::Severity::Warning => "warning",
          }
          .to_string(),
      }
  }
  ```
  Rewrite `diagnose` to:
  ```rust
  pub async fn diagnose(
      invoker: &SfInvoker,
      root: impl Into<PathBuf>,
      org_id: &str,
      query: &str,
  ) -> Vec<SoqlDiagnostic> {
      let mut store = sf_schema::SchemaStore::new(root, org_id);
      soql_query_diagnostics(&mut store, invoker, query)
          .await
          .into_iter()
          .map(|d| to_dto(d, 0))
          .collect()
  }
  ```
  Add:
  ```rust
  /// Unknown-field diagnostics for every inline `[SELECT …]` literal in Apex `src`, with spans in
  /// Apex-source coordinates. Best-effort (empty regions / describe failures are skipped).
  pub async fn diagnose_apex_soql(
      invoker: &SfInvoker,
      root: impl Into<PathBuf>,
      org_id: &str,
      src: &str,
  ) -> Vec<SoqlDiagnostic> {
      let mut store = sf_schema::SchemaStore::new(root, org_id);
      let mut out = Vec::new();
      for (start, end) in apex_lang::soql_regions(src) {
          let inner = &src[start..end];
          for d in soql_query_diagnostics(&mut store, invoker, inner).await {
              out.push(to_dto(d, start));
          }
      }
      out
  }
  ```
  (Keep the existing `SoqlDiagnostic` struct as-is. `apex-lang` is already a `features` dependency.)

- [ ] **Step 4: run → green**; `cargo test -p features && cargo test -p apex-lang &&
  cargo clippy --workspace -- -D warnings && cargo fmt --check`.
- [ ] **Step 5: commit** `feat(features): diagnose SOQL literals inside Apex source`

---

### Task 3: `apex_soql_diagnostics` command + Apex-editor markers

**Files:** `desktop/src-tauri/src/lib.rs`, `desktop/src/panels/ApexPanel.tsx`.

- [ ] **Step 1: command** (mirror `soql_diagnostics`):
  ```rust
  #[tauri::command]
  async fn apex_soql_diagnostics(
      src: String,
      state: State<'_, AppState>,
  ) -> Result<Vec<features::soql::SoqlDiagnostic>, String> {
      let org = current_org(&state).unwrap_or_else(|| "default".to_string());
      Ok(features::soql::diagnose_apex_soql(
          &state.invoker,
          sf_schema::SchemaStore::default_root(),
          &org,
          &src,
      )
      .await)
  }
  ```
  Add `apex_soql_diagnostics` to `tauri::generate_handler![…]`. Verify
  `cargo build --manifest-path desktop/src-tauri/Cargo.toml`. Commit
  `feat(desktop): apex_soql_diagnostics Tauri command`.

- [ ] **Step 2: markers in ApexView** (`ApexPanel.tsx`) — mirror the SOQL editor:
  - Add `import type { SoqlDiagnosticDto } from "../types";` (invoke + useEffect/useRef already imported).
  - Add refs near `srcRef`:
    ```ts
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<Monaco | null>(null);
    ```
    and in `onMount` set `editorRef.current = instance; monacoRef.current = monaco;` (keep the addCommand).
  - Add a debounced effect:
    ```ts
    useEffect(() => {
      const instance = editorRef.current;
      const monaco = monacoRef.current;
      if (!instance || !monaco) return;
      const model = instance.getModel();
      if (!model) return;
      const handle = setTimeout(async () => {
        let diags: SoqlDiagnosticDto[];
        try {
          diags = await invoke<SoqlDiagnosticDto[]>("apex_soql_diagnostics", { src });
        } catch {
          return;
        }
        monaco.editor.setModelMarkers(
          model,
          "apex-soql",
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
            } as editor.IMarkerData;
          }),
        );
      }, 350);
      return () => clearTimeout(handle);
    }, [src]);
    ```
    (Marker owner `"apex-soql"` is distinct so it never clashes with completion or other markers.)

- [ ] **Step 3: verify** `cd desktop && pnpm build`. Commit
  `feat(desktop): show Apex inline-SOQL diagnostics as editor markers`.

---

## Self-Review

- **Still safe:** identical ground-truth describe check; only SOQL field validity, never Apex semantics.
- **Offset correctness:** `to_dto(d, region_start)` shifts each diagnostic into Apex-source coordinates;
  the Task-2 test asserts the span lands exactly on `Bogus` in the full source.
- **Reuse:** `soql_query_diagnostics` is shared by panel + Apex paths; one `SchemaStore` per call caches
  repeat FROM objects across multiple literals.
- **Benign:** no regions / describe failure / invoke error → no markers.
- **Limits:** SELECT-list only; no bind vars; Apex semantic diagnostics remain deferred.

## When finished, print

```
cargo test -p apex-lang
cargo test -p features
cargo clippy --workspace -- -D warnings
cargo fmt --check
cargo build --manifest-path desktop/src-tauri/Cargo.toml
cd desktop && pnpm build
git log --oneline <BASE_SHA>..HEAD
```
