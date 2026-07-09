# Apex Completion Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Apex completion behave like top-tier language tooling: methods insert call snippets with placeholder args (+ semicolon for void methods in statement position), signature help pops after accepting, constructors/keywords get snippets, and the Apex language gets bracket/quote auto-closing.

**Architecture:** Parameter/detail info already exists in the Rust symbol model (`symbols.rs::Method.params`) but is dropped at the wire boundary. We widen the wire `Candidate` (Rust → DTO → `types.ts`), build all insert-text logic in a **pure, unit-testable TS module** (`apexSuggest.ts`), and wire it into the Monaco provider. Signature help is a new Rust engine module + Tauri command + Monaco provider. Design mirrors rust-analyzer (fill-arguments snippets, `has_call_parens` skip, `addSemicolonToUnit`, `triggerParameterHints` command) and the official `forcedotcom/apex-language-support` LSP.

**Tech Stack:** Rust (apex-lang, features, tauri), TypeScript + Monaco, vitest, Playwright (existing mocked-IPC e2e harness in `desktop/e2e/`).

## Global Constraints

- **IPC contract:** every DTO field change in `desktop/src-tauri/src/dto.rs` is mirrored in `desktop/src/types.ts` **in the same commit**, camelCase on the wire (`#[serde(rename_all = "camelCase")]`).
- **Tauri commands** return `Result<T, CommandError>` (`desktop/src-tauri/src/error.rs`).
- **Frontend IPC** only via typed functions in `desktop/src/ipc/` — components/editor never import `@tauri-apps/api/core` directly.
- **Monaco registrations** are disposable-based/HMR-safe (the `slot.__uf*` pattern already in `monaco-apex.ts`).
- **800-line cap per file** — run `scripts/check-arch.sh` before each commit.
- **Dirty worktree:** the branch has unrelated uncommitted changes. `git add` ONLY the exact files listed per task. Never `git add -A`, `-u`, or `.`.
- Vitest always with `run` (non-watch): `pnpm --dir desktop exec vitest run <file>`.
- Rust tests are colocated `#[cfg(test)]` modules; run with `cargo test -p <crate>`.
- No `console.log`; comments in English; conventional commits; no author attribution in commits.
- Commands below assume repo root `/Users/dormonzhou/Projects/ultraforce-desktop`.

---

### Task 1: Wire `Candidate` carries `detail` + `params` (Rust → DTO → types.ts)

**Files:**
- Modify: `crates/apex-lang/src/candidate.rs`
- Modify: `crates/apex-lang/src/ast/complete.rs` (internal `Candidate` + all construction sites)
- Modify: `crates/apex-lang/src/ast/engine.rs` (`to_wire`, `push_if_matches` + new test)
- Modify: `crates/features/src/apex_complete.rs` (bind-var candidates ~line 90)
- Modify: `desktop/src-tauri/src/dto.rs` (`CandidateDto` + test)
- Modify: `desktop/src/types.ts` (`ApexCandidateDto`)

**Interfaces:**
- Produces (wire type consumed by Tasks 2/3):
  ```rust
  // crates/apex-lang/src/candidate.rs
  pub struct Candidate {
      pub label: String,
      pub kind: CandidateKind,
      pub detail: Option<String>,      // method return type / field/var type
      pub params: Option<Vec<String>>, // parameter types; Some only for methods
  }
  ```
  ```ts
  // desktop/src/types.ts
  export interface ApexCandidateDto {
    label: string;
    kind: string;
    detail?: string | null;
    params?: string[] | null;
  }
  ```

- [x] **Step 1: Write the failing tests**

In `crates/apex-lang/src/ast/engine.rs` tests module (fixture `ost()` already defines `String.valueOf(Integer) : String`):

```rust
#[test]
fn method_candidates_carry_detail_and_params() {
    let ost = ost();
    let got = complete_source("String.val", "String.val".len(), &ost);
    let m = got.iter().find(|c| c.label == "valueOf").expect("valueOf offered");
    assert_eq!(m.detail.as_deref(), Some("String"));
    assert_eq!(m.params.as_deref(), Some(&["Integer".to_string()][..]));
}
```

In `desktop/src-tauri/src/dto.rs` tests module (next to `candidate_dto_maps_method_kind` ~line 948):

```rust
#[test]
fn candidate_dto_carries_detail_and_params() {
    let c = ApexCandidate {
        label: "debug".into(),
        kind: ApexCandidateKind::Method,
        detail: Some("void".into()),
        params: Some(vec!["Object".into()]),
    };
    let dto = CandidateDto::from(&c);
    assert_eq!(dto.detail.as_deref(), Some("void"));
    assert_eq!(dto.params, Some(vec!["Object".to_string()]));
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test -p apex-lang method_candidates_carry` — expected: compile error (missing fields), that IS the failure.

- [x] **Step 3: Implement**

`crates/apex-lang/src/candidate.rs` — add the two fields (doc comments as in Interfaces above). Keep `CandidateKind` unchanged in this task.

`crates/apex-lang/src/ast/complete.rs` — add `pub params: Option<Vec<String>>` to the **internal** `Candidate` (line ~23). Populate every construction site:
- `complete()` bindings loop (~line 84): `params: None` (keep `detail: Some(b.ty.display())`).
- `own_members()`: Field/Property arms `params: None`; Method arm `params: Some(me.params.iter().map(|p| p.ty.clone()).collect())`.
- `apex_type_members()`: method arm `params: Some(m.params.clone())`; property arm `params: None`; enum-constant arm `params: None`.
- `collection_members()`: change the helper to `let m = |label: &str, detail: &str, params: &[&str]| Candidate { label: label.to_string(), kind: CandidateKind::Method, detail: Some(detail.to_string()), params: Some(params.iter().map(|s| s.to_string()).collect()) };` and pass explicit param lists:
  - List: `size []`, `isEmpty []`, `add [elem.as_str()]`, `get ["Integer"]`, `set ["Integer", elem.as_str()]`, `remove ["Integer"]`, `contains [elem.as_str()]`, `clear []`, `clone []`
  - Set: `size []`, `isEmpty []`, `add [elem.as_str()]`, `remove [elem.as_str()]`, `contains [elem.as_str()]`, `clear []`
  - Map (`k`/`v` displays are already computed as `k.display()`/`v.display()` — bind them to locals first): `size []`, `isEmpty []`, `get [key]`, `put [key, val]`, `remove [key]`, `containsKey [key]`, `keySet []`, `values []`

