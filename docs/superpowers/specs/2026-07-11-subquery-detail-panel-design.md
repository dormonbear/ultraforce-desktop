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

## v2 — Vertical record cards + multi-level subqueries (2026-07-11)

User feedback after v1: the panel should read as a *detail* view, and SOQL
supports nested child subqueries (up to 5 levels) which the current model
collapses into a bare count (`soql_children.rs` `typed_cell`, Children arm).

### Panel layout v2

- Per relationship: a section header `RelName (count)` + truncation hint
  (unchanged), but records render **vertically**: one key-value card per
  child record — left column field name, right column value.
- Card header: record ordinal + Id value (when an `Id` column exists).
- A child record that itself has subqueries renders those as nested
  sections inside its card (indented, recursive; SOQL caps depth at 5).
- The horizontal `ChildGrid` grid is retired from the panel.
- Many child records simply scroll; no per-record collapse in v2.

### Data model

- `features::soql_children::ChildTable` gains `children: Vec<ChildTable>`
  (each with `row_index` pointing into the *enclosing* table's `rows`);
  the projection recurses instead of collapsing nested subqueries to a
  count. The scalar count column stays in `columns`/`rows` for backward
  compatibility with flatten/filter.
- `ChildTableDto` (dto.rs) and `types.ts` mirror the `children` field —
  both sides in the same commit.
- Flatten mode and the advanced filter keep operating on level-1 children
  only; deeper levels are visible only in the panel.

## v3 — Header context menu + quick child-presence filter (2026-07-11)

Filtering "rows where relationship X has records" is already expressible in
the advanced FilterBuilder (subquery match modes), but takes four steps.
Add a right-click context menu on column headers:

- All columns: Sort ascending / Sort descending / Clear sort, Copy column
  (reuses the existing header copy logic).
- Subquery columns additionally: "Only with child records" / "Only without
  child records" — mutually exclusive, with a checkmark on the active one;
  selecting the active item again clears it.
- Implementation is sugar over the advanced filter: the menu injects (or
  removes) a tagged rule into `advancedFilter` (single source of truth) so
  it is visible, combinable, and clearable in the FilterBuilder panel.
- Menu uses the app's existing menu primitive (Astryx); no new dependency.

## v4 — Cell interactions + API-name/label toggle (2026-07-11)

User feedback batch three:

### Cell copy moves to context menu

- Left-click on a cell no longer copies; it only selects the row (panel).
- Cells get a right-click context menu with "Copy value" (toast feedback,
  same `copyText` path as header copy). The click-to-copy flash state goes.
- The `title` hover tooltip on main-table cells is removed.

### API name ↔ Label display toggle

- One toggle (Toolbar) switches BOTH the main table headers and the detail
  panel field names / relationship titles between API names and schema
  labels. Column ids stay API names internally (sorting, filter, export
  unchanged) — only display text swaps. Missing labels fall back to API name.
- Labels resolve from the schema index (`sf-schema` `Field.label`): new
  IPC command returning a label map for a query's result columns — parent
  columns (including dotted paths via relationship traversal, reusing the
  existing soql-lang/sf-schema resolution) and each child table's columns.
  Fetched lazily on first toggle, cached per result. DTO camelCase, typed
  ipc/ wrapper, per repo arch rules.
