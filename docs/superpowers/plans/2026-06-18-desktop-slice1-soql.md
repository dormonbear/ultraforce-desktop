# Desktop slice 1 — SOQL (Tauri + React) Implementation Plan

> Date: 2026-06-18 · Dir: `desktop/` (Tauri 2 + React 19 + Vite 7 + TS)
> Design contract: specs/2026-06-18-desktop-design-system.md (FOLLOW EXACTLY)
> Reuses Rust crates: features, soql-lang, sf-schema, sf-core (path deps)

First runnable, well-designed vertical slice: a Monaco SOQL editor that runs a
query through the existing Rust core and renders a TanStack result table — in the
terminal/instrument design language. No egui. Logic stays in the Rust crates;
`src-tauri` is a thin command layer.

## Global constraints

- `desktop/src-tauri` is already detached from the cargo workspace (`[workspace]`
  table appended). It path-depends on `../../crates/*`. Do NOT add it to the root
  workspace.
- Frontend stack (latest): Tailwind **v4** (`@tailwindcss/vite` plugin + CSS
  `@theme`), `lucide-react`, `@monaco-editor/react` + `monaco-editor`,
  `@tanstack/react-table`, `@tanstack/react-virtual`, `react-resizable-panels`.
  Install via pnpm (proxy is configured in env).
- Bundle JetBrains Mono + Chakra Petch from `src/assets/fonts/*.ttf` via `@font-face`.
- Use the EXACT color tokens / type scale / component rules from the design
  contract. No emoji (Lucide SVG only). Tabular numerals on every data column.
- Verify: `pnpm build` (tsc + vite) passes; `pnpm tauri build --no-bundle` (or
  `cargo build` in src-tauri) compiles the Rust side. Manual: `pnpm tauri dev`
  opens the window.

### Task 1: src-tauri command layer
- `src-tauri/Cargo.toml` deps: `features = { path = "../../crates/features" }`,
  `soql-lang = { path = "../../crates/soql-lang" }`,
  `sf-schema = { path = "../../crates/sf-schema" }`,
  `sf-core = { path = "../../crates/sf-core" }`, plus existing tauri/serde.
- In `lib.rs`: build one shared `Arc<SfInvoker>` (ProcessRunner) in a Tauri
  `State`. Add async command:
  ```rust
  #[derive(serde::Serialize)]
  struct TableDto { columns: Vec<String>, rows: Vec<Vec<String>>, total_size: u64 }
  #[tauri::command]
  async fn run_soql(query: String, state: State<'_, AppState>) -> Result<TableDto, String> {
      let table = features::soql::run_query_table(&state.invoker, &query).await
          .map_err(|e| format!("{e:?}"))?;
      Ok(TableDto { columns: table.columns, rows: table.rows, total_size: ... })
  }
  ```
  (Get `total_size` via `run_query` if needed, else drop it for slice 1 and use
  rows.len().) Register with `invoke_handler`. Tauri provides the async runtime —
  no manual tokio runtime needed (commands are async, tauri drives them).
- Commit: `feat(desktop): src-tauri run_soql command over features::soql`

### Task 2: Tailwind v4 + design tokens + fonts
- Add `@tailwindcss/vite` to `vite.config.ts`. Create `src/styles.css` with
  `@import "tailwindcss";`, the `@font-face` blocks, and a `@theme`/`:root`
  mapping ALL color tokens from the design contract to CSS variables +
  Tailwind theme colors (e.g. `--color-bg`, `--color-accent`, …). Set body
  `font-family: "JetBrains Mono"`, `font-feature-settings:"tnum" 1`, bg `--bg`,
  text `--text`. Import in `main.tsx`; delete `App.css`.
- A `Wordmark` uses Chakra Petch (`font-family` utility class).
- Commit: `feat(desktop): tailwind v4 theme tokens and bundled fonts`

### Task 3: app shell (accent strip / top bar / left rail / panels)
- `App.tsx`: full-height column → 2px accent strip; top bar (48px): `SF·TOOLKIT`
  wordmark + right `● ORG default` chip; body = left activity rail (52px,
  Lucide icons: Database=SOQL active, Terminal=Apex, ScrollText=Logs, Table=Schema,
  all but SOQL disabled/stub) + main area.
- Main = `react-resizable-panels` vertical split: top = editor pane, bottom =
  results pane. Micro-labels ("QUERY" / "RESULT") with trailing hairline.
- Commit: `feat(desktop): instrument app shell with rail and resizable panes`

### Task 4: Monaco SOQL editor + run
- `@monaco-editor/react` `<Editor>`; `beforeMount` registers theme `sf-dark`
  (`defineTheme`, base `vs-dark`, inherit true, bg `--surface`, etc. per
  contract) and a minimal `soql` language (id "soql", keywords SELECT/FROM/WHERE/
  LIMIT/ORDER/BY/AND/OR for highlight). Options per contract (minimap off,
  JetBrains Mono 13, ligatures, no scrollBeyondLastLine). Default value
  `SELECT Id, Name FROM Account LIMIT 10`.
- A primary `RUN ▸` button (accent) in the editor pane header; Cmd/Ctrl+Enter
  also runs. On run: `invoke<TableDto>("run_soql", { query })`; manage
  loading/error/result state; show spinner + disable button while pending; show
  an error box (red, mono) on reject.
- Commit: `feat(desktop): monaco SOQL editor wired to run_soql`

### Task 5: TanStack result table
- `components/ResultTable.tsx` using `@tanstack/react-table` +
  `@tanstack/react-virtual`: sticky header, first column bold + frozen, numeric/
  id columns right-aligned with tabular numerals, zebra rows, column sort
  (aria-sort), density toggle (comfortable 32 / compact 24 px) in the RESULT
  micro-label row, row count on the right, click-a-cell-to-copy. Empty state
  centered `--text-faint` "— no rows —". Virtualize when rows > 100.
- Commit: `feat(desktop): TanStack virtualized result table`

## Self-review
- [ ] src-tauri detached from workspace; path-deps compile; `run_soql` returns DTO.
- [ ] Tokens/fonts/type-scale match the design contract exactly; tabular numerals.
- [ ] Monaco `sf-dark` theme + SOQL highlight; Cmd+Enter runs; errors shown.
- [ ] Table: sticky header, bold/frozen first col, right-aligned numerics, sort,
      density toggle, virtualized, empty state.
- [ ] `pnpm build` green; src-tauri `cargo build` green; `pnpm tauri dev` opens.
- [ ] No emoji; Lucide icons; focus rings; cursor-pointer; reduced-motion safe.
