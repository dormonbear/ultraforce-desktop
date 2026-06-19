# Apex completion → desktop (Tauri command + Monaco provider) — Implementation Plan

> Wires the already-built `apex-lang` completion engine into the Tauri/React desktop so the
> Anonymous-Apex Monaco editor offers live completions (stdlib + the org's own Apex classes).
> Phase-3 desktop slice. TDD per Rust task; frontend verified by `cd desktop && pnpm build`.

## Goal

A `features::apex_complete` module owns OST acquisition + an in-memory assembled-OST cache and
delegates to `apex_lang::complete`. A Tauri `apex_complete` command exposes it. A Monaco
`CompletionItemProvider` for the `apex` language calls the command and maps results to suggestions.

## Architecture

```
Monaco apex editor → registerApexCompletion (monaco-apex.ts)
  → invoke("apex_complete", { src, offset })
    → #[tauri::command] apex_complete (src-tauri/lib.rs)
      → AppState.apex : features::apex_complete::ApexCompleter
        → cached Arc<Ost> per org_id (std::sync::Mutex, never locked across .await)
        → on miss: OstStore.get_or_fetch(Stdlib)→parse_stdlib + (OrgTypes)→parse_org_types → Ost
        → apex_lang::complete(src, cursor, &ost) → Vec<Candidate>
      → Vec<CandidateDto> { label, kind }
  → monaco CompletionItem[]  (kind mapped; failure → empty suggestions)
```

## Global Constraints

- Rust 2021. sf access only via `sf_core::SfInvoker`. English code/comments. Conventional commits,
  NO author attribution / Co-Authored-By trailer.
- TDD per Rust task; `cargo test -p features` and `cargo build --manifest-path desktop/src-tauri/Cargo.toml`
  must pass; `cargo clippy --workspace -- -D warnings` clean; `cd desktop && pnpm build` (tsc+vite) green.
  No display in this env — do NOT run `pnpm tauri dev`.
- **No new external crates.** Do NOT add `tokio` to src-tauri. The OST cache uses `std::sync::Mutex`
  holding an `Arc<Ost>`; the lock is released before any `.await` (build the OST with the guard NOT held).
- `api_version` is the constant `"60.0"` for this MVP (matches the apex-lang fixtures/e2e).
- Reuse existing Tailwind/Monaco patterns. No emoji.
- Never create/switch git branches in this plan; never `git push`. Commit on the current branch only.

## Pre-verified facts

- `apex_lang` public API: `apex_lang::complete(input: &str, cursor: usize, ost: &Ost) -> Vec<Candidate>`;
  `apex_lang::symbols::Ost { pub namespaces: Vec<Namespace>, pub org_types: Vec<ApexType> }`
  (derives Clone+Default); `apex_lang::acquire::{parse_stdlib(&Value)->Vec<Namespace>,
  parse_org_types(&[Value])->Vec<ApexType>}`; `apex_lang::store::{OstStore, OstSource}` with
  `OstStore::new(root, org_id)`, `OstStore::default_root()`, and
  `async get_or_fetch(&mut self, &SfInvoker, api_version, OstSource) -> Result<&Value, SfError>`
  (Stdlib → raw completions Value; OrgTypes → `Value::Array(records)`).
  `apex_lang::complete::{Candidate { label: String, kind: CandidateKind }, CandidateKind::{Type,
  Keyword, LocalVar, Method, Property}}` — CandidateKind has NO serde derive (map to string by hand).
- `crates/features/Cargo.toml` has `serde_json` dep + dev-deps `sf-core {features=["test-util"]}` + `tokio`.
- `desktop/src-tauri/src/lib.rs`: `struct AppState { invoker: SfInvoker, selected_org: std::sync::Mutex<Option<String>> }`,
  `fn current_org(state) -> Option<String>`, commands shaped `#[tauri::command] async fn x(.., state: State<'_, AppState>) -> Result<Dto, String>`,
  registered in `tauri::generate_handler![run_soql, run_apex, list_logs, get_log, list_orgs, set_target_org, get_debug_config, set_debug_config]`,
  AppState built in `pub fn run()`. src-tauri does NOT yet depend on `apex-lang`.
- `desktop/src/monaco-apex.ts` exports `configureMonacoApex(monaco)` (theme + apex language + Monarch tokens,
  register-once guard). `desktop/src/panels/ApexPanel.tsx` calls it in `beforeMount`; `onMount` adds Ctrl/Cmd+Enter.

---

### Task 1: `features::apex_complete` — ApexCompleter with OST cache (RED first)

**Files:** modify `crates/features/Cargo.toml` (+`apex-lang = { path = "../apex-lang" }`),
`crates/features/src/lib.rs` (+`pub mod apex_complete;`), create `crates/features/src/apex_complete.rs`.

- [ ] **Step 1: add the dep + module declaration**
  - `crates/features/Cargo.toml` `[dependencies]`: add `apex-lang = { path = "../apex-lang" }`.
  - `crates/features/src/lib.rs`: add `pub mod apex_complete;` (alphabetical: after `anon_apex`).

- [ ] **Step 2: write the failing tests** in `crates/features/src/apex_complete.rs`:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use sf_core::runner::MockRunner;
      use std::sync::atomic::{AtomicUsize, Ordering};
      use std::sync::Arc;

      // Minimal real-shape payloads (see apex-lang fixtures for the full shape).
      const STDLIB: &str = r#"{"publicDeclarations":{"System":{"String":{"constructors":[],"methods":[{"name":"valueOf","returnType":"String","isStatic":true,"argTypes":["Integer"],"parameters":[{"name":"i","type":"Integer"}]}],"properties":[]}}}}"#;
      const ORGTYPES: &str = r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#;

      /// Counting runner: stdlib `api request rest` (raw, NO --json) then `data query` (--json).
      fn counting(seen: Arc<AtomicUsize>) -> MockRunner {
          MockRunner::new(move |_p, args| {
              seen.fetch_add(1, Ordering::SeqCst);
              let is_completions = args.iter().any(|a| a.contains("tooling/completions"));
              let body = if is_completions { STDLIB } else { ORGTYPES };
              Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
          })
      }

      #[tokio::test]
      async fn completes_stdlib_type_and_caches() {
          let seen = Arc::new(AtomicUsize::new(0));
          let invoker = sf_core::SfInvoker::new(Arc::new(counting(seen.clone())));
          let dir = std::env::temp_dir().join(format!("apex-complete-test-{}", std::process::id()));
          let completer = ApexCompleter::new(dir.clone());

          let c1 = completer.complete(&invoker, "myorg", "String.va", 9).await.unwrap();
          assert!(c1.iter().any(|c| c.label == "valueOf"), "{c1:?}");
          let calls_after_first = seen.load(Ordering::SeqCst);
          assert!(calls_after_first >= 2, "expected stdlib+orgtypes fetch, got {calls_after_first}");

          // Second call, same org → served from the in-memory Ost, no new sf calls.
          let c2 = completer.complete(&invoker, "myorg", "Stri", 4).await.unwrap();
          assert!(c2.iter().any(|c| c.label == "String"), "{c2:?}");
          assert_eq!(seen.load(Ordering::SeqCst), calls_after_first, "second call must not re-fetch");

          let _ = std::fs::remove_dir_all(&dir);
      }
  }
  ```

- [ ] **Step 3: run tests → see them fail** (`cargo test -p features apex_complete`).

- [ ] **Step 4: implement** (above the test module) in `crates/features/src/apex_complete.rs`:
  ```rust
  //! Wire apex-lang completion into a stateful, org-keyed in-memory OST cache.

  use std::path::PathBuf;
  use std::sync::{Arc, Mutex};

  use apex_lang::acquire::{parse_org_types, parse_stdlib};
  use apex_lang::complete::{complete as ost_complete, Candidate};
  use apex_lang::store::{OstSource, OstStore};
  use apex_lang::symbols::Ost;
  use sf_core::{SfError, SfInvoker};

  const API_VERSION: &str = "60.0";

  /// Owns the assembled-OST cache (one `Arc<Ost>` per org id). The mutex guards only the
  /// cheap swap of the cached pointer — it is NEVER held across an `.await`.
  pub struct ApexCompleter {
      root: PathBuf,
      cache: Mutex<Option<(String, Arc<Ost>)>>,
  }

  impl ApexCompleter {
      pub fn new(root: impl Into<PathBuf>) -> Self {
          Self { root: root.into(), cache: Mutex::new(None) }
      }

      /// OST root under the OS cache dir, mirroring apex-lang's default.
      pub fn default() -> Self {
          Self::new(OstStore::default_root())
      }

      fn cached(&self, org_id: &str) -> Option<Arc<Ost>> {
          let guard = self.cache.lock().unwrap();
          match &*guard {
              Some((id, ost)) if id == org_id => Some(ost.clone()),
              _ => None,
          }
      }

      /// Build (or reuse) the OST for `org_id`, then complete at `cursor`.
      pub async fn complete(
          &self,
          invoker: &SfInvoker,
          org_id: &str,
          src: &str,
          cursor: usize,
      ) -> Result<Vec<Candidate>, SfError> {
          if let Some(ost) = self.cached(org_id) {
              return Ok(ost_complete(src, cursor, &ost));
          }
          let ost = Arc::new(self.build(invoker, org_id).await?);
          // brief lock, no await held
          *self.cache.lock().unwrap() = Some((org_id.to_string(), ost.clone()));
          Ok(ost_complete(src, cursor, &ost))
      }

      async fn build(&self, invoker: &SfInvoker, org_id: &str) -> Result<Ost, SfError> {
          // Fresh disk-backed store each rebuild; the disk cache makes repeat builds cheap.
          let mut store = OstStore::new(self.root.clone(), org_id);
          // get_or_fetch returns an OWNED Value — do NOT add `.clone()` (clippy redundant_clone).
          let stdlib = store.get_or_fetch(invoker, API_VERSION, OstSource::Stdlib).await?;
          let namespaces = parse_stdlib(&stdlib);
          let org_raw = store.get_or_fetch(invoker, API_VERSION, OstSource::OrgTypes).await?;
          let records = org_raw.as_array().cloned().unwrap_or_default();
          let org_types = parse_org_types(&records);
          Ok(Ost { namespaces, org_types })
      }
  }
  ```
  > `get_or_fetch(&mut self, ..) -> Result<Value, SfError>` (owned). No guard is held across
  > `.await`; the `&mut store` borrows end at each statement, so the two calls compose cleanly.

- [ ] **Step 5: run tests → green**; `cargo clippy -p features -- -D warnings` clean.

- [ ] **Step 6: commit** `feat(features): org-keyed OST cache + apex completion wiring`

---

### Task 2: src-tauri `apex_complete` command + DTO (RED-ish: dto mapping test)

**Files:** modify `desktop/src-tauri/Cargo.toml` (+`apex-lang` dep), `desktop/src-tauri/src/dto.rs`
(CandidateDto + mapping + test), `desktop/src-tauri/src/lib.rs` (AppState field, command, handler).

- [ ] **Step 1: add dep** to `desktop/src-tauri/Cargo.toml` `[dependencies]`:
  `apex-lang = { path = "../../crates/apex-lang" }`.

- [ ] **Step 2: CandidateDto + mapping + test** — append to `desktop/src-tauri/src/dto.rs`:
  ```rust
  use apex_lang::complete::{Candidate, CandidateKind};

  /// One completion candidate for the React/Monaco side.
  #[derive(serde::Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct CandidateDto {
      pub label: String,
      pub kind: String,
  }

  fn candidate_kind_str(k: &CandidateKind) -> &'static str {
      match k {
          CandidateKind::Type => "type",
          CandidateKind::Keyword => "keyword",
          CandidateKind::LocalVar => "localVar",
          CandidateKind::Method => "method",
          CandidateKind::Property => "property",
      }
  }

  impl From<&Candidate> for CandidateDto {
      fn from(c: &Candidate) -> Self {
          CandidateDto { label: c.label.clone(), kind: candidate_kind_str(&c.kind).to_string() }
      }
  }
  ```
  Add a unit test in dto.rs's existing `#[cfg(test)] mod tests` (or a new one) asserting
  `CandidateDto::from(&Candidate{ label:"valueOf".into(), kind: CandidateKind::Method }).kind == "method"`.

