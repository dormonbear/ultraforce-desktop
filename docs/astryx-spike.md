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
