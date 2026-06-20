# Design: shadcn/ui migration

## Goal

Adopt shadcn/ui as the component layer for the SF·TOOLKIT desktop UI, replacing
hand-rolled components where a shadcn equivalent exists, **without losing the
Cursor editorial design** (warm-cream/warm-dark, single Cursor-Orange accent) or
the light/dark theming already shipped. Also add the two high-value pieces shadcn
unlocks for a developer tool: a ⌘K command palette and Sonner toasts.

## Context

- Stack: Tauri 2 + React 19 + Vite + Tailwind v4 (`@theme`), lucide icons.
- Current UI is fully hand-rolled (`desktop/src/components`, `desktop/src/panels`),
  styled with Tailwind utilities bound to semantic `@theme` tokens in
  `desktop/src/styles.css`; light/dark via `:root[data-theme="dark"]` + a
  `ThemeProvider` (`desktop/src/theme.tsx`).
- shadcn/ui officially supports Tailwind v4 (`@theme` / `@theme inline`, OKLCH),
  React 19 (no forwardRef, `data-slot`), Vite, and lucide — confirmed via context7.
- Already in use and KEPT: `@tanstack/react-table`, `@tanstack/react-virtual`
  (result-table virtualization), `react-resizable-panels` (shadcn `Resizable`
  wraps this same lib), Monaco editors.

## Scope (approved)

Full migration of every hand-rolled component that has a shadcn equivalent, **plus**
a ⌘K command palette and Sonner toasts.

## Architecture decision: dual-token bridge (Approach A)

Keep the existing Cursor `@theme` tokens AND add shadcn's semantic token set, both
pointing at the **same** Cursor palette (hex kept, not converted to OKLCH).

- Restructure `styles.css` to shadcn's convention: `:root { --background … }`,
  `.dark { … }`, and `@theme inline { --color-background: var(--background) … }`.
- Define the shadcn semantic roles mapped onto the Cursor palette:

  | shadcn token | light (Cursor) | dark (Cursor warm-dark) |
  |---|---|---|
  | `--background` | `#f7f7f4` canvas | `#1a1916` |
  | `--foreground` | `#26251e` ink | `#f2f1ec` |
  | `--card` / `--popover` | `#ffffff` surface-card | `#26241f` |
  | `--card-foreground` / `--popover-foreground` | `#26251e` | `#f2f1ec` |
  | `--primary` | `#f54e00` Cursor Orange | `#ff5a14` |
  | `--primary-foreground` | `#ffffff` | `#1a1611` |
  | `--secondary` | `#fafaf7` canvas-soft | `#211f1b` |
  | `--secondary-foreground` | `#26251e` | `#f2f1ec` |
  | `--muted` | `#fafaf7` | `#211f1b` |
  | `--muted-foreground` | `#807d72` | `#8c887d` |
  | `--accent` | `#e6e5e0` surface-strong (hover/active fill) | `#383530` |
  | `--accent-foreground` | `#26251e` | `#f2f1ec` |
  | `--destructive` | `#cf2d56` | `#ff6d8a` |
  | `--border` / `--input` | `#e6e5e0` hairline | `#33302a` |
  | `--ring` | `#f54e00` Cursor Orange | `#ff5a14` |
  | `--radius` | `0.5rem` (8px base; cards 12px) | same |

  Note: shadcn `--accent` is a neutral hover/selected FILL (not a brand color) —
  map it to surface-strong, NOT to Cursor Orange. Brand orange lives in
  `--primary` + `--ring`. A dedicated **success** token (`#1f8a65` / `#3fb488`)
  is added for status indicators (shadcn ships no success role).

- The existing Cursor `--color-*` tokens stay so un-migrated bespoke code keeps
  working; both sets resolve to the same palette → no visual drift during the
  incremental migration.

### Dark-mode alignment

Switch to shadcn's `.dark` class convention: `ThemeProvider` toggles
`class="dark"` on `<html>` (was `data-theme="dark"`), and the dark token block
moves from `[data-theme="dark"]` to `.dark`. Monaco theme switching is unchanged
(it keys off the `theme` state via `monacoTheme(theme)`).

