# Astryx Migration Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining low-risk Astryx migrations on `spike/astryx-local`: fix the main-merge fallout in SettingsPage, migrate EntityCombobox, OrgSelector, and LogDetailPane's toggle group, and delete the shadcn primitives those migrations orphan.

**Architecture:** Continue the leaf-component strategy from Phases 1–3 (see `docs/astryx-spike.md`): swap shadcn/Radix leaf components for Astryx equivalents, keep Tailwind layout, keep dense surfaces (result tables, Timeline, Trace Flags table itself, Monaco panels, log analysis) bespoke. The Astryx theme bridge (`desktop/src/AstryxThemeProvider.tsx` + token mapping in `desktop/src/styles.css`) is already in place.

**Tech Stack:** React 19, `@astryxdesign/core` 0.1.x, Tailwind 4, Tauri 2, Vite.

## Global Constraints

- Branch: `spike/astryx-local` (main already merged in at 6138b40).
- **Footgun (from `docs/astryx-spike.md`):** Astryx `Button`'s `clickAction` runs inside `startTransition(async …)`. Any handler that awaits `confirm()` must use `onClick`, not `clickAction`, or it deadlocks. Same applies to any Astryx action-prop that wraps a transition.
- Do NOT import Astryx's reset CSS. Component CSS + neutral theme CSS are already imported in `main.tsx`.
- Reference migrations for style/idiom: `desktop/src/components/SettingsPage.tsx` (Phase 1), `desktop/src/components/ConnectOrg.tsx` and `desktop/src/components/confirm.tsx` (Phase 2), `desktop/src/components/RunButton.tsx` and `desktop/src/components/SchemaRefresh.tsx` (Phase 3).
- Astryx component APIs: read the `.d.ts` under `desktop/node_modules/@astryxdesign/core/dist/<Component>/` before using a component. Do not guess props.
- Verification for every task: `npx tsc --noEmit` (in `desktop/`), `pnpm lint`, `pnpm test`. Final task adds `pnpm build`.
- Each task = one commit. Conventional commits, no author attribution. Repo pre-commit runs `scripts/check-arch.sh`.
- Do not touch dense surfaces beyond the exact controls named. Do not "improve" adjacent code.
- Update `docs/astryx-spike.md` with a Phase 4 progress note in the final task only.

---

### Task 0: Fix SettingsPage merge fallout (telemetry checkboxes) — ✅ DONE (0ca3674)

> Outcome: Switch migration landed; tsc/lint/tests green. `ui/checkbox.tsx` NOT deleted — LogView.tsx still imports it (plan assumption wrong). Deletion + LogView migration moved to Task 3.

**Files:**
- Modify: `desktop/src/components/SettingsPage.tsx` (~lines 250–292, "Privacy & Telemetry" section)
- Delete: `desktop/src/components/ui/checkbox.tsx` (orphaned after this fix; verify zero remaining imports first)

**Problem:** The merge of main brought a "Privacy & Telemetry" section using shadcn `<Checkbox checked onCheckedChange>` but the Astryx branch removed the shadcn imports from this file. `npx tsc --noEmit` currently fails with `TS2304: Cannot find name 'Checkbox'` at lines 263 and 279.

**Requirements:**
- Replace both `Checkbox` usages with Astryx `Switch`, matching the existing "Apex confirm" setting in the same file (Phase 1 pattern). Keep the label/description copy and `TELEMETRY_DISCLOSURE` block exactly as-is.
- Preserve behavior: toggling calls `changeTelemetry({ ...telemetry, localEnabled/remoteEnabled: <bool> })`.
- Check `Switch`'s `.d.ts` for its change-prop signature (it is not `onCheckedChange`).
- After the fix, confirm `ui/checkbox.tsx` has no importers (`grep -r "ui/checkbox" desktop/src`) and delete it.

**Interfaces:**
- Consumes: existing `telemetry` state + `changeTelemetry` in SettingsPage (do not change their types).
- Produces: green `tsc` baseline for all later tasks.

**Steps:**
- [ ] Read the broken section and the existing Astryx `Switch` usage in the same file.
- [ ] Replace the two `Checkbox` usages with `Switch`; adjust label markup only as much as the Switch pattern requires.
- [ ] `npx tsc --noEmit` → 0 errors; `pnpm lint` clean; `pnpm test` green.
- [ ] Delete `desktop/src/components/ui/checkbox.tsx` after verifying zero imports; re-run tsc.
- [ ] Commit: `fix(desktop): migrate telemetry toggles to Astryx Switch after main merge`