- [ ] **Step 3: AppState + command + handler** in `desktop/src-tauri/src/lib.rs`:
  - Add field to `AppState`: `apex: features::apex_complete::ApexCompleter`.
  - In `run()`, construct it: `apex: features::apex_complete::ApexCompleter::default(),`.
  - Add the command after `set_debug_config`:
    ```rust
    #[tauri::command]
    async fn apex_complete(
        src: String,
        offset: usize,
        state: State<'_, AppState>,
    ) -> Result<Vec<dto::CandidateDto>, String> {
        let org = current_org(&state).unwrap_or_else(|| "default".to_string());
        let cands = state
            .apex
            .complete(&state.invoker, &org, &src, offset)
            .await
            .map_err(|e| format!("{e:?}"))?;
        Ok(cands.iter().map(dto::CandidateDto::from).collect())
    }
    ```
  - Register `apex_complete` in `generate_handler!`.

- [ ] **Step 4: verify** `cargo build --manifest-path desktop/src-tauri/Cargo.toml` +
  `cargo test -p sf-toolkit-desktop` (dto test) + `cargo clippy --workspace -- -D warnings`.

- [ ] **Step 5: commit** `feat(desktop): apex_complete Tauri command + candidate DTO`

---

### Task 3: Monaco completion provider + types (frontend)