`crates/apex-lang/src/ast/engine.rs`:
- `to_wire()` maps the new fields: `detail: c.detail, params: c.params`.
- `push_if_matches()` constructs with `detail: None, params: None`.

`crates/features/src/apex_complete.rs` bind-var branch (~line 92): add `detail: None, params: None`.

`desktop/src-tauri/src/dto.rs`:
```rust
pub struct CandidateDto {
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
    pub params: Option<Vec<String>>,
}
```
and in `From<&ApexCandidate>`: `detail: c.detail.clone(), params: c.params.clone()`.

`desktop/src/types.ts` — extend `ApexCandidateDto` as in Interfaces.

Fix any remaining compile errors in test modules that construct `Candidate` literals (add `detail: None, params: None` or the correct values) — do NOT change what those tests assert.

- [x] **Step 4: Run tests to verify they pass**

Run: `cargo test -p apex-lang && cargo test -p features && cargo test -p ultraforce_desktop 2>/dev/null || (cd desktop/src-tauri && cargo test)`
Expected: all PASS (the tauri crate test command: run `cargo test` from `desktop/src-tauri/` if the workspace alias fails).
Also: `pnpm --dir desktop exec tsc --noEmit` — PASS.

- [x] **Step 5: Commit**

```bash
git add crates/apex-lang/src/candidate.rs crates/apex-lang/src/ast/complete.rs crates/apex-lang/src/ast/engine.rs crates/features/src/apex_complete.rs desktop/src-tauri/src/dto.rs desktop/src/types.ts
git commit -m "feat(apex-complete): carry detail and params through the completion wire"
```

---

### Task 2: Pure insert-text builder `apexSuggest.ts` (snippets, void-semicolon, keywords)

**Files:**
- Create: `desktop/src/editor/apexSuggest.ts`
- Create: `desktop/src/editor/apexSuggest.test.ts`

**Interfaces:**
- Consumes: `ApexCandidateDto` from Task 1.
- Produces (used by Task 3):
  ```ts
  export interface InsertionCtx { nextChar: string; lineBeforeWord: string; lineAfterCursor: string }
  export interface Insertion { insertText: string; isSnippet: boolean; triggerSignatureHelp: boolean }
  export function buildInsertion(c: ApexCandidateDto, ctx: InsertionCtx): Insertion
  export function isStatementPosition(lineBeforeWord: string): boolean
  export interface KeywordSnippet { label: string; detail: string; body: string }
  export const KEYWORD_SNIPPETS: Record<string, KeywordSnippet[]>
  ```

- [x] **Step 1: Write the failing tests**

`desktop/src/editor/apexSuggest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildInsertion, isStatementPosition, KEYWORD_SNIPPETS } from "./apexSuggest";
import type { ApexCandidateDto } from "../types";

const ctx = (over: Partial<Parameters<typeof buildInsertion>[1]> = {}) => ({
  nextChar: "",
  lineBeforeWord: "System.",
  lineAfterCursor: "",
  ...over,
});
const method = (over: Partial<ApexCandidateDto> = {}): ApexCandidateDto => ({
  label: "debug",
  kind: "method",
  detail: "void",
  params: ["Object"],
  ...over,
});

describe("buildInsertion — methods", () => {
  it("inserts placeholder-arg call snippets (fill-arguments style)", () => {
    const ins = buildInsertion(method({ detail: "String", params: ["Object", "Integer"] }), ctx({ lineBeforeWord: "x = System." }));
    expect(ins).toEqual({
      insertText: "debug(${1:Object}, ${2:Integer})$0",
      isSnippet: true,
      triggerSignatureHelp: true,
    });
  });
  it("void method in statement position gets the semicolon inside the snippet", () => {
    const ins = buildInsertion(method(), ctx({ lineBeforeWord: "  System." }));
    expect(ins.insertText).toBe("debug(${1:Object});$0");
  });
  it("non-void methods never gain a semicolon", () => {
    const ins = buildInsertion(method({ detail: "String" }), ctx({ lineBeforeWord: "System." }));
    expect(ins.insertText).toBe("debug(${1:Object})$0");
  });
  it("semicolon suppressed when text follows the caret on the line", () => {
    const ins = buildInsertion(method(), ctx({ lineAfterCursor: " x" }));
    expect(ins.insertText).toBe("debug(${1:Object})$0");
  });
  it("no-arg method inserts empty parens, no signature help", () => {
    const ins = buildInsertion(method({ label: "now", detail: "Datetime", params: [] }), ctx({ lineBeforeWord: "x = Datetime." }));
    expect(ins).toEqual({ insertText: "now()$0", isSnippet: true, triggerSignatureHelp: false });
  });
  it("no-arg void method in statement position still gets the semicolon", () => {
    const ins = buildInsertion(method({ label: "commit", params: [] }), ctx());
    expect(ins.insertText).toBe("commit();$0");
  });
  it("skips parens entirely when the next char is already (", () => {
    const ins = buildInsertion(method(), ctx({ nextChar: "(", lineAfterCursor: "()" }));
    expect(ins).toEqual({ insertText: "debug", isSnippet: false, triggerSignatureHelp: false });
  });
  it("methods without params info fall back to plain label", () => {
    const ins = buildInsertion(method({ params: null }), ctx());
    expect(ins).toEqual({ insertText: "debug", isSnippet: false, triggerSignatureHelp: false });
  });
});

describe("buildInsertion — types and constructors", () => {
  it("generic builtin types keep the <> snippet", () => {
    expect(buildInsertion({ label: "List", kind: "type" }, ctx({ lineBeforeWord: "" })).insertText).toBe("List<$0>");
    expect(buildInsertion({ label: "Map", kind: "type" }, ctx({ lineBeforeWord: "" })).insertText).toBe("Map<$1, $2>");
  });
  it("plain types insert the bare label", () => {
    expect(buildInsertion({ label: "Account", kind: "type" }, ctx())).toEqual({
      insertText: "Account", isSnippet: false, triggerSignatureHelp: false,
    });
  });
  it("constructors insert call parens", () => {
    expect(buildInsertion({ label: "Account", kind: "constructor" }, ctx()).insertText).toBe("Account($1)$0");
  });
  it("generic constructors combine <> and ()", () => {
    expect(buildInsertion({ label: "List", kind: "constructor" }, ctx()).insertText).toBe("List<$1>($2)$0");
  });
  it("constructor skips parens when they already follow", () => {
    expect(buildInsertion({ label: "Account", kind: "constructor" }, ctx({ nextChar: "(" })).insertText).toBe("Account");
  });
});

describe("isStatementPosition", () => {
  it("true for a bare receiver chain at line start", () => {
    expect(isStatementPosition("  System.")).toBe(true);
    expect(isStatementPosition("")).toBe(true);
  });
  it("false inside an expression", () => {
    expect(isStatementPosition("if (x) System.")).toBe(false);
    expect(isStatementPosition("foo(System.")).toBe(false);
    expect(isStatementPosition("Integer n = Math.")).toBe(false);
  });
});

describe("KEYWORD_SNIPPETS", () => {
  it("covers the control-flow blocks", () => {
    for (const kw of ["if", "for", "while", "try"]) expect(KEYWORD_SNIPPETS[kw]?.length).toBeGreaterThan(0);
    expect(KEYWORD_SNIPPETS.for).toHaveLength(2); // classic + for-each
    expect(KEYWORD_SNIPPETS.if[0].body).toContain("$0");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir desktop exec vitest run src/editor/apexSuggest.test.ts`
