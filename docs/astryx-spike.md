# Astryx migration

Branch: `spike/astryx-local`

## Status

- **Phase 1 done — Settings migrated.** `SettingsPage` now uses Astryx leaf
  components throughout: `Card`/`Text` for sections, `Heading`, `SegmentedControl`
  for the theme toggle, `Selector` for both dropdowns, `Switch` for the Apex
  confirm setting, and `Button` everywhere. Layout stays on Tailwind flex/gap.
- The theme bridge graduated from the spike: `AstryxThemeProvider`
  (`desktop/src/AstryxThemeProvider.tsx`) wraps the app and follows the existing
  light/dark theme. Verified visually in both modes.
- **Phase 2 done — simple dialogs, empty states, forms.**
  - `confirm.tsx`: Radix AlertDialog → Astryx `AlertDialog`; shadcn
    `ui/alert-dialog.tsx` deleted (orphaned). `ConfirmOptions.description`
    narrowed to `string` (Astryx API; all callers already passed strings).
  - `ConnectOrg.tsx`: form → `Selector`/`TextInput`/`Button`/`Card`, dialog →
    Astryx `Dialog` + `DialogHeader`.
  - `CliGuidance.tsx`: all three CLI-status screens → `EmptyState`, with
    `Code`/`IconButton`/`Text` for the copy-command and docs rows.
- **Known footgun**: Astryx `Button` runs `clickAction` inside
  `startTransition(async …)`. Awaiting `confirm()` from a `clickAction` would
  deadlock (the dialog-open state update joins the pending transition), so
  `confirm()` hops out via `setTimeout(…, 0)` — see the comment in
  `confirm.tsx`. Keep this in mind for any future imperative-dialog helpers.
- **Token bridge**: `styles.css` maps Astryx theme vars (`--color-*`,
  `--font-family-*`, `--radius-*`) onto the app's shadcn/Cursor palette, so
  Astryx components render in the app's colors, Inter/JetBrains Mono, and
  0.5rem radii. One mapping covers both modes (app vars flip under `.dark`).