**Files:** modify `desktop/src/types.ts`, `desktop/src/monaco-apex.ts`, `desktop/src/panels/ApexPanel.tsx`.

- [ ] **Step 1: type** — append to `desktop/src/types.ts`:
  ```ts
  export interface ApexCandidateDto {
    label: string;
    kind: string;
  }
  ```

- [ ] **Step 2: provider** — in `desktop/src/monaco-apex.ts`, add (register-once, like the language guard):
  ```ts
  import { invoke } from "@tauri-apps/api/core";
  import type { ApexCandidateDto } from "./types";

  let completionRegistered = false;

  function monacoKind(monaco: Monaco, kind: string) {
    const K = monaco.languages.CompletionItemKind;
    switch (kind) {
      case "type": return K.Class;
      case "keyword": return K.Keyword;
      case "localVar": return K.Variable;
      case "method": return K.Method;
      case "property": return K.Field;
      default: return K.Text;
    }
  }

  /** Register an Apex CompletionItemProvider backed by the `apex_complete` Tauri command. */
  export function registerApexCompletion(monaco: Monaco): void {
    if (completionRegistered) return;
    completionRegistered = true;
    monaco.languages.registerCompletionItemProvider("apex", {
      triggerCharacters: ["."],
      provideCompletionItems: async (model, position) => {
        const offset = model.getOffsetAt(position);
        const src = model.getValue();
        let cands: ApexCandidateDto[];
        try {
          cands = await invoke<ApexCandidateDto[]>("apex_complete", { src, offset });
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
          suggestions: cands.map((c) => ({
            label: c.label,
            kind: monacoKind(monaco, c.kind),
            insertText: c.label,
            range,
          })),
        };
      },
    });
  }
  ```
  Call it from `configureMonacoApex` (after the language is registered) so one entry point wires
  both syntax + completion: add `registerApexCompletion(monaco);` at the end of `configureMonacoApex`.