Expected: FAIL — module `./apexSuggest` not found.

- [x] **Step 3: Implement `desktop/src/editor/apexSuggest.ts`**

```ts
import type { ApexCandidateDto } from "../types";

/** Built-in Apex generics → snippet body that drops the cursor inside `<>`. */
const GENERIC_SNIPPETS: Record<string, string> = {
  List: "List<$0>",
  Set: "Set<$0>",
  Map: "Map<$1, $2>",
  Iterable: "Iterable<$0>",
  Iterator: "Iterator<$0>",
};

export interface InsertionCtx {
  /** Character directly after the caret ("" at end of line). */
  nextChar: string;
  /** Line text before the word being completed (includes the receiver chain). */
  lineBeforeWord: string;
  /** Line text from the caret to end of line. */
  lineAfterCursor: string;
}

export interface Insertion {
  insertText: string;
  isSnippet: boolean;
  /** Pop parameter hints after accepting (methods with params). */
  triggerSignatureHelp: boolean;
}

/** Statement position: nothing but the receiver chain before the word on this
 * line. ponytail: line-local heuristic, not syntax-aware — chains containing
 * calls or preceded by any expression text fall out as non-statement, so the
 * semicolon is only ever added in the unambiguous case. */
export function isStatementPosition(lineBeforeWord: string): boolean {
  return lineBeforeWord.replace(/[\w.$]*$/, "").trim() === "";
}

const plain = (label: string): Insertion => ({
  insertText: label,
  isSnippet: false,
  triggerSignatureHelp: false,
});

/** Insert-text for one candidate, mirroring rust-analyzer's fill-arguments
 * defaults: methods get placeholder-arg call snippets (skipped when the caret
 * already faces a paren), void methods in statement position carry the
 * semicolon inside the snippet (addSemicolonToUnit), constructors get parens. */
export function buildInsertion(c: ApexCandidateDto, ctx: InsertionCtx): Insertion {
  const generic = GENERIC_SNIPPETS[c.label];
  if (c.kind === "constructor") {
    if (ctx.nextChar === "(" || ctx.nextChar === "<") return plain(c.label);
    return {
      insertText: generic ? `${c.label}<$1>($2)$0` : `${c.label}($1)$0`,
      isSnippet: true,
      triggerSignatureHelp: false,
    };
  }
  if (c.kind === "method" && c.params) {
    if (ctx.nextChar === "(") return plain(c.label);
    const isVoid = (c.detail ?? "").toLowerCase() === "void";
    const semi =
      isVoid && isStatementPosition(ctx.lineBeforeWord) && ctx.lineAfterCursor.trim() === ""
        ? ";"
        : "";
    const args = c.params.map((p, i) => `\${${i + 1}:${p}}`).join(", ");
    return {
      insertText: `${c.label}(${args})${semi}$0`,
      isSnippet: true,
      triggerSignatureHelp: c.params.length > 0,
    };
  }
  if (generic) return { insertText: generic, isSnippet: true, triggerSignatureHelp: false };
  return plain(c.label);
}

export interface KeywordSnippet {
  label: string;
  detail: string;
  body: string;
}

/** Control-flow block snippets offered alongside the bare keywords. */
export const KEYWORD_SNIPPETS: Record<string, KeywordSnippet[]> = {
  if: [{ label: "if", detail: "if block", body: "if ($1) {\n\t$0\n}" }],
  for: [
    {
      label: "for",
      detail: "for (i) block",
      body: "for (Integer ${1:i} = 0; ${1:i} < ${2:size}; ${1:i}++) {\n\t$0\n}",
    },
    {
      label: "for",
      detail: "for (each : collection) block",
      body: "for (${1:SObject} ${2:item} : ${3:collection}) {\n\t$0\n}",
    },
  ],
  while: [{ label: "while", detail: "while block", body: "while ($1) {\n\t$0\n}" }],
  try: [
    {
      label: "try",
      detail: "try / catch block",
      body: "try {\n\t$0\n} catch (${1:Exception} e) {\n\t\n}",
    },
  ],
};
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir desktop exec vitest run src/editor/apexSuggest.test.ts`
Expected: PASS (all tests).

- [x] **Step 5: Commit**

```bash
git add desktop/src/editor/apexSuggest.ts desktop/src/editor/apexSuggest.test.ts
git commit -m "feat(editor): pure Apex insert-text builder — call snippets, void semicolon, keyword blocks"
```

---

### Task 3: Wire the builder into the Monaco provider + Apex language configuration

**Files:**
- Modify: `desktop/src/editor/monaco-apex.ts`