---

### Task 1: EntityCombobox → Astryx Typeahead; delete ui/command.tsx and ui/dialog.tsx — ✅ DONE (651de44)

> Outcome: Typeahead + createStaticSource; exported Props unchanged (TraceFlagsTable untouched); ui/command.tsx + ui/dialog.tsx deleted; cmdk dependency removed. Follow-up for Task 3: `@radix-ui/react-dialog` may now be orphaned — audit and remove if unused.

**Files:**
- Modify: `desktop/src/components/EntityCombobox.tsx` (110 lines)
- Consumer (verify only, adjust only if props must change): `desktop/src/components/TraceFlagsTable.tsx`
- Delete: `desktop/src/components/ui/command.tsx`, then `desktop/src/components/ui/dialog.tsx`

**Requirements:**
- Read `EntityCombobox.tsx` first to understand its contract (search-select of an entity). Preferred target: Astryx `Typeahead` (check its `.d.ts`). If Typeahead's model genuinely doesn't fit (e.g. no async/filter hook the component needs), fall back to `Selector` with filtering, and record the reason in the commit body.
- Keep `EntityCombobox`'s exported props identical if at all possible so `TraceFlagsTable` is untouched; if a prop must change, update the single consumer in the same commit.
- After migration: `ui/command.tsx` must have zero importers → delete it. Then `ui/dialog.tsx` (whose only dependent was command.tsx) must have zero importers → delete it.
- The component lives inside Trace Flags (a dense surface) — migrate ONLY the combobox, nothing else in `TraceFlagsTable`.

**Interfaces:**
- Consumes: green tsc baseline from Task 0.
- Produces: repo with no `cmdk`/shadcn-command usage; `ui/dialog.tsx` gone.

**Steps:**
- [ ] Read `EntityCombobox.tsx`, `TraceFlagsTable.tsx` usage site, and `Typeahead` `.d.ts`.
- [ ] Rewrite `EntityCombobox.tsx` internals on Astryx; keep the exported interface stable.
- [ ] `npx tsc --noEmit` / `pnpm lint` / `pnpm test` green.
- [ ] Verify zero imports of `ui/command` and `ui/dialog`; delete both files; re-run tsc.
- [ ] Manual smoke: `pnpm tauri dev` — open Trace Flags, exercise the combobox (type-filter + select) in light and dark themes. If a GUI session isn't possible, state that explicitly in the report instead of claiming it passed.
- [ ] Commit: `feat(desktop): migrate EntityCombobox to Astryx Typeahead, drop shadcn command/dialog`

---

### Task 2: OrgSelector → Astryx — ✅ DONE (aa5ffec)

> Outcome: DropdownMenu + DropdownMenuItem (menu-like: mixed org-pick + "Connect another org" action, per-item endContent). Exported props unchanged; App.tsx untouched. DropdownMenuItem onClick is plain (no transition) so the dialog-open handler avoids the clickAction footgun.

**Files:**
- Modify: `desktop/src/components/OrgSelector.tsx` (84 lines)
- Consumer (verify only): `desktop/src/App.tsx`

**Requirements:**
- Read `OrgSelector.tsx` first. Preferred target: Astryx `Selector` (already used in SettingsPage/ConnectOrg — follow that idiom). If the component is menu-like (actions, not value selection), `DropdownMenu` is the fallback; record the choice in the commit body.
- Keep exported props identical; `App.tsx` should not need changes.
- Mind the `clickAction` transition footgun if any handler awaits `confirm()` or other dialogs.

**Interfaces:**
- Consumes: green tsc baseline.
- Produces: OrgSelector free of shadcn primitives.

**Steps:**
- [ ] Read `OrgSelector.tsx` and the relevant Astryx `.d.ts`.
- [ ] Migrate internals; keep exported interface stable.
- [ ] `npx tsc --noEmit` / `pnpm lint` / `pnpm test` green.
- [ ] Manual smoke: org switcher renders and switches org in both themes (same caveat as Task 1 if no GUI).
- [ ] Commit: `feat(desktop): migrate OrgSelector to Astryx`

---

