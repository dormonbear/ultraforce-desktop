# Subquery Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline subquery row expansion in `ResultTable` with a resizable side detail panel, and fix column widths not filling the container.

**Architecture:** `ResultTable` keeps its virtualized table (back to fixed-height rows) on the left of a horizontal `ResizablePanelGroup`; a new `DetailPanel` component renders the selected row's child tables on the right. All between-row insertion machinery is deleted. Spec: `docs/superpowers/specs/2026-07-11-subquery-detail-panel-design.md`.

**Tech Stack:** React 19, @tanstack/react-table + react-virtual, existing `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` primitives (see `desktop/src/panels/SoqlPanel.tsx:6-8,184-198` for usage), Vitest + Testing Library (run with `--run`).

## Global Constraints

- Frontend package dir: `desktop/` (pnpm). Verify: `pnpm exec tsc --noEmit`, `pnpm vitest run <file>`.
- 800-line cap per file; `ResultTable.tsx` is currently 652 lines and must shrink, not grow.
- Match existing style; no new dependencies.
- Conventional commits, no author attribution, commit per task.

## Key implementation facts (read before coding)

- `ResultTable.tsx:91-105` — `expanded: Set<number>` + `toggleExpanded`: replace with `selectedIdx: number | null`.
- `ResultTable.tsx:260-290` — `DisplayItem` union (`row`/`detail`), `displayItems`, variable `estimateSize`, `measureElement` refs: all exist only to support inserted detail rows. With fixed-height rows, virtualize `tableRows` directly with constant `estimateSize: () => rowHeight` and drop `measureElement`.
- `ResultTable.tsx:513-539` — the `detail` row render branch (sticky/width hack around stacked `ChildGrid`s): delete; `ChildGrid` moves into `DetailPanel` unchanged.
- `ResultTable.tsx:573-599` — expandable-cell chevron button: becomes a passive count chip (no per-cell toggle); childless child-column cells render a muted `—`.
- `ResultTable.tsx:601-620` — plain cells are click-to-copy. This stays. Row selection triggers on the row's `onClick` (bubbling from cell clicks is fine: a cell click both copies and selects).
- `ResultTable.tsx:211` — `defaultColumn: { size: 200 }` fixed widths are why the table doesn't fill the container (screenshot bug). Fix via a render-time fill ratio, not by mutating column sizing state.
- `lookup.byRow: Map<number, Map<string, ChildTableDto>>` (from `buildChildLookup`) is the child-data source; `row.original.idx` is the stable key.
- Toolbar viewMode switch (`ResultTable.tsx:358-363`) resets `expanded` — reset `selectedIdx` instead.
- e2e/UI tests use jsdom; no real layout. Anything needing `containerW` must be unit-tested as a pure function.

---

### Task 1: Column fill ratio

**Files:**
- Create: `desktop/src/components/resultTable/fill.ts` (+ `fill.test.ts`)
- Modify: `desktop/src/components/ResultTable.tsx`

**Interfaces:**
- Produces: `computeFillRatio(containerW: number, gutterW: number, totalColW: number): number` — returns `max(1, (containerW - gutterW) / totalColW)`; `1` when `containerW <= 0` or `totalColW <= 0`.

- [ ] Write failing tests for `computeFillRatio`: ratio > 1 when columns undershoot container; exactly 1 when they overshoot; 1 on zero/invalid inputs.
- [ ] Implement; tests pass.
- [ ] Wire into `ResultTable`: every rendered width (`header.getSize()`, `cell.column.getSize()`, `estimateSize` of the column virtualizer) multiplies by the ratio; `tableWidth` becomes `max(containerW, GUTTER_W + totalSize)`. Manual column resize still works (ratio recomputes from new totals).
- [ ] Verify: `pnpm exec tsc --noEmit`; existing `ResultTable` tests still pass.
- [ ] Commit `fix(desktop): stretch result columns to fill container width`.

### Task 2: DetailPanel + selection replaces inline expansion

**Files:**
- Create: `desktop/src/components/resultTable/DetailPanel.tsx`
- Modify: `desktop/src/components/ResultTable.tsx`, `desktop/src/components/resultTable/ChildGrid.tsx` (only if the sticky/width workaround leaks in — it shouldn't)

**Interfaces:**
- Produces: `DetailPanel({ rowOrdinal, parentId, tables, onClose }: { rowOrdinal: number; parentId: string | null; tables: ChildTableDto[]; onClose: () => void })` — header `Row {rowOrdinal+1}` + parentId (when an `Id` column exists) + close button (`aria-label="Close detail panel"`); body = stacked `<ChildGrid>` per table, or a muted "No child records" placeholder when `tables` is empty.

Behavior contract:
- `selectedIdx: number | null` state in `ResultTable`. Row `onClick` → select that row (re-click same row → deselect). `Esc` (keydown listener while panel open) and the close button → deselect.
- Panel is mounted only when `selectedIdx != null` and Nested mode is active: layout becomes `ResizablePanelGroup` horizontal → left `ResizablePanel` (table, existing scroll machinery untouched) + `ResizableHandle` + right `ResizablePanel` (default ~40%, minSize enough for a small grid). When no selection, render the table exactly as today (no group nesting cost is fine either way — pick the simpler JSX).
- Child-column cells: rows with children render a small count chip (child row count, `tabular-nums`, primary color); childless rows render muted `—`. No chevron, no per-cell button.
- Selected row gets a persistent highlight class (`bg-accent` level, distinct from hover).
- viewMode switch resets `selectedIdx`; Flat mode never shows panel or chips (flatten output unchanged).
- Delete: `expanded`/`toggleExpanded`, `DisplayItem`/`displayItems`, detail render branch, `measureElement` refs, variable `estimateSize`, `detailColSpan` usages that existed only for detail rows (spacer rows keep a plain colSpan).

- [ ] TDD per behavior above (see Task 3 test list — write tests first where practical).
- [ ] Verify: `pnpm exec tsc --noEmit`; `pnpm vitest run src/components` green; file sizes within cap.
- [ ] Commit `feat(desktop): subquery side detail panel replaces inline row expansion`.

### Task 3: Test rewrite

**Files:**
- Rename/rewrite: `desktop/src/components/resultTable/ResultTable.expand.test.tsx` → `ResultTable.panel.test.tsx` (it currently lives at `desktop/src/components/resultTable/ResultTable.expand.test.tsx`; keep location)

Test cases (Testing Library, jsdom):
- clicking a row with children opens the panel showing the child table name + a child cell value; row is highlighted
- clicking the same row again closes the panel
- clicking a different row switches panel content
- `Esc` closes the panel; close button closes the panel
- childless child-column cell renders `—`; childless row selection shows "No child records"
- switching to Flat mode closes the panel and renders flattened columns (existing flatten assertions kept)

- [ ] All tests pass: `pnpm vitest run src/components/resultTable`
- [ ] Full local gate: `pnpm exec tsc --noEmit && pnpm vitest run` in `desktop/`
- [ ] Commit `test(desktop): cover subquery detail panel interactions`.