**Interfaces:**
- Consumes: `buildInsertion`, `KEYWORD_SNIPPETS` (Task 2); `ApexCandidateDto.detail/params` (Task 1).
- Produces: completion items with `command: editor.action.triggerParameterHints` (Task 7's provider answers it); language configuration for `"apex"`.

- [x] **Step 1: Rewrite `registerApexCompletion`'s mapping**

Remove the local `GENERIC_SNIPPETS` const (moved to `apexSuggest.ts`). Add import:
```ts
import { buildInsertion, KEYWORD_SNIPPETS } from "./apexSuggest";
```
Extend `KIND_RANK` with `constructor: "4",` and `monacoKind`'s map with `constructor: K.Constructor,`.

Replace the body of `provideCompletionItems` from `const word = ...` down with:

```ts
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const line = model.getLineContent(position.lineNumber);
      const ctx = {
        nextChar: line.slice(position.column - 1, position.column),
        lineBeforeWord: line.slice(0, word.startColumn - 1),
        lineAfterCursor: line.slice(position.column - 1),
      };
      const suggestions: import("monaco-editor").languages.CompletionItem[] = cands.map((c) => {
        const ins = buildInsertion(c, ctx);
        return {
          label: {
            label: c.label,
            detail: c.params ? `(${c.params.join(", ")})` : undefined,
            description: c.detail ?? undefined,
          },
          kind: monacoKind(monaco, c.kind),
          insertText: ins.insertText,
          insertTextRules: ins.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          sortText: (KIND_RANK[c.kind] ?? "5") + c.label.toLowerCase(),
          command: ins.triggerSignatureHelp
            ? { id: "editor.action.triggerParameterHints", title: "parameter hints" }
            : undefined,
          range,
        };
      });
      // Control-flow block snippets ride alongside their bare keyword ("50x"
      // sorts just above "5x", so the block is the preselected variant).
      for (const c of cands) {
        if (c.kind !== "keyword") continue;
        for (const s of KEYWORD_SNIPPETS[c.label] ?? []) {
          suggestions.push({
            label: { label: s.label, detail: ` ${s.detail}` },
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: "50" + s.label.toLowerCase(),
            range,
          });
        }
      }
      return { suggestions };
```

(If the `import("monaco-editor")` type annotation trips the build, drop the annotation — the array is structurally compatible.)

- [x] **Step 2: Add the language configuration**

In `configureMonacoApex`, right after `monaco.languages.register({ id: "apex" });` (inside the `registered` guard), add — mirroring the official salesforcedx-vscode `apex.configuration.json` minimal set:

```ts
  monaco.languages.setLanguageConfiguration("apex", {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'", notIn: ["string", "comment"] },
      { open: "/**", close: " */", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'" },
    ],
  });
```

- [x] **Step 3: Verify build + existing tests**

Run: `pnpm --dir desktop exec tsc --noEmit && pnpm --dir desktop exec vitest run && pnpm --dir desktop lint`
Expected: all PASS.

- [x] **Step 4: Commit**

```bash
git add desktop/src/editor/monaco-apex.ts
git commit -m "feat(editor): method call snippets, keyword blocks and Apex language configuration in Monaco"
```

---

### Task 4: e2e — call snippets, semicolon, auto-close, keyword blocks

**Files:**
- Create: `desktop/e2e/apex-completion-snippets.spec.ts`

**Interfaces:**
- Consumes: `gotoApp(page, overrides)` (fixtures.ts — overrides patch the mocked `apex_complete` response verbatim) and `MonacoEditor` POM (monaco.ts). Unmocked commands resolve `null` (fixtures.ts line 326), so the signature-help provider added later degrades silently here.

- [x] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";

/** Editor-UX e2e for completion maturity: placeholder-arg call snippets,
 * the statement-position semicolon, quote auto-closing, and keyword block
 * snippets. Deterministic candidates come from the mocked IPC (fixtures.ts);
 * what's under test is the buffer Monaco produces after accepting. */

async function openApex(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  return new MonacoEditor(page);
}

const DEBUG_METHOD = [{ label: "debug", kind: "method", detail: "void", params: ["Object"] }];

test("accepting a void method in statement position inserts args and semicolon", async ({ page }) => {
  await gotoApp(page, { apex_complete: DEBUG_METHOD });
  const editor = await openApex(page);

  await editor.setText("System.de");
  await editor.waitForSuggestion("debug");
  await editor.acceptSuggestion();

  await expect.poll(() => editor.text()).toContain("System.debug(Object);");
});

test("accepting a no-arg non-void method inserts empty parens without semicolon", async ({ page }) => {
  await gotoApp(page, {
    apex_complete: [{ label: "now", kind: "method", detail: "Datetime", params: [] }],
  });
  const editor = await openApex(page);

  await editor.setText("Datetime.n");
  await editor.waitForSuggestion("now");
  await editor.acceptSuggestion();

  const text = await editor.text();
  expect(text).toContain("Datetime.now()");
  expect(text).not.toContain(";");
});

test("existing call parens are not duplicated", async ({ page }) => {
  await gotoApp(page, { apex_complete: DEBUG_METHOD });
  const editor = await openApex(page);

  await editor.setValueViaApi("System.de()");
  // Park the caret between "de" and "(".
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await editor.waitForSuggestion("debug");
  await editor.acceptSuggestion();

  const text = await editor.text();
  expect(text).toContain("System.debug()");
  expect(text).not.toContain("((");
  expect(text).not.toContain("))");
});

test("typing a single quote auto-closes the pair", async ({ page }) => {
  await gotoApp(page);
  const editor = await openApex(page);

  await editor.setText("String s = ");
  await editor.type("'");

  await expect.poll(() => editor.text()).toContain("''");
});

test("accepting the if keyword block snippet inserts a body", async ({ page }) => {
  await gotoApp(page, { apex_complete: [{ label: "if", kind: "keyword" }] });
  const editor = await openApex(page);

  await editor.setText("if");
  await editor.waitForSuggestion("if block");
  await editor.acceptSuggestion();

  await expect.poll(() => editor.text()).toContain("if () {");
});
```

- [x] **Step 2: Run the new spec + the existing completion spec (regression)**

Run: `pnpm --dir desktop exec playwright test e2e/apex-completion-snippets.spec.ts e2e/completion.spec.ts`
Expected: all PASS — including the pre-existing "List<> generic snippet" test, which now flows through `buildInsertion`.
If the "if block" suggestion isn't preselected on some run, accepting the top item still inserts the block because "50if" sorts above "5if"; if the widget text match is flaky, match `waitForSuggestion("if")` and assert the buffer instead.

- [x] **Step 3: Commit**

```bash
git add desktop/e2e/apex-completion-snippets.spec.ts
git commit -m "test(e2e): completion maturity — call snippets, semicolon, auto-close, keyword blocks"
```

---

### Task 5: Constructor candidates after `new` (Rust kind + e2e)

**Files:**
- Modify: `crates/apex-lang/src/candidate.rs` (enum)
- Modify: `crates/apex-lang/src/ast/engine.rs` (`push_types` gains a kind param; TypeOnly arm; tests)
- Modify: `desktop/src-tauri/src/dto.rs` (kind string)
- Modify: `desktop/e2e/apex-completion-snippets.spec.ts` (one test)

**Interfaces:**
- Produces: wire kind string `"constructor"`; the TS builder (Task 2) and provider maps (Task 3) already handle it.

- [x] **Step 1: Update the failing tests first**

In `crates/apex-lang/src/ast/engine.rs` tests: `still_completes_types_in_expression_position` and `offers_types_after_new` currently assert `CandidateKind::Type` after `new` — change both to `CandidateKind::Constructor`. Add:

```rust
#[test]
fn new_expression_offers_constructor_kind() {
    let ost = ost();
    let src = "Object o = new Stri";
    let cands = complete_source(src, src.len(), &ost);
    assert!(cands.iter().any(|c| c.label == "String" && c.kind == CandidateKind::Constructor));
    // Plain type positions are untouched.
    let bare = complete_source("Stri", 4, &ost);
    assert!(bare.iter().any(|c| c.label == "String" && c.kind == CandidateKind::Type));
}
```

Run: `cargo test -p apex-lang new_expression_offers` — expected: compile error (no `Constructor` variant).

- [x] **Step 2: Implement**

`candidate.rs`: add `Constructor,` to `CandidateKind` (after `Type`).

`engine.rs`: give `push_types` a kind parameter:
```rust
fn push_types(candidates: &mut Vec<Candidate>, prefix: &str, ost: &Ost, kind: CandidateKind) {
    for ty in all_types(ost) {
        push_if_matches(candidates, prefix, &ty.name, kind.clone());
    }
    for p in PRIMITIVES {
        push_if_matches(candidates, prefix, p, kind.clone());
    }
    for b in BUILTIN_TYPES {
        push_if_matches(candidates, prefix, b, kind.clone());
    }
}
```
(adjust `push_if_matches` to take `kind: CandidateKind` by value as it already does). Call sites: `TypeOnly` arm passes `CandidateKind::Constructor`, `Bare` arm passes `CandidateKind::Type`.

`dto.rs` `candidate_kind_str`: add `ApexCandidateKind::Constructor => "constructor",`.

- [x] **Step 3: Run Rust tests**

Run: `cargo test -p apex-lang && (cd desktop/src-tauri && cargo test)`
Expected: PASS.

- [x] **Step 4: Add the e2e test**

Append to `desktop/e2e/apex-completion-snippets.spec.ts`:

```ts
test("accepting a constructor after new inserts call parens", async ({ page }) => {
  await gotoApp(page, { apex_complete: [{ label: "Account", kind: "constructor" }] });
  const editor = await openApex(page);

  await editor.setText("Account a = new Acc");
  await editor.waitForSuggestion("Account");
  await editor.acceptSuggestion();

  await expect.poll(() => editor.text()).toContain("new Account()");
});
```

Run: `pnpm --dir desktop exec playwright test e2e/apex-completion-snippets.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add crates/apex-lang/src/candidate.rs crates/apex-lang/src/ast/engine.rs desktop/src-tauri/src/dto.rs desktop/e2e/apex-completion-snippets.spec.ts
git commit -m "feat(apex-complete): constructor kind after new — call-paren snippets"
```

---

### Task 6: Signature-help engine in apex-lang

**Files:**
- Create: `crates/apex-lang/src/ast/signature.rs`
- Modify: `crates/apex-lang/src/ast/mod.rs` (`pub mod signature;`)
- Modify: `crates/apex-lang/src/ast/complete.rs` (make `receiver_before_dot` and `enclosing_method` `pub(crate)`)
- Modify: `crates/apex-lang/src/ast/engine.rs` (`signature_help_source` wrap + test)
- Modify: `crates/apex-lang/src/lib.rs` (`pub use ast::engine::signature_help_source;`)

**Interfaces:**
- Produces (consumed by Task 7):
  ```rust
  // crates/apex-lang/src/ast/signature.rs
  pub struct Signature { pub label: String, pub params: Vec<String> }
  pub struct SignatureHelp { pub signatures: Vec<Signature>, pub active_signature: usize, pub active_parameter: usize }
  pub fn signature_help(src: &str, cursor: usize, ost: &Ost) -> Option<SignatureHelp>
  // crates/apex-lang/src/ast/engine.rs
  pub fn signature_help_source(src: &str, cursor: usize, ost: &Ost) -> Option<SignatureHelp>  // anonymous-Apex wrapping
  ```

- [x] **Step 1: Write the failing tests**

Tests inside `signature.rs` (own small OST fixture) + one wrap test in `engine.rs`:

```rust
// signature.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Method, Namespace, Ost, TypeKind};

    fn ost() -> Ost {
        Ost {
            namespaces: vec![Namespace {
                name: "System".into(),
                types: vec![ApexType {
                    name: "String".into(),
                    kind: TypeKind::Class,
                    methods: vec![
                        Method { name: "valueOf".into(), return_type: "String".into(), params: vec!["Integer".into()], is_static: true },
                        Method { name: "valueOf".into(), return_type: "String".into(), params: vec!["Long".into(), "Integer".into()], is_static: true },
                    ],
                    properties: vec![], parent_class: None, interfaces: vec![], enum_values: vec![],
                }],
            }],
            org_types: vec![],
        }
    }

    fn wrap(body: &str) -> (String, usize) {
        let prefix = "class C { void m() { ";
        (format!("{prefix}{body} }} }}"), prefix.len() + body.len())
    }

    #[test]
    fn resolves_a_static_call_with_overloads() {
        let (src, cur) = wrap("String.valueOf(");
        let h = signature_help(&src, cur, &ost()).expect("signature help");
        assert_eq!(h.signatures.len(), 2);
        assert_eq!(h.signatures[0].label, "valueOf(Integer) : String");
        assert_eq!(h.active_parameter, 0);
        assert_eq!(h.active_signature, 0);
    }

    #[test]
    fn comma_advances_the_active_parameter_and_signature() {
        let (src, cur) = wrap("String.valueOf(1, ");
        let h = signature_help(&src, cur, &ost()).unwrap();
        assert_eq!(h.active_parameter, 1);
        // First overload (1 param) can't fit arg index 1 → the 2-param one is active.
        assert_eq!(h.active_signature, 1);
    }

    #[test]
    fn nested_calls_resolve_the_innermost() {
        let (src, cur) = wrap("outer(String.valueOf(");
        let h = signature_help(&src, cur, &ost()).unwrap();
        assert!(h.signatures[0].label.starts_with("valueOf"));
    }

    #[test]
    fn own_class_methods_resolve_from_the_ast() {
        let src = "class C { void run(Integer count, String name) {} void m() { run( } }";
        let cur = src.find("run( ").unwrap() + 4;
        let h = signature_help(src, cur, &ost()).unwrap();
        assert_eq!(h.signatures[0].label, "run(Integer count, String name) : void");
        assert_eq!(h.signatures[0].params, vec!["Integer count", "String name"]);
    }

    #[test]
    fn closed_or_absent_calls_yield_none() {
        let (src, cur) = wrap("String.valueOf(1); ");
        assert!(signature_help(&src, cur, &ost()).is_none());
        let (src2, cur2) = wrap("Integer x = 1; ");
        assert!(signature_help(&src2, cur2, &ost()).is_none());
    }
}
```

```rust
// engine.rs tests — anonymous Apex goes through the same wrap-retry as completion
#[test]
fn signature_help_works_for_bare_anonymous_apex() {
    let ost = ost();
    let src = "String.valueOf(";
    let h = signature_help_source(src, src.len(), &ost).expect("wrapped signature help");
    assert_eq!(h.signatures[0].label, "valueOf(Integer) : String");
}
```

Run: `cargo test -p apex-lang signature` — expected: compile error (module missing).

- [x] **Step 2: Implement `crates/apex-lang/src/ast/signature.rs`**

```rust
//! Signature help: locate the innermost unclosed call before the caret, count
//! top-level commas for the active parameter, resolve the callee's overloads —
//! OST-backed receivers via the same inference path as completion, bare calls
//! against the edited class's own AST methods.