## Setup

- Path alias `@` → `desktop/src` in `vite.config.ts` + `tsconfig` (`paths`).
- `src/lib/utils.ts` exporting `cn()` (`clsx` + `tailwind-merge`).
- `components.json`: `style: new-york`, `rsc: false`, `tsx: true`,
  `tailwind.cssVariables: true`, `iconLibrary: lucide`, aliases under `@/`.
- New deps: `clsx`, `tailwind-merge`, `class-variance-authority`,
  `tailwindcss-animate`, the `@radix-ui/*` packages pulled per component, `cmdk`
  (command palette), `sonner` (toasts). shadcn components are copied into
  `src/components/ui/` via the CLI (we own the code).

## Component migration map

| Existing | → shadcn | Notes |
|---|---|---|
| `RunButton` | `Button` | brand variant = primary |
| `StatusChip` (ApexPanel), Logs status | `Badge` | `success` + `destructive` variants |
| TABLE/TREE, TREE/LIMITS/RAW toggles | `ToggleGroup` | segmented control |
| `OrgSelector` | `DropdownMenu` | org list + active check |
| `DebugConfigRow` 11 native `<select>` + preset | `Select` | biggest a11y/visual win |
| `ResultTable` | `Table` (styling only) | **KEEP** TanStack + react-virtual virtualization; apply shadcn table classes to the existing virtualized rows |
| 3 panel `react-resizable-panels` | `Resizable` | wraps the same lib — drop-in styling |
| icon buttons (activity rail, theme toggle) | + `Tooltip` | |
| result / log scroll regions | `ScrollArea` | |

**Kept hand-rolled** (no good shadcn equivalent): closable multi-tab `TabStrip`
(shadcn `Tabs` is not closable-editor-tabs), `RecordTree`, `LogView`, the Monaco
editor wrappers (`SoqlEditor`, `ApexPanel` editor), the activity rail, and the
`.micro-label` pattern.

## New features

- **⌘K command palette** (`cmdk` via shadcn `Command` in a `CommandDialog`):
  actions — switch org, switch panel (SOQL / Apex / Logs), run current query,
  new tab, toggle theme. Opened by ⌘K / Ctrl-K (global key handler).
- **Sonner toasts**: replace the inline run-error states (SOQL `run_soql`, Apex
  `run_apex`, org-list error) with toasts. **Unchanged:** in-editor Monaco
  diagnostics (the SOQL/Apex squiggles) stay as editor markers, not toasts.

## Testing / verification

Per migrated unit, and again at the end:
- `npx tsc --noEmit` and `pnpm build` green.
- Vite + headless Playwright (mock Tauri IPC) screenshots in **both** light and
  dark, confirming the migrated component matches the pre-migration look (no
  Cursor drift) and renders with zero console errors.
- ⌘K: Playwright dispatches the shortcut, asserts the dialog opens, runs an action.
- Result table: confirm virtualization still works (large mock result set renders
  without all rows in the DOM).

## Sequencing (one branch `feat/shadcn-migration`, atomic commits)

1. Setup: `@` alias, `cn()`, `components.json`, deps.
2. Token bridge + `.dark` alignment (styles.css + ThemeProvider).
3. `Button` (RunButton) + `Badge` (status, success/destructive split).
4. `Select` (DebugConfigRow: 11 levels + preset).
5. `DropdownMenu` (OrgSelector).
6. `ToggleGroup` (view/detail toggles).
7. `Table` styling (ResultTable, keep virtualization) + `Resizable` + `ScrollArea` + `Tooltip`.
8. ⌘K `Command` palette.
9. Sonner toasts (run-error states).
10. Full light+dark screenshot acceptance; tsc + build.

## Non-goals / out of scope

- No OKLCH conversion (hex kept).
- No redesign of the Cursor visual language — this is a component-layer swap, the
  look must stay identical.
- No migration of `TabStrip` / `RecordTree` / `LogView` / Monaco wrappers / rail.
- Native Tauri window E2E (real org) stays a manual `pnpm tauri dev` check.
