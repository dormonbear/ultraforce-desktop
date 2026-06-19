# sf-toolkit desktop (Tauri) — design system

> Date: 2026-06-18 · Aesthetic: terminal/instrument-panel pro · Source: ui-ux-pro-max
> + web practice (TablePlus/Beekeeper minimalism, LogRocket/Pencil&Paper dense-table UX).

## Direction

A precise developer **instrument**: OLED-dark, monospace-forward, one signal
accent. Minimal-but-powerful (TablePlus feel), dense-when-needed (DataGrip power
without the clutter). Beauty comes from restraint, hairlines, tabular alignment,
and one confident accent — not decoration.

## Color tokens (CSS variables, dark only for v1)

```css
--bg:        #0a0b0d;   /* app base (near-OLED)            */
--surface:   #111317;   /* panels                          */
--surface-2: #16181d;   /* cards / elevated                */
--surface-3: #1d2026;   /* hover / active rows             */
--hair:      #23262d;   /* hairline borders/dividers       */
--line:      #2b2f37;   /* stronger separators             */
--text:      #e6e8ec;   /* primary                         */
--text-dim:  #9aa0ab;   /* secondary                       */
--text-faint:#5c626d;   /* tertiary / placeholder          */
--accent:    #3ddc84;   /* SIGNAL GREEN — run/active/focus  */
--accent-press:#33c574;
--amber:     #ffb454;   /* warning                         */
--red:       #ff6b6b;   /* error/destructive               */
--blue:      #6cb6ff;   /* info / links                    */
```
Semantic only — never raw hex in components. Status: success=accent, warn=amber,
error=red. Focus ring = accent at 2px. Subtle accent glow allowed on focus only
(`box-shadow: 0 0 0 1px var(--accent), 0 0 12px -4px var(--accent)`).

## Typography

- **JetBrains Mono** everywhere (UI + code). Weights 400/500/700. `font-feature-
  settings: "tnum" 1, "ss02" 1;` (tabular numerals — required for data columns).
- Scale (px): 11 micro-label · 12 small · 13 body/cells · 14 input · 16 section ·
  20 wordmark. Line-height 1.5 body, 1.3 dense rows.
- Micro-labels: uppercase, `letter-spacing: 0.08em`, `--text-dim`, with a trailing
  hairline rule. Section headers carry the structure; whitespace + hairlines, not
  boxes-in-boxes.

## Layout

- Frameless-ish: 2px accent strip at the very top edge.
- Top bar (48px): wordmark `SF·TOOLKIT` + a live `● ORG` status chip (right).
- Left activity rail (52px, icon-only, Lucide): SOQL / Apex / Logs / Schema.
  Active item = accent left-bar + accent icon. Tooltips on hover.
- Main = a resizable two-pane: editor (top) / results (bottom) split, or
  list+detail for logs. Use `react-resizable-panels`.
- Spacing rhythm: 4/8/12/16/24. Panel padding 12–16. Density toggle on tables.

## Components

- **Editor**: Monaco, theme `sf-dark` via `defineTheme` (base `vs-dark`, inherit
  true; bg `--surface`, gutter `--bg`, selection accent@20%). Options: `minimap
  off`, `fontFamily JetBrains Mono`, `fontSize 13`, `fontLigatures true`,
  `renderLineHighlight "all"`, `scrollBeyondLastLine false`, `padding {top:10}`.
  SOQL/Apex completion + diagnostics fed from Rust (`soql-lang`) via Monaco
  `registerCompletionItemProvider` + `setModelMarkers`.
- **Result table** (TanStack Table + TanStack Virtual): sticky header, frozen
  first (id) column, **right-align + tabular numerals** for numeric/id columns,
  bold first column, zebra via `--surface` at 40%, row height density toggle
  (comfortable 32 / compact 24), column sort (aria-sort), click-to-copy cell,
  hairline column separators. Empty state: centered `--text-faint` "— no rows —".
- **Buttons**: primary = accent fill, `--bg` text, 3px radius, `RUN ▸` / `⟳`.
  Press scale 0.98, hover lighten. Disabled = 0.4 opacity. Secondary = ghost with
  hairline border. Min hit 32px tall.
- **Log list**: rows with status tick (accent/red), mono operation, right uppercase
  status, accent left-bar + faint accent tint when selected, hairline separators.
- **Toasts**: bottom-right, auto-dismiss 4s, `aria-live=polite`, accent/red bar.

## Motion

150–250ms, `ease-out` enter / faster exit; transform+opacity only; respect
`prefers-reduced-motion`. Animate: panel open, row hover tint, button press,
spinner, toast. No decorative motion.

## Non-negotiables (from the a11y/quality checklist)

- Contrast: body ≥4.5:1 on its surface (verify `--text` on `--surface`),
  dim ≥3:1. Focus rings visible (never removed). Color never the only signal
  (status has icon+text). Lucide SVG icons only — no emoji. `cursor: pointer` on
  clickables. Tabular numerals in every data column.