use super::complete::{enclosing_method, receiver_before_dot};
use super::infer::{infer, InferCtx};
use super::lexer::{lex_code, Tok};
use super::parser::{parse, parse_expression};
use super::scope::bindings_at;
use super::tree::{Member, TypeDecl};
use super::types::Type;
use crate::symbols::{supertype_chain, Ost};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub label: String,
    pub params: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureHelp {
    pub signatures: Vec<Signature>,
    pub active_signature: usize,
    pub active_parameter: usize,
}

/// The innermost unclosed call before `cursor`.
struct Call {
    name: String,
    name_end: usize,
    name_len: usize,
    arg_index: usize,
}

pub fn signature_help(src: &str, cursor: usize, ost: &Ost) -> Option<SignatureHelp> {
    let cursor = cursor.min(src.len());
    let call = enclosing_call(src, cursor)?;
    let cu = parse(src);
    let (class, method) = enclosing_method(&cu, cursor)?;
    let bindings = bindings_at(class, method, cursor);

    let signatures = match receiver_before_dot(src, call.name_end, call.name_len) {
        Some(receiver) => {
            let ctx = InferCtx { bindings: &bindings, ost, this_type: &class.name };
            let ty = parse_expression(&receiver)
                .map(|e| infer(&e, &ctx))
                .unwrap_or(Type::Unknown);
            ost_overloads(ost, &ty, &call.name)
        }
        None => own_overloads(class, &call.name),
    };
    if signatures.is_empty() {
        return None;
    }
    let active_signature = signatures
        .iter()
        .position(|s| s.params.len() > call.arg_index)
        .unwrap_or(0);
    Some(SignatureHelp { signatures, active_signature, active_parameter: call.arg_index })
}