- [ ] **Step 3: verify** `cd desktop && pnpm build` (tsc + vite) green.

- [ ] **Step 4: commit** `feat(desktop): Monaco Apex completion provider`

---

## Self-Review

- **Spec coverage:** OST cache + completion glue (T1), Tauri command + DTO (T2), Monaco provider (T3).
  Scope = Anonymous-Apex editor; stdlib + org Apex classes; api version fixed at 60.0.
- **Perf:** OST assembled once per org, held as `Arc<Ost>` in memory; per-keystroke completion is
  pure in-memory (no IO, no re-parse). First request per org fetches (stdlib ~18MB + ApexClass) and
  disk-caches via OstStore. Org switch rebuilds (cache key = selected org / "default").
- **No tokio added:** `std::sync::Mutex` guards only the cached `Arc<Ost>` swap; OST build runs with
  no guard held across `.await`. Concurrent first-calls may double-fetch (idempotent) — acceptable v1.
- **Error handling:** acquisition/sf errors → command `Err(String)` → provider catches → empty
  suggestions (no completions, never crashes the editor).
- **Known v1 limitations:** OST is not auto-invalidated when the user edits their Apex classes
  (needs app restart or a future explicit invalidate); api version is hard-coded 60.0; only the
  Anonymous-Apex editor is wired (not a general Apex file editor).
- **Convention:** `target_org`/org plumbing via existing `current_org`; existing tokens; no emoji;
  conventional commits, no author attribution.
