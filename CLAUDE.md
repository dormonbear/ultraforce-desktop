# Project: Salesforce desktop toolkit (Rust + Tauri/React)

This is a SOQL / Anonymous-Apex / debug-log desktop tool with an Apex language engine
(`crates/apex-lang`), schema/SOQL tooling (`crates/sf-schema`, `crates/soql-lang`), and a
Tauri/React desktop UI (`desktop/`).

## Collaboration policy / 协作规则

- Write all new human-readable content in English first, followed by Simplified Chinese: comments, documentation, commits, PRs, issues, reviews and release notes. Keep identifiers, file names and log/error codes in English.
  所有新增的人类可读内容均先写英文，再写简体中文，包括注释、文档、提交、PR、议题、评审及发布说明；标识符、文件名及日志／错误代码保留英文。
- UI localization is pre-approved: provide English and Simplified Chinese for labels, messages, settings and errors; default to the browser/OS locale, use a minimal implementation and test it. Add a heavy dependency only with clear justification.
  UI 本地化已获批准：标签、消息、设置及错误均提供英文和简体中文，默认采用浏览器／操作系统语言，保持实现精简并添加测试；仅在理由充分时引入大型依赖。
- Before implementing any other new user-facing feature, command, panel, setting or integration, submit a short proposal covering the problem, design and scope for user review. Proceed autonomously with bug fixes, refactors, tests, privacy removal, dependency upgrades, triage, merges and releases.
  实现其他面向用户的新功能、命令、面板、设置或集成前，先提交涵盖问题、设计及范围的简短提案供用户审查。缺陷修复、重构、测试、隐私收集移除、依赖升级、分流、合并及发布可自主执行。
- Ship a regression test with every fix. Prioritize coverage reports and CI thresholds, native Tauri E2E, a Windows CI runner and real-org tests runnable against a CI scratch org. Preserve every verification command's exit code; avoid separator chaining that masks failures.
  每项修复均附带回归测试。优先完善覆盖率报告与 CI 阈值、原生 Tauri 端到端测试、Windows CI 运行器，以及可在 CI 临时组织上执行的真实组织测试。保留每个验证命令的退出码，避免用分隔符串联掩盖失败。

## Privacy

Before changing networking, logging, storage, dependencies, or error handling,
read [PRIVACY.md](PRIVACY.md) and verify the change preserves its policy in all
builds, including development and debug builds.

## Apex symbol model

For language-tooling work here — Apex completion, type/symbol resolution, inheritance,
diagnostics, SOQL handling — model Apex types on the Salesforce Tooling API **SymbolTable**
(`parentClass`, `interfaces`, `methods`, `properties` with `modifiers`/visibility,
`constructors`, `innerClasses`, `variables`, `namespace`). Inheritance / `super.` /
inherited-member completion = walk the `parentClass` chain and merge `interfaces`. Keep this
shape in `apex-lang`'s symbol model (`crates/apex-lang/src/symbols.rs`) and its AST engine
(`crates/apex-lang/src/ast/`) rather than inventing a divergent model.

## Architecture rules

Enforced by `scripts/check-arch.sh` (pre-commit + CI). These paid off real debt once —
don't reintroduce it:

- **Single Apex parsing stack.** `crates/apex-lang/src/ast/` is the only parser/completion
  engine. Never re-add the legacy CST modules (`lexer.rs`, `parser.rs`, `cst*.rs`,
  `complete.rs`, `resolve.rs` at the crate root) or a second lexer/AST.
- **IPC errors are `CommandError`.** Every `#[tauri::command]` returns
  `Result<T, CommandError>` (`desktop/src-tauri/src/error.rs`) with a user-readable
  message. Never `format!("{e:?}")` across the IPC boundary.
- **DTOs serialize camelCase.** Every struct crossing IPC carries
  `#[serde(rename_all = "camelCase")]` and lives in `dto.rs`; mirror it manually in
  `desktop/src/types.ts` (also camelCase). Change both sides in the same commit.
- **Frontend IPC goes through `desktop/src/ipc/`.** Command-name strings and
  `invoke()` appear only there, as typed functions grouped by domain. Components import
  from `ipc/*`, never `@tauri-apps/api/core` directly.
- **`lib.rs` is command shells only.** src-tauri is the composition root; orchestration
  lives in its modules (`soql_exec.rs`, `indexing.rs`, `state.rs`, …), not inline in
  commands. The `features` crate is the reusable use-case layer, not a mandatory facade.
- **Monaco setup is disposable-based.** Editor integrations live in `desktop/src/editor/`;
  registrations return/track disposables (HMR-safe), shared setup goes through
  `configureEditorBase` — no module-level `registered` booleans.
- **800-line cap per file** (ratchet: the grandfathered list in `check-arch.sh` may only
  shrink). Split by feature/domain before crossing it.

---

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