/// Scan back from the caret for an unmatched `(`; commas at depth 0 count the
/// active parameter. Statement boundaries (`;`, `{`, `}`) at depth 0 end the
/// search. ponytail: token-level scan — an unclosed `[SELECT …` before the call
/// isn't special-cased; the parse simply yields no signature.
fn enclosing_call(src: &str, cursor: usize) -> Option<Call> {
    let toks = lex_code(&src[..cursor]);
    let mut depth = 0i32;
    let mut commas = 0usize;
    for i in (0..toks.len()).rev() {
        let t = &toks[i];
        match t.kind {
            Tok::RParen | Tok::RBracket => depth += 1,
            Tok::LBracket if depth > 0 => depth -= 1,
            Tok::LParen => {
                if depth > 0 {
                    depth -= 1;
                    continue;
                }
                let callee = toks.get(i.checked_sub(1)?)?;
                if callee.kind != Tok::Ident {
                    return None;
                }
                return Some(Call {
                    name: callee.text(src).to_string(),
                    name_end: callee.end,
                    name_len: callee.end - callee.start,
                    arg_index: commas,
                });
            }
            Tok::Comma if depth == 0 => commas += 1,
            Tok::Semi | Tok::LBrace | Tok::RBrace if depth == 0 => return None,
            _ => {}
        }
    }
    None
}

fn ost_overloads(ost: &Ost, ty: &Type, name: &str) -> Vec<Signature> {
    let at = match ty {
        Type::Named(n) => ost.org_type(n).or_else(|| ost.type_in("System", n)),
        Type::Primitive(p) => ost.type_in("System", p.name()),
        _ => None,
    };
    let Some(at) = at else { return Vec::new() };
    let mut out = Vec::new();
    for t in supertype_chain(ost, at) {
        for m in &t.methods {
            if m.name.eq_ignore_ascii_case(name) {
                out.push(sig(&m.name, &m.params, &m.return_type));
            }
        }
    }
    out
}