### Task 3: LogDetailPane ToggleGroup → SegmentedControl; delete toggle-group/toggle; wrap up — ✅ DONE (f04fff5)

> Outcome: SegmentedControl + LogView CheckboxInput landed; toggle-group/toggle/checkbox deleted. Dep-audit finding: repo uses the unified `radix-ui` meta-package (no per-package @radix-ui deps), still needed by 7 surviving files — nothing removable. Remaining shadcn (10): badge 3, button 4, context-menu 3, dropdown-menu 2, input 4, resizable 4, scroll-area 1, sonner 1, table 1, tooltip 1. tsc/lint/test/build all green. GUI visual smoke NOT run.

**Files:**
- Modify: `desktop/src/panels/logDetail/LogDetailPane.tsx` (ToggleGroup at ~lines 82–106 only)
- Modify: `desktop/src/components/LogView.tsx` (two shadcn `Checkbox` usages at ~lines 146/154 → Astryx `CheckboxInput` or `Switch`, whichever matches the row layout; check the `.d.ts`)
- Delete: `desktop/src/components/ui/toggle-group.tsx`, `desktop/src/components/ui/toggle.tsx`, `desktop/src/components/ui/checkbox.tsx` (after LogView migration, verify zero importers)
- Modify: `docs/astryx-spike.md` (Phase 4 note)

**Requirements:**
- Replace the `ToggleGroup`/`ToggleGroupItem` block with Astryx `SegmentedControl` (same pattern as the SettingsPage theme toggle). Touch nothing else in this dense pane.
- After migration verify zero importers of `ui/toggle-group` and `ui/toggle`; delete both.
- Dependency audit: check whether `@radix-ui/react-dialog` (and any other radix package orphaned by Phase 4 deletions, e.g. `@radix-ui/react-checkbox`, `@radix-ui/react-toggle-group`) still has importers; remove unused ones from `desktop/package.json` + `pnpm install`.
- Append a short "Phase 4 done" section to `docs/astryx-spike.md`: what migrated (Tasks 0–3), what was deleted, and the updated remaining-shadcn list (`badge`, `button`, `context-menu`, `dropdown-menu`, `input`, `resizable`, `scroll-area`, `sonner`, `table`, `tooltip` — recount before writing).
- Final verification includes `pnpm build`.

**Interfaces:**
- Consumes: green tsc baseline.
- Produces: branch ready for review/push; spike doc current.

**Steps:**
- [ ] Read the ToggleGroup block and `SegmentedControl` `.d.ts` (plus SettingsPage usage).
- [ ] Migrate; verify zero importers of toggle-group/toggle; delete both files.
- [ ] `npx tsc --noEmit` / `pnpm lint` / `pnpm test` / `pnpm build` all green.
- [ ] Recount remaining shadcn consumers; update `docs/astryx-spike.md` Phase 4 section.
- [ ] Commit: `feat(desktop): migrate log detail toggle group to SegmentedControl, drop shadcn toggle`

---

# Phase 5 — remaining leaf primitives (added 2026-07-09 after Phase 4 landed)

**Scope decision:** migrate `badge`, `input`, `tooltip`, `button`, `dropdown-menu`, `context-menu` (Astryx equivalents exist for all). Keep bespoke and do NOT touch: `table` (ResultTable dense core), `resizable` (structural panel layout, 4 panels), `scroll-area` (no Astryx equivalent), `sonner` (self-contained global toast infra). All Global Constraints above still apply.

### Task 4: badge + input + tooltip → Astryx; delete three ui files — ✅ DONE (1251918)

> Outcome: Badge (success/destructive→success/error, `label` prop, `title` needs span wrapper — BaseProps omits it) and TextInput (`onChange(value, e)`, `startIcon` replaces overlay-icon hack, `width` prop) migrated; ui/badge.tsx + ui/input.tsx deleted. `ui/tooltip.tsx` KEPT — plan assumption wrong: App.tsx actively uses Tooltip for sidebar nav (lines ~131–192), not a dead provider. Sidebar Tooltip migration moved to Task 6.

