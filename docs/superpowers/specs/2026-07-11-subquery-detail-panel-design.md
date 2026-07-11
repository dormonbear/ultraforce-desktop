# Subquery Detail Panel — Design

Date: 2026-07-11
Status: approved

## Problem

Nested-mode subquery display in `ResultTable` has four issues (screenshots in PR):

1. Collapsed state: table occupies ~half the panel width with the right half
   empty, yet the Id column is truncated — column widths don't adapt to the
   container.
2. Expanding a row makes the whole table jump from half-width to full-width.
3. Expanded child tables are inserted as full-width blocks between rows,
   breaking row rhythm; multiple expanded rows shred the main table.
4. The `›1` chip carries almost no information, and rows without children
   render an empty cell.

## Decision

Replace inline row expansion with a **side detail panel**. Chosen over
(a) polishing inline expansion and (b) hover popovers because it keeps the
main table permanently stable, uses the chronically-empty right half of the
results area, and handles wide child tables.

## Interaction model

- Nested mode: the subquery column cell shows a count chip (`1`); rows with
  no children show a muted `—`. (SF returns null for empty subqueries, so
  0-vs-null cannot be distinguished — both render `—`.)
- Clicking anywhere on a row (or its chip) opens the detail panel on the
  right and highlights the row (selected state). Clicking another row
  switches the panel content. Clicking the selected row again, pressing
  `Esc`, or the panel's close button closes it.
- Flat mode is unaffected. The Nested/Flat toggle stays.

## Layout

- Inside `ResultTable`, a horizontal `ResizablePanelGroup` (same primitive
  as `SoqlPanel`): left = the existing virtualized table, right = detail
  panel (default ~40%, drag-resizable, mounted only while a row is selected).
- Panel structure: header (row number + parent record Id + close button),
  body (one `ChildGrid` per subquery relationship, stacked). `ChildGrid` is
  reused as-is minus the sticky/width workaround it needed inside the table.

## Removals (the main win)

- All between-row insertion logic in `ResultTable.tsx`: `expanded:
  Set<number>`, detail rows, `detailColSpan` spacer rows, dynamic row-height
  recalculation. Virtual scrolling returns to fixed-height rows.
- Selection state becomes `selectedRowIdx: number | null`.

## Column-width fix (bundled)

When the sum of measured column widths is less than the container width,
distribute the leftover proportionally to truncated columns. Diagnose the
existing measure logic for the root cause before patching.

## Out of scope

- A generic "full row field detail" view in the panel (future extension of
  the same panel).
- Child pagination / queryMore (child pages are ≤200 rows).

## Testing

Rewrite `ResultTable.expand.test.tsx`: clicking a row opens the panel;
panel shows `ChildGrid` content; `Esc` / re-click closes; childless rows
render `—`; Flat mode unaffected.