fn own_overloads(class: &TypeDecl, name: &str) -> Vec<Signature> {
    class
        .members
        .iter()
        .filter_map(|m| match m {
            Member::Method(me) if me.name.eq_ignore_ascii_case(name) => {
                let params: Vec<String> =
                    me.params.iter().map(|p| format!("{} {}", p.ty, p.name)).collect();
                let ret = me.return_type.clone().unwrap_or_else(|| "void".into());
                Some(sig(&me.name, &params, &ret))
            }
            _ => None,
        })
        .collect()
}

fn sig(name: &str, params: &[String], ret: &str) -> Signature {
    Signature {
        label: format!("{name}({}) : {ret}", params.join(", ")),
        params: params.to_vec(),
    }
}
```

Notes for the implementer:
- If `infer`'s receiver resolution needs the receiver's own inheritance, `ost_overloads` already walks `supertype_chain`.
- Check the exact shape of `Tok` variants against `lexer.rs` (`Tok::Comma`, `Tok::Semi`, `Tok::LBrace`, `Tok::RBrace`, `Tok::LBracket`, `Tok::RBracket` all exist — they are used in `context.rs`).
- In `complete.rs`, change `fn receiver_before_dot` and `fn enclosing_method` to `pub(crate) fn`.

`crates/apex-lang/src/ast/mod.rs`: add `pub mod signature;` (alphabetical position).

`crates/apex-lang/src/ast/engine.rs`: add (near `complete_source`):

```rust
use super::signature::{signature_help, SignatureHelp};

/// Signature help for `src` at `cursor`, with the same anonymous-Apex
/// wrap-retry as [`complete_source`].
pub fn signature_help_source(src: &str, cursor: usize, ost: &Ost) -> Option<SignatureHelp> {
    let cursor = cursor.min(src.len());
    if let Some(h) = signature_help(src, cursor, ost) {
        return Some(h);
    }
    let class_prefix = "class __Anon {\n";
    let wrapped = format!("{class_prefix}{src}\n}}");
    if let Some(h) = signature_help(&wrapped, cursor + class_prefix.len(), ost) {
        return Some(h);
    }
    let method_prefix = "class __Anon {\nvoid __anon() {\n";
    let wrapped = format!("{method_prefix}{src}\n}}\n}}");
    signature_help(&wrapped, cursor + method_prefix.len(), ost)
}
```

`crates/apex-lang/src/lib.rs`: add `pub use ast::engine::signature_help_source;` after the `complete_source` export.

- [x] **Step 3: Run tests**

Run: `cargo test -p apex-lang`
Expected: PASS (all new signature tests + no regressions).

- [x] **Step 4: Commit**

```bash
git add crates/apex-lang/src/ast/signature.rs crates/apex-lang/src/ast/mod.rs crates/apex-lang/src/ast/complete.rs crates/apex-lang/src/ast/engine.rs crates/apex-lang/src/lib.rs
git commit -m "feat(apex-lang): signature-help engine — enclosing call, overloads, active parameter"
```

---

### Task 7: Signature help — IPC, Monaco provider, e2e

**Files:**
- Modify: `crates/features/src/apex_complete.rs` (new method on `ApexCompleter`)
- Modify: `desktop/src-tauri/src/dto.rs` (+ test)
- Modify: `desktop/src-tauri/src/completion.rs`
- Modify: `desktop/src-tauri/src/lib.rs` (command + `generate_handler!` registration)
- Modify: `desktop/src/types.ts`
- Modify: `desktop/src/ipc/apex.ts`
- Modify: `desktop/src/editor/monaco-apex.ts` (provider)
- Modify: `desktop/e2e/fixtures.ts` (default mock)
- Modify: `desktop/e2e/apex-completion-snippets.spec.ts` (test)

**Interfaces:**
- Consumes: `apex_lang::signature_help_source` (Task 6), `Insertion.triggerSignatureHelp` command (Task 3).
- Produces:
  ```rust
  // features
  pub async fn signature_help(&self, invoker: &SfInvoker, org_id: &str, src: &str, cursor: usize)
      -> Result<Option<apex_lang::ast::signature::SignatureHelp>, SfError>
  ```
  ```ts
  // types.ts
  export interface ApexSignatureDto { label: string; params: string[] }
  export interface ApexSignatureHelpDto {
    signatures: ApexSignatureDto[];
    activeSignature: number;
    activeParameter: number;
  }
  // ipc/apex.ts
  export function apexSignatureHelp(src: string, offset: number): Promise<ApexSignatureHelpDto | null>
  ```

- [x] **Step 1: Write the failing DTO test**

In `desktop/src-tauri/src/dto.rs` tests:

```rust
#[test]
fn signature_help_dto_maps_camel_case() {
    let h = apex_lang::ast::signature::SignatureHelp {
        signatures: vec![apex_lang::ast::signature::Signature {
            label: "debug(Object) : void".into(),
            params: vec!["Object".into()],
        }],
        active_signature: 0,
        active_parameter: 1,
    };
    let dto = SignatureHelpDto::from(&h);
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["activeParameter"], 1);
    assert_eq!(json["signatures"][0]["label"], "debug(Object) : void");
}
```

Run: `cd desktop/src-tauri && cargo test signature_help_dto` — expected: compile error.

- [x] **Step 2: Implement the Rust side**

`crates/features/src/apex_complete.rs` (next to `complete`):

```rust
    /// Signature help at `cursor` against the org's base OST. On-demand type
    /// acquisition is skipped: inside `name(` the receiver was already fetched
    /// while completing the member, or the org is indexed.
    pub async fn signature_help(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        src: &str,
        cursor: usize,
    ) -> Result<Option<apex_lang::ast::signature::SignatureHelp>, SfError> {
        let ost = self.ensure_base(invoker, org_id).await?;
        Ok(apex_lang::signature_help_source(src, cursor, &ost))
    }
```

`desktop/src-tauri/src/dto.rs`:

```rust
/// One callable signature for the Monaco signature-help widget.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureDto {
    pub label: String,
    pub params: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelpDto {
    pub signatures: Vec<SignatureDto>,
    pub active_signature: usize,
    pub active_parameter: usize,
}