**Files:**
- Modify: `desktop/src/panels/LogListPane.tsx`, `desktop/src/panels/ApexPanel.tsx`, `desktop/src/components/ApexHistoryDrawer.tsx` (Badge usages)
- Modify: `desktop/src/panels/LogListPane.tsx`, `desktop/src/components/DebugLevelsTable.tsx`, `desktop/src/components/resultTable/Toolbar.tsx`, `desktop/src/components/LogView.tsx` (Input → Astryx `TextInput`)
- Modify: `desktop/src/App.tsx` (ui/tooltip import — likely a now-dead `TooltipProvider`; remove it if nothing consumes shadcn Tooltip anymore)
- Delete: `desktop/src/components/ui/badge.tsx`, `desktop/src/components/ui/input.tsx`, `desktop/src/components/ui/tooltip.tsx` (each only after verifying zero importers)

**Requirements:**
- Swap components in place; keep surrounding layout/classNames; these usages sit inside dense panes — change ONLY the swapped element. Read Badge/TextInput `.d.ts` first; map shadcn `variant`s to nearest Astryx Badge variants and note any visual mapping in the commit body. TextInput: preserve size/placeholder/controlled-value behavior of each filter input.
- Commit: `feat(desktop): migrate badge/input/tooltip primitives to Astryx`

### Task 5: button → Astryx Button; delete ui/button.tsx — ✅ DONE (92e360a)

> Outcome: 8 text buttons → Button, 2 icon-only → IconButton (no `icon` size in Astryx; `sm` + className). All handlers use `onClick`; footgun audit found zero awaited dialogs. ui/button.tsx deleted; orphaned `class-variance-authority` dep removed.

**Files:**
- Modify: `desktop/src/panels/LogListPane.tsx`, `desktop/src/components/LoggingConfigPanel.tsx`, `desktop/src/components/DebugLevelsTable.tsx`, `desktop/src/components/TraceFlagsTable.tsx`
- Delete: `desktop/src/components/ui/button.tsx`

**Requirements:**
- **Footgun applies with force here:** any handler that awaits `confirm()` (likely delete flows in DebugLevelsTable / TraceFlagsTable) MUST use `onClick`, never `clickAction`. Audit every migrated handler for awaited dialogs and say in the report which ones needed `onClick`.
- Map shadcn variants (`ghost`/`outline`/`destructive`/sizes) to Astryx Button props per RunButton/Phase 1–3 precedent. Icon-only buttons → `IconButton` where that matches (SchemaRefresh precedent).
- Commit: `feat(desktop): migrate remaining shadcn buttons to Astryx`

### Task 6: dropdown-menu + context-menu → Astryx; wrap up Phase 5 — ✅ DONE (b477ca7)

> Outcome: TabStrip → DropdownMenu; App.tsx sidebar tooltips → Astryx Tooltip (provider removed, `placement="end"`); ui/tooltip.tsx deleted. KEPT on shadcn with verified reasons: Toolbar Columns dropdown (Astryx DropdownMenuItem force-closes on click, no checkbox-item — stay-open multi-toggle inexpressible) + sibling Export menu (no-blend rule); LogListPane row context menu (Astryx ContextMenu wraps trigger in a block div, breaks virtualizer row measurement); Explorer.tsx also imports ui/context-menu (was missed in the original consumer count). radix-ui meta still required (DateTimePicker, scroll-area, dropdown-menu, context-menu).

**Files:**
- Modify: `desktop/src/tabs/TabStrip.tsx`, `desktop/src/components/resultTable/Toolbar.tsx` (DropdownMenu — follow OrgSelector precedent)
- Modify: `desktop/src/panels/LogListPane.tsx`, `desktop/src/components/resultTable/Toolbar.tsx` (ContextMenu — read Astryx ContextMenu `.d.ts` first)
- Modify: `desktop/src/App.tsx` (sidebar-nav Tooltip/TooltipTrigger/TooltipContent, ~lines 131–192 → Astryx `Tooltip`; read its `.d.ts`)
- Delete: `desktop/src/components/ui/dropdown-menu.tsx`, `desktop/src/components/ui/context-menu.tsx`, `desktop/src/components/ui/tooltip.tsx` (after zero-importer check)
- Modify: `docs/astryx-spike.md` — "Phase 5 done" section: what migrated, what remains bespoke and why (table/resizable/scroll-area/sonner), recounted remaining ui/ list; re-audit whether the `radix-ui` meta-package is still needed (scroll-area/resizable/table still use it — expected yes, state the surviving importers).
- Final verification adds `pnpm build`.
- Commit: `feat(desktop): migrate menus to Astryx, finish phase 5 leaf migration`