- **Phase 3 done — small controls and dialog shells.**
  - `RunButton` → Astryx `Button` (`tooltip`/`isLoading`/`icon` replace the
    hand-rolled spinner + title attr). Uses `onClick`, not `clickAction`, so
    run handlers that await `confirm()` stay outside the transition.
  - `SchemaRefresh` → `IconButton` (built-in tooltip; shadcn Tooltip wrapper
    dropped).
  - `SourceDialog` / `LogDebugger` / SoqlPanel's large-result dialog →
    Astryx `Dialog` + `DialogHeader` shells (Monaco/debugger content
    unchanged; fixed-height inner wrappers replace DialogContent's h-[85vh]).
- shadcn `ui/dialog.tsx` still exists — `ui/command.tsx` (EntityCombobox)
  depends on it. Killable once the command palette migrates.
- Remaining candidates: `EntityCombobox`/command palette, `OrgSelector`,
  toggle-group consumers. Dense surfaces (result tables, Timeline, Trace
  Flags, Monaco panels, log analysis) stay bespoke.
- **Phase 4 done — finished the low-risk leaf migrations.**
  - `SettingsPage` "Privacy & Telemetry" — the shadcn `Checkbox` pair that
    arrived in the main merge migrated to Astryx `Switch` (matching the
    existing Apex-confirm toggle); fixed the `TS2304` merge fallout.
  - `EntityCombobox` (Trace Flags) → Astryx `Typeahead` + `createStaticSource`;
    exported props unchanged so `TraceFlagsTable` was untouched.
  - `OrgSelector` → Astryx `DropdownMenu` (menu-like: org picks + a "Connect
    another org" action; plain `onClick` avoids the `clickAction` transition
    footgun). Exported props unchanged; `App.tsx` untouched.
  - `LogDetailPane` tab switcher → Astryx `SegmentedControl` (same idiom as the
    Settings theme toggle).
  - `LogView` "Debug Only" / "Highlight" toggles → Astryx `CheckboxInput`
    (preserves the checkbox affordance; the component renders its own label, so
    the wrapping `<label>` was dropped).
  - Deleted shadcn primitives: `ui/checkbox.tsx`, `ui/command.tsx`,
    `ui/dialog.tsx`, `ui/toggle-group.tsx`, `ui/toggle.tsx`. npm dep `cmdk`
    removed (Task 1). No `@radix-ui/react-*` deps to remove: this repo uses the
    unified `radix-ui` meta-package, still imported by 7 surviving files
    (`DateTimePicker` + `ui/{badge,button,context-menu,dropdown-menu,scroll-area,tooltip}`),
    so it stays.
  - Remaining shadcn `ui/` files (consumer counts): `badge` (3), `button` (4),
    `context-menu` (3), `dropdown-menu` (2), `input` (4), `resizable` (4),
    `scroll-area` (1), `sonner` (1), `table` (1), `tooltip` (1). Dense surfaces
    stay bespoke.
- **Phase 5 done — finished the remaining leaf primitives.**
  - Task 4: `badge` → Astryx `Badge` (`success`/`error`, `label` prop),
    `input` → Astryx `TextInput` (`onChange(value, e)`, `startIcon`); deleted
    `ui/badge.tsx` + `ui/input.tsx`.
  - Task 5: shadcn buttons → Astryx `Button`/`IconButton`; deleted
    `ui/button.tsx`. Orphaned `class-variance-authority` dep removed. Footgun
    audit found zero awaited `confirm()` dialogs — all handlers use `onClick`.
  - Task 6 (menus + tooltip):
    - `TabStrip` "all tabs" menu → Astryx `DropdownMenu`/`DropdownMenuItem`
      (compound mode; icon-only `ghost` trigger via the `button` prop,
      `hasChevron={false}`; plain `onClick`, no `clickAction` transition).
    - `App.tsx` sidebar-nav tooltips → Astryx `Tooltip` (`content` prop,
      `placement="end"`); the shadcn `TooltipProvider` wrapper is gone (Astryx
      tooltips need no provider). Deleted `ui/tooltip.tsx` (App was the only
      importer).
  - **Kept on shadcn (genuine API mismatches, reported):**
    - `resultTable/Toolbar.tsx` **"Columns" dropdown** — a checkbox
      multi-select that must stay open across toggles and show a per-item check.
      Astryx `DropdownMenuItem` force-closes the menu on every click
      (`ctx.closeMenu()` → `popover.hide()`) and has no checkbox-item variant,
      so this usage cannot be expressed. Because that pins `ui/dropdown-menu.tsx`
      in place anyway, the sibling "Export" dropdown was left on shadcn too
      rather than blending two dropdown libraries in one file.
    - `LogListPane.tsx` **log-row context menu** — the trigger is a virtualized,
      absolutely-positioned row (`rowVirtualizer.measureElement` + `transform`).
      Astryx `ContextMenu` wraps the trigger in an extra block `div`, which would
      disrupt the per-row measurement/positioning; left on shadcn.
    - `Toolbar.tsx` **copy context menu** and `Explorer.tsx` context menus
      (Explorer out of Phase 5 scope) keep `ui/context-menu.tsx` alive
      regardless, so the copy menu stayed on shadcn (no file-deletion payoff).
  - Deleted this phase: `ui/badge.tsx`, `ui/input.tsx`, `ui/button.tsx`,
    `ui/tooltip.tsx`. Deps removed: `cmdk` (Phase 4, Task 1),
    `class-variance-authority` (Task 5).
  - **Stays bespoke (no clean Astryx swap):** `ui/table.tsx` (ResultTable dense
    core), `ui/resizable.tsx` (structural 4-panel layout), `ui/scroll-area.tsx`
    (no Astryx equivalent), `ui/sonner.tsx` (self-contained global toast infra).
  - Remaining shadcn `ui/` files after Phase 5 (consumer counts):
    `context-menu` (3: LogListPane, Explorer, Toolbar), `dropdown-menu`
    (1: Toolbar Columns), `resizable` (4), `scroll-area` (1), `sonner` (1),
    `table` (1).
  - **`radix-ui` meta-package verdict: still required.** Surviving importers:
    `DateTimePicker.tsx`, `ui/scroll-area.tsx`, `ui/dropdown-menu.tsx`,
    `ui/context-menu.tsx` (down from 7 pre-Phase-5). No per-package
    `@radix-ui/*` deps exist to prune.

## Original spike scope

- Install `@astryxdesign/core`, `@astryxdesign/theme-neutral`, and `@astryxdesign/cli`.
- Import Astryx component CSS and neutral theme CSS without importing Astryx reset.
- Wrap the app in an Astryx `Theme` bridge that follows the existing app theme.
- Add a small Astryx-built panel to Settings using `Card`, `Text`, and `Button`.

## Initial Findings

- TypeScript accepts the Astryx packages with the current React 19 setup.
- Vite production build succeeds without adding StyleX build plugins.
- Astryx can coexist with the current Tailwind/shadcn/Radix stack when limited to leaf UI.
- The CSS payload increases noticeably because `@astryxdesign/core/astryx.css` brings the full component stylesheet.

## Verification

- `rtk tsc --noEmit`
- `pnpm build`
- `pnpm lint`

## Recommendation

Keep this as a local experiment for low-risk surfaces such as Settings, simple dialogs, empty states, and form sections. Do not migrate dense project-specific surfaces yet: result tables, Timeline, Trace Flags, Monaco panels, and log analysis views still need bespoke behavior.