impl From<&apex_lang::ast::signature::SignatureHelp> for SignatureHelpDto {
    fn from(h: &apex_lang::ast::signature::SignatureHelp) -> Self {
        SignatureHelpDto {
            signatures: h.signatures.iter().map(|s| SignatureDto {
                label: s.label.clone(),
                params: s.params.clone(),
            }).collect(),
            active_signature: h.active_signature,
            active_parameter: h.active_parameter,
        }
    }
}
```

`desktop/src-tauri/src/completion.rs`:

```rust
pub(crate) async fn apex_signature_help(
    src: String,
    offset: usize,
    state: &AppState,
) -> Result<Option<dto::SignatureHelpDto>, CommandError> {
    let org = current_org(state).unwrap_or_else(|| "default".to_string());
    let help = state
        .apex
        .signature_help(&state.invoker, &org, &src, offset)
        .await
        .map_err(CommandError::from)?;
    Ok(help.as_ref().map(dto::SignatureHelpDto::from))
}
```

`desktop/src-tauri/src/lib.rs` — next to `apex_complete`:

```rust
#[tauri::command]
async fn apex_signature_help(
    src: String,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Option<dto::SignatureHelpDto>, CommandError> {
    completion::apex_signature_help(src, offset, &state).await
}
```
and add `apex_signature_help` to the `tauri::generate_handler![…]` list.

- [x] **Step 3: Implement the frontend side**

`desktop/src/types.ts` — add `ApexSignatureDto` / `ApexSignatureHelpDto` (Interfaces above).

`desktop/src/ipc/apex.ts`:

```ts
import type { ApexSignatureHelpDto } from "../types";  // merge into the existing type import

/** Signature help for the call at `offset` in Apex `src` (null when none). */
export function apexSignatureHelp(
  src: string,
  offset: number,
): Promise<ApexSignatureHelpDto | null> {
  return invoke<ApexSignatureHelpDto | null>("apex_signature_help", { src, offset });
}
```

`desktop/src/editor/monaco-apex.ts` — new registration (HMR-safe slot pattern, same as completion), called from `configureMonacoApex` alongside `registerApexCompletion`:

```ts
/** Register signature help backed by `apex_signature_help`. Triggered by `(`/`,`
 * and by the completion items' triggerParameterHints command. HMR-safe. */
function registerApexSignatureHelp(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufApexSignatureHelp?.dispose();
  slot.__ufApexSignatureHelp = monaco.languages.registerSignatureHelpProvider("apex", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: async (model, position) => {
      let help: import("../types").ApexSignatureHelpDto | null;
      try {
        help = await apexSignatureHelp(model.getValue(), model.getOffsetAt(position));
      } catch {
        return null;
      }
      if (!help || help.signatures.length === 0) return null;
      return {
        value: {
          signatures: help.signatures.map((s) => ({
            label: s.label,
            parameters: s.params.map((p) => ({ label: p })),
          })),
          activeSignature: help.activeSignature,
          activeParameter: help.activeParameter,
        },
        dispose: () => {},
      };
    },
  });
}
```
Import `apexSignatureHelp` from `../ipc/apex` and call `registerApexSignatureHelp(monaco);` next to `registerApexCompletion(monaco);`.

`desktop/e2e/fixtures.ts` — add to `RESP` (near `apex_complete`): `apex_signature_help: null,`.

- [x] **Step 4: Add the e2e test**

Append to `desktop/e2e/apex-completion-snippets.spec.ts`:

```ts
test("accepting a method with params pops parameter hints", async ({ page }) => {
  await gotoApp(page, {
    apex_complete: DEBUG_METHOD,
    apex_signature_help: {
      signatures: [{ label: "debug(Object msg) : void", params: ["Object msg"] }],
      activeSignature: 0,
      activeParameter: 0,
    },
  });
  const editor = await openApex(page);

  await editor.setText("System.de");
  await editor.waitForSuggestion("debug");
  await editor.acceptSuggestion();

  const hints = page.locator(".parameter-hints-widget");
  await expect(hints).toBeVisible();
  await expect(hints).toContainText("debug(Object msg)");
});
```

- [x] **Step 5: Verify**

Run:
```bash
cargo test -p apex-lang && cargo test -p features && (cd desktop/src-tauri && cargo test)
pnpm --dir desktop exec tsc --noEmit && pnpm --dir desktop exec vitest run && pnpm --dir desktop lint
pnpm --dir desktop exec playwright test e2e/apex-completion-snippets.spec.ts
```
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add crates/features/src/apex_complete.rs desktop/src-tauri/src/dto.rs desktop/src-tauri/src/completion.rs desktop/src-tauri/src/lib.rs desktop/src/types.ts desktop/src/ipc/apex.ts desktop/src/editor/monaco-apex.ts desktop/e2e/fixtures.ts desktop/e2e/apex-completion-snippets.spec.ts
git commit -m "feat(editor): Apex signature help — engine command, Monaco provider, post-accept trigger"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only; fix regressions if any surface).

- [x] **Step 1: Rust suites**

Run: `cargo test --workspace` (fall back to per-crate: `cargo test -p apex-lang -p features` + `cd desktop/src-tauri && cargo test`).
Expected: all PASS, zero skipped-with-failure.

- [x] **Step 2: Frontend suites**

Run: `pnpm --dir desktop exec tsc --noEmit && pnpm --dir desktop exec vitest run && pnpm --dir desktop lint`
Expected: PASS.

- [x] **Step 3: Architecture guardrails**

Run: `scripts/check-arch.sh`
Expected: PASS (no new 800-line violations; `monaco-apex.ts` stays well under).

- [x] **Step 4: Full e2e suite**

Run: `pnpm --dir desktop e2e`
Expected: all specs PASS — including the pre-existing `completion.spec.ts` (`List<>` generic snippet, context menu, format) which exercises the refactored provider.

Known risk: auto-closing pairs are NEW app behavior. Any pre-existing spec that keyboard-types a literal `'`, `(`, `[` or `{` into an Apex buffer will now get the closing char inserted too. If such a spec fails, fix the TEST's expectation (the app behavior is the intended change) — do not remove the language configuration.

- [x] **Step 5: Report**

No commit. Report per-suite pass/fail counts verbatim; any failure is fixed (with its own targeted commit) before the plan is declared done.
