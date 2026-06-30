# Settings Page Design

**Date:** 2026-06-30
**Status:** Approved

## Goal

Move configuration out of the top-bar gear popover (`WorkspaceSettings`) into a
dedicated **Settings page** rendered in the main content area, reached from a
gear icon pinned to the **bottom-left** of the activity rail. Consolidate all
current app configuration into one grouped settings center, leaving room for
future config (logging/debug defaults).

## Current state

- Settings today = the gear button in the top bar (`src/components/WorkspaceSettings.tsx`),
  a popover with: SOQL workspace root, Apex workspace root, Index scope.
- Theme toggle is a separate Sun/Moon button in the top bar (`useTheme`).
- The activity rail (`src/App.tsx`, 52px `<nav>`) holds SOQL / Apex / Logs / Schema(disabled),
  driven by the `RAIL` array and `active` state (`ActivePanel = "soql" | "apex" | "logs"`).
- Main area renders the active tool, or `SetupPage` when no usable org (`needsSetup`).

Config primitives (unchanged, reused as-is):
- `fs/workspace.ts` — `getRoot(tool)`, `setRootOverride(tool, path|null)`, `type Tool = "soql" | "apex"`
- `indexSettings.ts` — `getNamespacePolicy()`, `setNamespacePolicy(value)`
- `theme.tsx` — `useTheme() -> { theme, toggle }`
- `updater.ts` — `checkForUpdates()`; app version via `@tauri-apps/api/app` `getVersion()`

## Design

### Activity rail
Settings is **not** a tool in `RAIL`. Add a separate gear button at the bottom of
the `<nav>`, pushed down with `mt-auto`, reusing the existing rail-button styles
and active-highlight treatment. `ActivePanel` extends to include `"settings"`.

### Main area render order
1. `active === "settings"` → `<SettingsPage />` (reachable even when `needsSetup`)
2. else `needsSetup` → `<SetupPage />`
3. else → tool panels (unchanged)

`SettingsPage` mounts when first opened; it reloads its values on open (same as
today's popover) — no keep-alive needed.

### New component: `src/components/SettingsPage.tsx` (~130 lines)
Scrollable, width-limited page. Sections use existing app styling
(`text-[12px]`, `border-border`, `bg-card`):

1. **Appearance** — theme Light/Dark control. `useTheme` exposes only `{ theme, toggle }`;
   with two states a Light/Dark segmented control just calls `toggle()` when the user
   picks the non-active option (no `setTheme` needed, `theme.tsx` unchanged).
2. **Workspace** — SOQL root and Apex root: current path + `Change…` / `Reset`
   (logic moved verbatim from `WorkspaceSettings`: `pick`, `reset`, `onChanged`
   remount callback).
3. **Indexing** — Index scope select (All objects / Unmanaged only); changing it
   persists via `setNamespacePolicy` and triggers `reindex_org` for the active org
   (logic moved from `WorkspaceSettings`).
4. **About** — app name + version (`getVersion`) + `Check for updates` button
   (`checkForUpdates`).

The grouped structure leaves room for a future Logging/Debug section.

### Top bar
- Remove the gear button (`WorkspaceSettings`) entirely.
- Remove the Sun/Moon theme button entirely (theme now lives in Settings →
  Appearance; quick header toggle intentionally dropped).
- Command palette, Run history, Org selector, index progress, schema refresh: unchanged.

### Keyboard / command palette
- Add `⌘,` / `Ctrl+,` to open Settings.
- Add a "Settings" entry to `CommandPalette` (`src/components/CommandPalette.tsx`),
  consistent with its existing panel-switching entries.

## File changes
- **New** `src/components/SettingsPage.tsx`
- **Edit** `src/App.tsx` — extend `ActivePanel`; remove header gear + theme button;
  add bottom-rail Settings button; settings-first main render branch; `⌘,` shortcut.
- **Delete** `src/components/WorkspaceSettings.tsx` — its logic is absorbed into
  `SettingsPage` (orphan created by this change).
- **Edit** `src/components/CommandPalette.tsx` — add Settings entry.

## Out of scope
- No new persisted settings beyond what exists today.
- No logging/debug defaults yet (structure leaves room; not built now).
- No settings search, no per-section routing/URL.

## Verification
- `pnpm tsc` (typecheck) and `pnpm build` pass.
- Manual: gear sits bottom-left of rail; clicking opens Settings; all four sections
  work (theme switch, workspace change/reset, index scope reindex, version + update check);
  top bar no longer shows gear or theme button; `⌘,` and palette entry open Settings.
- Existing pure-function tests (`fs/workspace`, namespace policy) unaffected. No new
  component tests — App/page layer has no Tauri-mock harness, consistent with the codebase.
