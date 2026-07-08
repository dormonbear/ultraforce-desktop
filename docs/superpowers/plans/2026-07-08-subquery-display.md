# SOQL Subquery Display + Child-Record Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render SOQL subquery results as expandable inline child grids (default) with a flatten toggle, lossless flattened export, and a full predicate builder that filters parent rows by child-record conditions.

**Architecture:** A new typed projection in `crates/features` walks the already-parsed `QueryResult` and emits a sparse sidecar of per-row child tables carrying **typed `serde_json::Value` scalars** (never pre-rendered strings). The desktop DTO ships that sidecar next to the existing flat `columns/rows` grid (which is unchanged; `to_table()` is untouched and MCP keeps using it). The frontend builds a lookup from the sidecar, renders inline expandable subgrids via a virtualized display-list (row + detail items, `measureElement` dynamic heights), offers a Flat view that expands each relationship into `rel[i].col` position columns (column-virtualized), and filters via react-querybuilder as UI-only — evaluation is a small hand-written evaluator over RQB's `RuleGroupType` JSON against the typed sidecar.

**Tech Stack:** Rust (serde_json), Tauri IPC, React, @tanstack/react-table v8, @tanstack/react-virtual v3, react-querybuilder **pinned 8.20.2** (matchModes/subproperties), vitest + @testing-library/react.

## Global Constraints

- **`features::soql::to_table()` must not change** — MCP `soql_query` depends on it (decision #2).
- **Sidecar carries typed JSON scalars** `Vec<Vec<serde_json::Value>>`; stringify only at render/export time (red-team #1). Never compare numbers lexicographically.
- **No jsonLogic.** react-querybuilder is UI only; evaluation is our own evaluator over `RuleGroupType` (red-team #2).
- **react-querybuilder pinned exact `"8.20.2"`** in package.json (no `^`).
- DTO structs live in `desktop/src-tauri/src/dto.rs` with `#[serde(rename_all = "camelCase")]`; mirror in `desktop/src/types.ts` **in the same commit**.
- Frontend IPC only via `desktop/src/ipc/` (no new commands needed here; payload rides the existing `run_soql`).
- 800-line cap per file. `crates/features/src/soql.rs` and `desktop/src-tauri/src/dto.rs` are grandfathered >800 — do **not** grow them beyond the minimal edits specified; new logic goes in new files.
- Repo: branch `feat/subquery-display` off **local** `main` (origin has diverged — never fetch/push/rebase onto origin). Worktree has unrelated dirty files: `git add` **explicit paths only**. Pre-commit fallow audits the whole tree — its noise on unrelated files is normal, not caused by you.
- Prefix shell commands with `rtk` (e.g. `rtk cargo test`, `rtk pnpm ...`). Package manager is **pnpm** (desktop/pnpm-lock.yaml).
- Repo has no CHANGELOG file — skip changelog updates.
- No console.log in production code. Conventional commits, no author attribution.
- SOQL subqueries nest only one level (child records contain `Null`/`Scalar`/`Parent` field values, never `Children`) — code defensively anyway where noted.
- Subquery pages beyond the first (child `queryMore`) are **out of scope**; when a child result has `done=false` the UI shows a truncation hint (red-team #6).
- Server-side semi-join filtering is **out of scope** (decision #8, deferred to its own project).

## Process (from handoff)

- Coding tasks are dispatched to **Opus subagents** (subagent-driven-development, one brief per task); the main session only plans and reviews. Reviewers: sonnet by default, opus for Tasks 7 and 10.
- Before Task 1: `rtk git checkout -b feat/subquery-display main` (from local main).

---

### Task 1: Rust — typed child-table projection (`soql_children`)

**Files:**
- Create: `crates/features/src/soql_children.rs`
- Modify: `crates/features/src/lib.rs` (add `pub mod soql_children;` after `pub mod soql;`)
- Modify: `crates/features/src/soql.rs` — ONLY change visibility of two helpers: `fn collect_parent_paths` → `pub(crate) fn collect_parent_paths` (line ~152) and `fn collect_columns` → `pub(crate) fn collect_columns` (line ~169). Nothing else.

**Interfaces:**
- Consumes: `features::soql::{QueryResult, Record, FieldValue}` (existing).
- Produces: `pub struct ChildTable { pub row_index: usize, pub column: String, pub total_size: u64, pub done: bool, pub columns: Vec<String>, pub rows: Vec<Vec<serde_json::Value>> }` and `pub fn child_tables(qr: &QueryResult) -> Vec<ChildTable>`. Task 2 maps these into DTOs.

- [ ] **Step 1: Write the failing tests**

Create `crates/features/src/soql_children.rs` with only the test module first (types/fn referenced don't exist yet):

```rust
//! Typed child-table projection for subquery display (desktop only).
//!
//! `to_table()` stays untouched for MCP; the desktop additionally projects each
//! subquery into a sparse sidecar of typed mini-tables so the UI can expand,
//! flatten, and *filter* child records with correct numeric comparison.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soql::QueryResult;
    use serde_json::json;

    /// Two Accounts; row 0 has two subqueries (Contacts done, Opportunities
    /// truncated), row 1 has null subqueries. Contacts include a numeric field
    /// and a dotted parent path.
    const JSON: &str = r#"{
      "totalSize": 2, "done": true,
      "records": [
        {"attributes":{"type":"Account"},"Id":"001A","Name":"Acme",
         "Contacts":{"totalSize":2,"done":true,"records":[
            {"attributes":{"type":"Contact"},"LastName":"Yin","Age__c":9,
             "Owner":{"attributes":{"type":"User"},"Name":"Alice"}},
            {"attributes":{"type":"Contact"},"LastName":"Zhao","Age__c":10,"Owner":null}]},
         "Opportunities":{"totalSize":250,"done":false,"records":[
            {"attributes":{"type":"Opportunity"},"Amount":1200.5}]}},
        {"attributes":{"type":"Account"},"Id":"001B","Name":"Globex",
         "Contacts":null,"Opportunities":null}
      ]}"#;

    fn qr() -> QueryResult {
        QueryResult::from_json(JSON).unwrap()
    }

    #[test]
    fn emits_one_entry_per_subquery_occurrence_sparse() {
        let tables = child_tables(&qr());
        // Row 1's subqueries are Null → no entries (sparse sidecar).
        assert_eq!(tables.len(), 2);
        assert_eq!(tables[0].row_index, 0);
        assert_eq!(tables[0].column, "Contacts");
        assert_eq!(tables[1].row_index, 0);
        assert_eq!(tables[1].column, "Opportunities");
    }

    #[test]
    fn carries_typed_scalars_not_strings() {
        let tables = child_tables(&qr());
        let contacts = &tables[0];
        assert_eq!(contacts.columns, ["LastName", "Age__c", "Owner.Name"]);
        // Numbers stay JSON numbers → `9 < 10` compares numerically downstream.
        assert_eq!(contacts.rows[0], vec![json!("Yin"), json!(9), json!("Alice")]);
        assert_eq!(contacts.rows[1], vec![json!("Zhao"), json!(10), json!(null)]);
    }

    #[test]
    fn passes_through_total_size_and_done() {
        let tables = child_tables(&qr());
        let opps = &tables[1];
        assert_eq!(opps.total_size, 250);
        assert!(!opps.done);
        assert_eq!(opps.rows.len(), 1);
        assert_eq!(opps.rows[0], vec![json!(1200.5)]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk cargo test -p features soql_children`
Expected: compile error — `child_tables` / `ChildTable` not found.

- [ ] **Step 3: Implement**

Add above the test module in `crates/features/src/soql_children.rs`:

```rust
use crate::soql::{collect_columns, collect_parent_paths, FieldValue, QueryResult, Record};

/// One subquery result attached to one parent row: a typed mini-table.
/// `rows` hold raw JSON scalars (string/number/bool/null) so downstream
/// filtering compares numbers numerically; the UI stringifies at render time.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildTable {
    /// Index into the parent table's `rows`.
    pub row_index: usize,
    /// Relationship (column) name, e.g. `Contacts`.
    pub column: String,
    pub total_size: u64,
    /// `false` when Salesforce truncated the child page (child queryMore is out
    /// of scope) — the UI shows a truncation hint.
    pub done: bool,
    /// Dotted leaf paths, first-seen order (same rules as `to_table`).
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

/// Project every subquery in `qr` into a sparse list of [`ChildTable`]s.
/// Rows whose subquery field is `Null` contribute no entry.
pub fn child_tables(qr: &QueryResult) -> Vec<ChildTable> {
    let mut out = Vec::new();
    for (row_index, record) in qr.records.iter().enumerate() {
        for (name, value) in &record.fields {
            let FieldValue::Children(child) = value else {
                continue;
            };
            let mut parent_paths: Vec<String> = Vec::new();
            for rec in &child.records {
                collect_parent_paths(&rec.fields, "", &mut parent_paths);
            }
            let mut columns: Vec<String> = Vec::new();
            for rec in &child.records {
                collect_columns(&rec.fields, "", &parent_paths, &mut columns);
            }
            let rows = child
                .records
                .iter()
                .map(|rec| columns.iter().map(|col| typed_cell(rec, col)).collect())
                .collect();
            out.push(ChildTable {
                row_index,
                column: name.clone(),
                total_size: child.total_size,
                done: child.done,
                columns,
                rows,
            });
        }
    }
    out
}

/// Typed twin of `soql::render_cell`: resolves a (possibly dotted) column to the
/// raw JSON scalar instead of display text.
fn typed_cell(record: &Record, column: &str) -> serde_json::Value {
    let mut parts = column.split('.');
    let head = parts.next().expect("column path is non-empty");
    let Some((_, value)) = record.fields.iter().find(|(k, _)| k == head) else {
        return serde_json::Value::Null;
    };
    match value {
        FieldValue::Null => serde_json::Value::Null,
        FieldValue::Scalar(v) => v.clone(),
        // SOQL subqueries nest one level only; defensively render as a count.
        FieldValue::Children(qr) => serde_json::Value::from(qr.total_size),
        FieldValue::Parent(child) => {
            let rest = parts.collect::<Vec<_>>().join(".");
            typed_cell(child, &rest)
        }
    }
}
```

Then in `crates/features/src/lib.rs` add `pub mod soql_children;` after `pub mod soql;`, and in `crates/features/src/soql.rs` change the two helper signatures to `pub(crate)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk cargo test -p features`
Expected: all pass (including the existing soql.rs suite — proves `to_table` untouched).

- [ ] **Step 5: Commit**

```bash
rtk git add crates/features/src/soql_children.rs crates/features/src/lib.rs crates/features/src/soql.rs
rtk git commit -m "feat(features): typed child-table projection for SOQL subqueries"
```

---

### Task 2: IPC — `childTables` sidecar replaces the unused `tree` field

**Files:**
- Modify: `desktop/src-tauri/src/dto.rs` (add `ChildTableDto` + `map_child_table` near `SoqlResultDto` ~line 785; **delete** the dead `RecordDto`/`FieldDto`/`FieldValueDto`/`map_record`/`map_field_value`/dto-local `scalar_text` block at lines ~410–490 and the `map_record` test around line ~1082)
- Modify: `desktop/src-tauri/src/soql_exec.rs:143-149`
- Modify: `desktop/src/types.ts:3-23` (same commit — camelCase mirror)

**Interfaces:**
- Consumes: `features::soql_children::{ChildTable, child_tables}` (Task 1).
- Produces: `SoqlResultDto { columns, rows, totalSize, done, childTables }` over IPC; TS types `Scalar = string | number | boolean | null` and `ChildTableDto { rowIndex: number; column: string; totalSize: number; done: boolean; columns: string[]; rows: Scalar[][] }` — every frontend task consumes these.

**Context — why deleting `tree` is in scope:** `SoqlResultDto.tree: Vec<RecordDto>` is transmitted on every query but has **zero frontend consumers** (verified: no `.tree` reads outside debug-log code; `RecordDto`/`FieldDto`/`FieldValueDto` are declared in types.ts and never imported). Its string-rendered scalars can't serve typed filtering, and keeping it alongside the sidecar would double the MB-scale payload the red team flagged. The sidecar supersedes it. `crates/uf-ost/src/server.rs` has its own unrelated `RecordDto` — do not touch it.

- [ ] **Step 1: Write the failing test**

Append to the `#[cfg(test)]` module in `desktop/src-tauri/src/dto.rs`:

```rust
#[test]
fn child_table_dto_serializes_camel_case_with_typed_rows() {
    let dto = map_child_table(features::soql_children::ChildTable {
        row_index: 3,
        column: "Contacts".into(),
        total_size: 250,
        done: false,
        columns: vec!["LastName".into(), "Age__c".into()],
        rows: vec![vec![serde_json::json!("Yin"), serde_json::json!(9)]],
    });
    let v: serde_json::Value = serde_json::to_value(&dto).unwrap();
    assert_eq!(v["rowIndex"], 3);
    assert_eq!(v["totalSize"], 250);
    assert_eq!(v["done"], false);
    // Typed passthrough: the number survives as a JSON number.
    assert_eq!(v["rows"][0][1], serde_json::json!(9));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk cargo test -p ultraforce-desktop child_table_dto` (if the src-tauri crate has a different name, find it with `rtk grep '^name' desktop/src-tauri/Cargo.toml` and substitute)
Expected: compile error — `ChildTableDto` / `map_child_table` not found.

- [ ] **Step 3: Implement**

In `dto.rs`, next to `SoqlResultDto`:

```rust
/// One subquery result attached to one parent row. Cells are raw JSON scalars
/// (string/number/bool/null) — the UI stringifies at render time so filters
/// compare numbers numerically.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildTableDto {
    pub row_index: usize,
    pub column: String,
    pub total_size: u64,
    pub done: bool,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

pub fn map_child_table(t: features::soql_children::ChildTable) -> ChildTableDto {
    ChildTableDto {
        row_index: t.row_index,
        column: t.column,
        total_size: t.total_size,
        done: t.done,
        columns: t.columns,
        rows: t.rows,
    }
}
```

Change `SoqlResultDto`:

```rust
/// A SOQL query result: flat table projection plus a sparse sidecar of typed
/// child tables (one per subquery occurrence).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoqlResultDto {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_size: u64,
    pub done: bool,
    pub child_tables: Vec<ChildTableDto>,
}
```

Delete from `dto.rs`: `RecordDto`, `FieldDto`, `FieldValueDto`, `map_record`, `map_field_value`, the dto-local `scalar_text` (lines ~410–490), and the test that calls `map_record` (locate with `rtk grep -n "map_record" desktop/src-tauri/src/dto.rs`). If `cargo check` then reports `scalar_text` still used elsewhere in dto.rs, keep it — delete only what goes dead.

In `soql_exec.rs` replace the `Ok(SoqlResultDto { ... })` tail (lines ~143-149):

```rust
    let table = result.to_table();
    let child_tables = features::soql_children::child_tables(&result)
        .into_iter()
        .map(dto::map_child_table)
        .collect();
    tracing::info!(
        elapsed_ms = start.elapsed().as_millis(),
        outcome = "ok",
        "run_soql complete"
    );
    Ok(SoqlResultDto {
        columns: table.columns,
        rows: table.rows,
        total_size: result.total_size,
        done: result.done,
        child_tables,
    })
```

In `desktop/src/types.ts` replace lines 3–23 (the `FieldValueDto`/`FieldDto`/`RecordDto`/`SoqlResultDto` block):

```ts
/** A raw JSON scalar from a SOQL child table (typed — numbers stay numbers). */
export type Scalar = string | number | boolean | null;

/** One subquery result attached to one parent row (sparse sidecar entry). */
export interface ChildTableDto {
  rowIndex: number;
  column: string;
  totalSize: number;
  done: boolean;
  columns: string[];
  rows: Scalar[][];
}

export interface SoqlResultDto {
  columns: string[];
  rows: string[][];
  totalSize: number;
  done: boolean;
  childTables: ChildTableDto[];
}
```

- [ ] **Step 4: Verify**

Run: `rtk cargo test -p ultraforce-desktop && rtk cargo check`
Expected: PASS, no dead-code warnings.
Run: `cd desktop && rtk tsc`
Expected: clean (nothing consumed the deleted types; `SoqlPanel`/`tabs/types.ts` use `SoqlResultDto` wholesale).
Run: `rtk grep -rn "RecordDto\|FieldValueDto\|\.tree" desktop/src --include=*.ts --include=*.tsx | grep -iv "exec\|log\|Explorer\|fs/"`
Expected: no SOQL-related hits remain.

- [ ] **Step 5: Commit**

```bash
rtk git add desktop/src-tauri/src/dto.rs desktop/src-tauri/src/soql_exec.rs desktop/src/types.ts
rtk git commit -m "feat(desktop): ship typed childTables sidecar over IPC, drop unused tree"
```

---

### Task 3: Frontend data layer — child lookup + `GridRow` refactor

**Files:**
- Create: `desktop/src/components/resultTable/childData.ts`
- Create: `desktop/src/components/resultTable/childData.test.ts`
- Modify: `desktop/src/components/ResultTable.tsx` (rows memo, column accessors, `getRowId`; prop type gains `childTables`)
- Modify: `desktop/src/panels/SoqlPanel.tsx:305` — no change needed (`data={result}` already passes the whole DTO); verify only.

**Interfaces:**
- Consumes: `ChildTableDto`, `Scalar` from `../../types` (Task 2).
- Produces:
  - `interface ChildLookup { relationships: string[]; childColumns: Map<string, string[]>; maxRows: Map<string, number>; byRow: Map<number, Map<string, ChildTableDto>> }`
  - `function buildChildLookup(childTables: ChildTableDto[]): ChildLookup`
  - `function displayValue(v: Scalar): string`
  - In ResultTable: `interface GridRow { idx: number; cells: Record<string, string> }` — `idx` is the ORIGINAL index into `data.rows` (stable across sort/filter; expansion and the sidecar key off it). `getRowId: (r) => String(r.idx)`.

- [ ] **Step 1: Write the failing tests**

`desktop/src/components/resultTable/childData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildChildLookup, displayValue } from "./childData";
import type { ChildTableDto } from "../../types";

const entry = (over: Partial<ChildTableDto>): ChildTableDto => ({
  rowIndex: 0,
  column: "Contacts",
  totalSize: 1,
  done: true,
  columns: ["LastName"],
  rows: [["Yin"]],
  ...over,
});

describe("buildChildLookup", () => {
  it("indexes entries by row and relationship, unions columns, tracks max rows", () => {
    const lookup = buildChildLookup([
      entry({ rowIndex: 0, rows: [["Yin"], ["Zhao"]] }),
      entry({ rowIndex: 2, columns: ["LastName", "Email"], rows: [["Wu", "w@x.com"]] }),
      entry({ rowIndex: 0, column: "Opportunities", columns: ["Amount"], rows: [[1200.5]] }),
    ]);
    expect(lookup.relationships).toEqual(["Contacts", "Opportunities"]);
    expect(lookup.childColumns.get("Contacts")).toEqual(["LastName", "Email"]);
    expect(lookup.maxRows.get("Contacts")).toBe(2);
    expect(lookup.byRow.get(2)?.get("Contacts")?.rows[0][1]).toBe("w@x.com");
    expect(lookup.byRow.get(1)).toBeUndefined();
  });
});

describe("displayValue", () => {
  it("stringifies typed scalars; null becomes empty", () => {
    expect(displayValue(null)).toBe("");
    expect(displayValue("a")).toBe("a");
    expect(displayValue(9)).toBe("9");
    expect(displayValue(false)).toBe("false");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && rtk vitest run src/components/resultTable/childData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `childData.ts`**

```ts
import type { ChildTableDto, Scalar } from "../../types";

/** Fast lookup over the sparse child-table sidecar of one query result. */
export interface ChildLookup {
  /** Relationship column names, first-seen order. */
  relationships: string[];
  /** Unified child columns per relationship (first-seen union across entries). */
  childColumns: Map<string, string[]>;
  /** Max loaded child-row count per relationship (flatten width). */
  maxRows: Map<string, number>;
  /** parent rowIndex → relationship → entry. */
  byRow: Map<number, Map<string, ChildTableDto>>;
}

export function buildChildLookup(childTables: ChildTableDto[]): ChildLookup {
  const relationships: string[] = [];
  const childColumns = new Map<string, string[]>();
  const maxRows = new Map<string, number>();
  const byRow = new Map<number, Map<string, ChildTableDto>>();
  for (const t of childTables) {
    const cols = childColumns.get(t.column);
    if (!cols) {
      relationships.push(t.column);
      childColumns.set(t.column, [...t.columns]);
    } else {
      for (const c of t.columns) if (!cols.includes(c)) cols.push(c);
    }
    maxRows.set(t.column, Math.max(maxRows.get(t.column) ?? 0, t.rows.length));
    let m = byRow.get(t.rowIndex);
    if (!m) byRow.set(t.rowIndex, (m = new Map()));
    m.set(t.column, t);
  }
  return { relationships, childColumns, maxRows, byRow };
}

/** Stringify a typed scalar for display/export (null → ""). */
export function displayValue(v: Scalar): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && rtk vitest run src/components/resultTable/childData.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor ResultTable rows to `GridRow`**

In `ResultTable.tsx` (mechanical; no behavior change):

```ts
interface GridRow {
  /** Original index into data.rows — stable across sort/filter. */
  idx: number;
  cells: Record<string, string>;
}
```

- Replace `type Row = Record<string, string>` with `GridRow`; `isNumericColumn(col, rows)` reads `r.cells[col]`.
- Rows memo:

```ts
const rows = useMemo<GridRow[]>(
  () =>
    data.rows.map((cells, idx) => {
      const o: Record<string, string> = {};
      data.columns.forEach((c, i) => (o[c] = cells[i] ?? ""));
      return { idx, cells: o };
    }),
  [data]
);
```

- Column defs: `accessorFn: (r) => r.cells[col]`.
- `useReactTable` gains `getRowId: (r) => String(r.idx)`.
- Prop type becomes `data: Pick<SoqlResultDto, "columns" | "rows" | "totalSize" | "childTables">` and add near the top of the component:

```ts
const lookup = useMemo(() => buildChildLookup(data.childTables), [data.childTables]);
```

(`lookup` is unused until Task 4 — that's fine for one task; add `void lookup;` if oxlint complains, removed in Task 4.)

- [ ] **Step 6: Verify**

Run: `cd desktop && rtk tsc && rtk vitest run && rtk pnpm lint`
Expected: all clean (Explorer/csv/export suites still pass).

- [ ] **Step 7: Commit**

```bash
rtk git add desktop/src/components/resultTable/childData.ts desktop/src/components/resultTable/childData.test.ts desktop/src/components/ResultTable.tsx
rtk git commit -m "feat(desktop): child-table lookup + stable row identity in ResultTable"
```

---

### Task 4: Inline expandable subgrids (default view)

**Files:**
- Create: `desktop/src/components/resultTable/ChildGrid.tsx`
- Create: `desktop/src/components/resultTable/ResultTable.expand.test.tsx`
- Modify: `desktop/src/components/ResultTable.tsx`

**Interfaces:**
- Consumes: `ChildLookup`, `displayValue` (Task 3); `ChildTableDto`.
- Produces: `ChildGrid({ table }: { table: ChildTableDto })` React component; ResultTable state `expanded: Set<number>` (original row idx) and `viewMode: "expand" | "flatten"` (state added now, defaults `"expand"`; the flatten branch arrives in Task 5). Display-list virtualization pattern that Tasks 5–7 build on.

**Design (red-team #4):** expansion introduces variable row heights. Instead of virtualizing table rows directly, virtualize a **display list**: one item per visible parent row plus one item per expanded detail row. Each item renders exactly one `<tr>`, so `measureElement` measures real heights. Zebra striping and the row-number gutter use the parent ordinal, not the display index.

- [ ] **Step 1: Write the failing component test**

`desktop/src/components/resultTable/ResultTable.expand.test.tsx` (jsdom; <100 rows so row virtualization is off — the non-virtualized branch must render the same display list):

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResultTable } from "../ResultTable";

const data = {
  columns: ["Id", "Name", "Contacts"],
  rows: [
    ["001A", "Acme", "2"],
    ["001B", "Globex", ""],
  ],
  totalSize: 2,
  childTables: [
    {
      rowIndex: 0,
      column: "Contacts",
      totalSize: 250,
      done: false,
      columns: ["LastName", "Age__c"],
      rows: [
        ["Yin", 9],
        ["Zhao", 10],
      ],
    },
  ],
};

describe("expandable subquery cells", () => {
  it("expands a child grid on count-cell click and shows a truncation hint", () => {
    render(<ResultTable data={data} />);
    expect(screen.queryByText("Yin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand Contacts/i }));
    expect(screen.getByText("Yin")).toBeTruthy();
    expect(screen.getByText("Zhao")).toBeTruthy();
    // done=false → truncation hint with totalSize (red-team #6)
    expect(screen.getByText(/2 of 250/)).toBeTruthy();
    // collapse again
    fireEvent.click(screen.getByRole("button", { name: /collapse Contacts/i }));
    expect(screen.queryByText("Yin")).toBeNull();
  });

  it("renders no expander for rows without child entries", () => {
    render(<ResultTable data={data} />);
    expect(screen.getAllByRole("button", { name: /expand Contacts/i })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && rtk vitest run src/components/resultTable/ResultTable.expand.test.tsx`
Expected: FAIL — no expander button exists.

- [ ] **Step 3: Implement `ChildGrid.tsx`**

```tsx
import { displayValue } from "./childData";
import type { ChildTableDto } from "../../types";

/**
 * One stacked, labeled subgrid inside an expanded parent row. Child pages are
 * ≤200 rows (SF default; child queryMore is out of scope) — no virtualization.
 */
export function ChildGrid({ table }: { table: ChildTableDto }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-foreground">
          {table.column} ({table.totalSize.toLocaleString()})
        </span>
        {!table.done && (
          <span className="text-[11px] text-muted-foreground">
            {table.rows.length.toLocaleString()} of {table.totalSize.toLocaleString()} loaded
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-border bg-secondary px-2 py-1 text-left font-semibold text-muted-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? "bg-muted/50" : undefined}>
                {table.columns.map((c, ci) => {
                  const text = displayValue(row[ci] ?? null);
                  return (
                    <td
                      key={c}
                      title={text || undefined}
                      className="max-w-64 truncate border-b border-border px-2 py-1 text-foreground"
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement expansion in `ResultTable.tsx`**

State + display list (imports: `ChevronDown`, `ChevronRight` from lucide-react; `ChildGrid`; `Fragment` not needed — items are separate `<tr>`s):

```ts
const [expanded, setExpanded] = useState<Set<number>>(new Set());
const [viewMode, setViewMode] = useState<"expand" | "flatten">("expand");

const toggleExpanded = (idx: number) =>
  setExpanded((old) => {
    const next = new Set(old);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    return next;
  });

type DisplayItem =
  | { kind: "row"; row: (typeof tableRows)[number]; ordinal: number }
  | { kind: "detail"; row: (typeof tableRows)[number] };

const displayItems = useMemo<DisplayItem[]>(() => {
  const items: DisplayItem[] = [];
  tableRows.forEach((row, ordinal) => {
    items.push({ kind: "row", row, ordinal });
    if (
      viewMode === "expand" &&
      expanded.has(row.original.idx) &&
      lookup.byRow.has(row.original.idx)
    )
      items.push({ kind: "detail", row });
  });
  return items;
}, [tableRows, expanded, viewMode, lookup]);
```

Virtualizer switches from `tableRows` to `displayItems` with dynamic measurement:

```ts
const virtualize = displayItems.length > 100;
const virtualizer = useVirtualizer({
  count: displayItems.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (i) => (displayItems[i].kind === "row" ? rowHeight : 240),
  overscan: 12,
  enabled: virtualize,
});
```

`renderRows` becomes `renderItems` (virtual slice of `displayItems`, or all when not virtualizing). Parent `<tr>` rendering changes:
- add `data-index={displayIndex}` and `ref={virtualize ? virtualizer.measureElement : undefined}` to every rendered `<tr>` (parent AND detail) so measurement works;
- zebra uses `ordinal % 2`, gutter shows `ordinal + 1`;
- in the cell loop, when `viewMode === "expand"` and `lookup.childColumns.has(cell.column.id)` and `lookup.byRow.get(row.original.idx)?.has(cell.column.id)`, render an expander instead of the copy-on-click text:

```tsx
<TableCell key={cell.id} style={{ width: cell.column.getSize() }} className="border-b border-border px-3 align-middle">
  <button
    type="button"
    aria-label={`${expanded.has(row.original.idx) ? "Collapse" : "Expand"} ${cell.column.id}`}
    onClick={() => toggleExpanded(row.original.idx)}
    className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline"
  >
    {expanded.has(row.original.idx) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    {cell.getValue<string>()}
  </button>
</TableCell>
```

Detail item rendering (one `<tr>`, spans everything; stacked subgrids per decision #7):

```tsx
<TableRow
  key={`${row.id}-detail`}
  data-index={displayIndex}
  ref={virtualize ? virtualizer.measureElement : undefined}
  className="border-0 hover:bg-transparent"
>
  <TableCell colSpan={visibleLeafCount + 1} className="border-b border-border bg-muted/30 px-0">
    <div className="sticky left-0 flex max-w-full flex-col gap-3 px-14 py-3" style={{ width: containerW || undefined }}>
      {[...(lookup.byRow.get(row.original.idx)?.values() ?? [])].map((t) => (
        <ChildGrid key={t.column} table={t} />
      ))}
    </div>
  </TableCell>
</TableRow>
```

(The inner `sticky left-0` + `width: containerW` keeps the subgrid visible while the parent grid is horizontally scrolled — same trick as the sticky gutter; verify manually in Step 6.)

- [ ] **Step 5: Run tests**

Run: `cd desktop && rtk vitest run src/components/resultTable && rtk tsc && rtk pnpm lint`
Expected: PASS.

- [ ] **Step 6: Manual smoke check (run app)**

Run: `cd desktop && rtk pnpm tauri dev` against any authed org; execute `SELECT Id, Name, (SELECT LastName FROM Contacts), (SELECT Id FROM Opportunities) FROM Account LIMIT 200`.
Verify: counts render as chevron buttons; expanding shows stacked labeled subgrids; scrolling 200 rows with several expanded doesn't jump (measureElement); horizontal scroll keeps the expanded panel in view; collapse restores. Record observations in the task report.

- [ ] **Step 7: Commit**

```bash
rtk git add desktop/src/components/resultTable/ChildGrid.tsx desktop/src/components/resultTable/ResultTable.expand.test.tsx desktop/src/components/ResultTable.tsx
rtk git commit -m "feat(desktop): inline expandable subquery grids in SOQL results"
```

---

### Task 5: Flatten view — `rel[i].col` projection + toggle

**Files:**
- Create: `desktop/src/components/resultTable/flatten.ts`
- Create: `desktop/src/components/resultTable/flatten.test.ts`
- Modify: `desktop/src/components/ResultTable.tsx`

**Interfaces:**
- Consumes: `ChildLookup`, `displayValue` (Task 3).
- Produces:
  - `interface FlatTable { columns: string[]; rows: string[][]; groups: { relationship: string; columns: string[] }[] }`
  - `function flattenTable(columns: string[], rows: string[][], lookup: ChildLookup): FlatTable` — identity (empty `groups`) when the lookup has no relationships. Tasks 6–8 consume `groups` and the projection.
  - ResultTable renders `viewMode === "flatten"` from `flat.columns/flat.rows` (row `idx` still the original index).

- [ ] **Step 1: Write the failing tests**

`desktop/src/components/resultTable/flatten.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildChildLookup } from "./childData";
import { flattenTable } from "./flatten";
import type { ChildTableDto } from "../../types";

const childTables: ChildTableDto[] = [
  {
    rowIndex: 0,
    column: "Contacts",
    totalSize: 2,
    done: true,
    columns: ["LastName", "Age__c"],
    rows: [
      ["Yin", 9],
      ["Zhao", 10],
    ],
  },
  {
    rowIndex: 0,
    column: "Opportunities",
    totalSize: 1,
    done: true,
    columns: ["Amount"],
    rows: [[1200.5]],
  },
];
const columns = ["Id", "Contacts", "Name", "Opportunities"];
const rows = [
  ["001A", "2", "Acme", "1"],
  ["001B", "", "Globex", ""],
];

describe("flattenTable", () => {
  it("expands each relationship in place into rel[i].col groups", () => {
    const flat = flattenTable(columns, rows, buildChildLookup(childTables));
    expect(flat.columns).toEqual([
      "Id",
      "Contacts[0].LastName",
      "Contacts[0].Age__c",
      "Contacts[1].LastName",
      "Contacts[1].Age__c",
      "Name",
      "Opportunities[0].Amount",
    ]);
    expect(flat.rows[0]).toEqual(["001A", "Yin", "9", "Zhao", "10", "Acme", "1200.5"]);
    // Rows without children pad with empties (lossless width).
    expect(flat.rows[1]).toEqual(["001B", "", "", "", "", "Globex", ""]);
    expect(flat.groups).toEqual([
      {
        relationship: "Contacts",
        columns: [
          "Contacts[0].LastName",
          "Contacts[0].Age__c",
          "Contacts[1].LastName",
          "Contacts[1].Age__c",
        ],
      },
      { relationship: "Opportunities", columns: ["Opportunities[0].Amount"] },
    ]);
  });

  it("is the identity for results without subqueries", () => {
    const flat = flattenTable(["Id"], [["001A"]], buildChildLookup([]));
    expect(flat.columns).toEqual(["Id"]);
    expect(flat.rows).toEqual([["001A"]]);
    expect(flat.groups).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && rtk vitest run src/components/resultTable/flatten.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `flatten.ts`**

```ts
import { displayValue, type ChildLookup } from "./childData";

/** A lossless flat projection: subquery columns expanded to `rel[i].col`. */
export interface FlatTable {
  columns: string[];
  rows: string[][];
  /** Generated column ids per relationship — drives grouped visibility toggles. */
  groups: { relationship: string; columns: string[] }[];
}

type Slot =
  | { kind: "plain"; col: string; i: number }
  | { kind: "rel"; rel: string };

/**
 * Expand each subquery count column, in place, into one column per loaded
 * child row × child column (IC2-style position columns). Width per
 * relationship = max loaded child rows across all parent rows; missing
 * children pad with "".
 */
export function flattenTable(
  columns: string[],
  rows: string[][],
  lookup: ChildLookup,
): FlatTable {
  const slots: Slot[] = columns.map((col, i) =>
    lookup.childColumns.has(col) ? { kind: "rel", rel: col } : { kind: "plain", col, i },
  );

  const outColumns: string[] = [];
  const groups: FlatTable["groups"] = [];
  for (const s of slots) {
    if (s.kind === "plain") {
      outColumns.push(s.col);
      continue;
    }
    const childCols = lookup.childColumns.get(s.rel) ?? [];
    const n = lookup.maxRows.get(s.rel) ?? 0;
    const cols: string[] = [];
    for (let k = 0; k < n; k++)
      for (const cc of childCols) cols.push(`${s.rel}[${k}].${cc}`);
    groups.push({ relationship: s.rel, columns: cols });
    outColumns.push(...cols);
  }

  const outRows = rows.map((row, ri) => {
    const out: string[] = [];
    for (const s of slots) {
      if (s.kind === "plain") {
        out.push(row[s.i] ?? "");
        continue;
      }
      const entry = lookup.byRow.get(ri)?.get(s.rel);
      const childCols = lookup.childColumns.get(s.rel) ?? [];
      const n = lookup.maxRows.get(s.rel) ?? 0;
      for (let k = 0; k < n; k++) {
        const crow = entry?.rows[k];
        for (const cc of childCols) {
          if (!crow) {
            out.push("");
            continue;
          }
          const ci = entry!.columns.indexOf(cc);
          out.push(ci >= 0 ? displayValue(crow[ci] ?? null) : "");
        }
      }
    }
    return out;
  });

  return { columns: outColumns, rows: outRows, groups };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && rtk vitest run src/components/resultTable/flatten.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the toggle into ResultTable**

```ts
const flat = useMemo(
  () => flattenTable(data.columns, data.rows, lookup),
  [data.columns, data.rows, lookup]
);
const activeColumns = viewMode === "flatten" ? flat.columns : data.columns;
const activeRows = viewMode === "flatten" ? flat.rows : data.rows;
```

- The `rows` memo (GridRow) and `columns` memo (ColumnDef) now derive from `activeColumns`/`activeRows` instead of `data.columns`/`data.rows` (row `idx` remains the index into `activeRows`, which equals the original index — flatten preserves row order 1:1).
- Toggle UI next to the Columns dropdown, rendered only when `lookup.relationships.length > 0`:

```tsx
{lookup.relationships.length > 0 && (
  <div className="flex h-7 items-center rounded-md border border-input bg-card p-0.5 text-[12px]">
    {(["expand", "flatten"] as const).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => setViewMode(m)}
        className={cn(
          "cursor-pointer rounded px-2 py-0.5",
          viewMode === m
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        {m === "expand" ? "Nested" : "Flat"}
      </button>
    ))}
  </div>
)}
```

- Per-session only: plain `useState`, no persistence (decision: default Expandable).
- Switching view resets `sorting`, `columnVisibility`, and `expanded` (column ids change meaning): in the toggle onClick, also call `setSorting([])`, `setColumnVisibility({})`, `setExpanded(new Set())`.
- Expanders only render in `expand` mode (already guarded in Task 4).

- [ ] **Step 6: Add a view-toggle component test**

Append to `ResultTable.expand.test.tsx` (same `data` fixture):

```tsx
it("flatten mode replaces count columns with rel[i].col position columns", () => {
  render(<ResultTable data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "Flat" }));
  expect(screen.getByText("Contacts[0].LastName")).toBeTruthy();
  expect(screen.getByText("Yin")).toBeTruthy(); // child value inline, no expansion
  fireEvent.click(screen.getByRole("button", { name: "Nested" }));
  expect(screen.queryByText("Contacts[0].LastName")).toBeNull();
});
```

Run: `cd desktop && rtk vitest run src/components/resultTable && rtk tsc && rtk pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add desktop/src/components/resultTable/flatten.ts desktop/src/components/resultTable/flatten.test.ts desktop/src/components/resultTable/ResultTable.expand.test.tsx desktop/src/components/ResultTable.tsx
rtk git commit -m "feat(desktop): flatten view toggle with rel[i].col projection"
```

---

### Task 6: Columns menu — grouped visibility for flattened relationships

**Files:**
- Modify: `desktop/src/components/ResultTable.tsx` (Columns dropdown, lines ~251-268)
- Modify: `desktop/src/components/resultTable/ResultTable.expand.test.tsx`

**Interfaces:**
- Consumes: `flat.groups` (Task 5), `columnVisibility` state.
- Produces: UI-only; no new exports.

**Behavior (red-team #5):** in flatten mode the Columns menu must NOT list every `rel[i].col` — plain columns list individually, then one checkbox per relationship toggles its whole group. Expand mode keeps today's per-column list.

- [ ] **Step 1: Write the failing test**

Append to `ResultTable.expand.test.tsx`:

```tsx
it("flatten mode groups relationship columns into one visibility toggle", () => {
  render(<ResultTable data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "Flat" }));
  fireEvent.click(screen.getByText("Columns"));
  // One group item, not one item per position column
  expect(screen.getByText("Contacts (2 cols)")).toBeTruthy();
  expect(screen.queryByRole("menuitemcheckbox", { name: "Contacts[0].LastName" })).toBeNull();
  fireEvent.click(screen.getByText("Contacts (2 cols)"));
  expect(screen.queryByText("Contacts[0].LastName")).toBeNull(); // header gone
});
```

(Fixture has 1 relationship × 2 child columns × 1 max row = 2 generated columns.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && rtk vitest run src/components/resultTable/ResultTable.expand.test.tsx`
Expected: FAIL — group item not found.

- [ ] **Step 3: Implement**

In the Columns `DropdownMenuContent`, branch on view mode:

```tsx
{(() => {
  const grouped = new Set(
    viewMode === "flatten" ? flat.groups.flatMap((g) => g.columns) : []
  );
  const setGroup = (cols: string[], v: boolean) =>
    setColumnVisibility((old) => ({
      ...old,
      ...Object.fromEntries(cols.map((c) => [c, v])),
    }));
  return (
    <>
      {table
        .getAllLeafColumns()
        .filter((col) => !grouped.has(col.id))
        .map((col) => (
          <DropdownMenuCheckboxItem
            key={col.id}
            checked={col.getIsVisible()}
            onCheckedChange={(v) => col.toggleVisibility(!!v)}
            onSelect={(e) => e.preventDefault()}
          >
            {col.id}
          </DropdownMenuCheckboxItem>
        ))}
      {viewMode === "flatten" &&
        flat.groups.map((g) => (
          <DropdownMenuCheckboxItem
            key={g.relationship}
            checked={g.columns.every((c) => columnVisibility[c] !== false)}
            onCheckedChange={(v) => setGroup(g.columns, !!v)}
            onSelect={(e) => e.preventDefault()}
          >
            {`${g.relationship} (${g.columns.length} cols)`}
          </DropdownMenuCheckboxItem>
        ))}
    </>
  );
})()}
```

- [ ] **Step 4: Run tests, verify, commit**

Run: `cd desktop && rtk vitest run src/components/resultTable && rtk tsc && rtk pnpm lint`
Expected: PASS.

```bash
rtk git add desktop/src/components/ResultTable.tsx desktop/src/components/resultTable/ResultTable.expand.test.tsx
rtk git commit -m "feat(desktop): grouped column visibility for flattened relationships"
```

---

### Task 7: Horizontal column virtualization

**Files:**
- Modify: `desktop/src/components/ResultTable.tsx`

**Interfaces:**
- Consumes: existing `parentRef` scroll container, `table.getVisibleLeafColumns()`.
- Produces: UI-only. Threshold constant `COL_VIRTUALIZE_MIN = 40` (visible leaf columns).

**⚠️ This is the highest-risk task (red-team #3).** The scroll container is `overflow-x: hidden` with (a) a floating bottom scrollbar div synced both ways via `scrollLeft`, and (b) trackpad `wheel` events forwarded to `parentRef.scrollLeft`. Programmatic `scrollLeft` writes on an `overflow:hidden` box still fire `scroll` events, which is what `useVirtualizer({ horizontal: true })` listens to — so the existing sync machinery stays untouched. Do NOT restructure the scroll containers; layer the column virtualizer on top. Review this task with an **opus** reviewer.

- [ ] **Step 1: Implement**

```ts
const COL_VIRTUALIZE_MIN = 40;
const visibleColumns = table.getVisibleLeafColumns();
const colVirtualize = visibleColumns.length > COL_VIRTUALIZE_MIN;
const colVirtualizer = useVirtualizer({
  horizontal: true,
  count: visibleColumns.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (i) => visibleColumns[i].getSize(),
  overscan: 6,
  enabled: colVirtualize,
});
// Column widths change on resize/visibility — remeasure.
useEffect(() => {
  colVirtualizer.measure();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [table.getCenterTotalSize(), visibleColumns.length]);

const virtualCols = colVirtualizer.getVirtualItems();
const colPadLeft = colVirtualize && virtualCols.length ? virtualCols[0].start : 0;
const colPadRight =
  colVirtualize && virtualCols.length
    ? colVirtualizer.getTotalSize() - virtualCols[virtualCols.length - 1].end
    : 0;
```

Header row: keep the sticky `#` gutter `<TableHead>` as-is (it sits outside the virtualized set), then:

```tsx
{colPadLeft > 0 && <TableHead style={{ width: colPadLeft, padding: 0 }} className="border-b border-border bg-secondary" />}
{(colVirtualize ? virtualCols.map((vc) => hg.headers[vc.index]) : hg.headers).map((header) => (
  /* existing header cell JSX unchanged */
))}
{colPadRight > 0 && <TableHead style={{ width: colPadRight, padding: 0 }} className="border-b border-border bg-secondary" />}
```

Body parent rows mirror it:

```tsx
{colPadLeft > 0 && <TableCell style={{ width: colPadLeft, padding: 0 }} className="border-b border-border" />}
{(colVirtualize
  ? virtualCols.map((vc) => row.getVisibleCells()[vc.index])
  : row.getVisibleCells()
).map((cell) => (
  /* existing cell JSX unchanged */
))}
{colPadRight > 0 && <TableCell style={{ width: colPadRight, padding: 0 }} className="border-b border-border" />}
```

Detail rows (Task 4) already span via `colSpan={visibleLeafCount + 1}` — when `colVirtualize`, change their colSpan to `virtualCols.length + (colPadLeft > 0 ? 1 : 0) + (colPadRight > 0 ? 1 : 0) + 1` so the spacer cells are covered. Compute once per render into `detailColSpan`.

`tableWidth` (`GUTTER_W + table.getCenterTotalSize()`) is unchanged — the floating scrollbar keeps its full-width thumb.

- [ ] **Step 2: Add a slim regression test**

Append to `ResultTable.expand.test.tsx`:

```tsx
it("renders many columns without crashing when column virtualization kicks in", () => {
  const cols = Array.from({ length: 60 }, (_, i) => `C${i}`);
  const wide = {
    columns: cols,
    rows: [cols.map((_, i) => String(i))],
    totalSize: 1,
    childTables: [],
  };
  render(<ResultTable data={wide} />);
  expect(screen.getByText("C0")).toBeTruthy();
});
```

(jsdom has no layout, so virtual windows may include everything — this guards the code path, not the windowing. The windowing proof is Step 3.)

Run: `cd desktop && rtk vitest run src/components/resultTable && rtk tsc && rtk pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual verification (mandatory, record findings)**

`cd desktop && rtk pnpm tauri dev`, run a subquery query with wide children (e.g. many Contact fields), switch to Flat:
1. Horizontal scroll via floating bottom bar → columns window in/out, no blank gaps, header/body stay aligned.
2. Trackpad horizontal wheel over the body → same.
3. First (#) gutter stays sticky-left; column resize still works on visible columns.
4. Nested view with an expanded row + horizontal scroll → detail panel stays visible (sticky) and rows stay measured.
5. DOM node count: elements panel shows ~windowed column cells, not all (e.g. 60+ columns → ~20 rendered per row).

If (1)/(2) break because scroll events don't propagate under `overflow-x: hidden`, fallback (pre-approved): drive the virtualizer manually from the existing sync handlers via `colVirtualizer.scrollToOffset(p.scrollLeft)` inside `syncBodyFromBar`/`onBodyWheel`. Note which path shipped in the task report.

- [ ] **Step 4: Commit**

```bash
rtk git add desktop/src/components/ResultTable.tsx desktop/src/components/resultTable/ResultTable.expand.test.tsx
rtk git commit -m "feat(desktop): horizontal column virtualization for wide flattened results"
```

---

### Task 8: Export & copy — always-flattened projection, respecting active filters

**Files:**
- Modify: `desktop/src/components/ResultTable.tsx` (`exportAs`, `copyAs`)
- Modify: `desktop/src/components/resultTable/ResultTable.expand.test.tsx`

**Interfaces:**
- Consumes: `flat` (Task 5), `table.getRowModel()` (post filter+sort), `row.original.idx`.
- Produces: none new — behavior change only. Export format helpers (`toCsv`/`toTsv`/`toJson`/`toMarkdown`/xlsx) are untouched.

**Behavior:** decision #6 + red-team #8 — export/copy always use the flattened projection (lossless, view-independent) but only the rows currently visible (filter-respecting), in current sort order.

- [ ] **Step 1: Write the failing test**

Append to `ResultTable.expand.test.tsx` (mock clipboard):

```tsx
it("copy uses the flattened projection regardless of view mode", async () => {
  let copiedText = "";
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText: (t: string) => ((copiedText = t), Promise.resolve()) },
  });
  render(<ResultTable data={data} />);
  fireEvent.click(screen.getByRole("button", { name: /copy result/i }));
  await Promise.resolve();
  expect(copiedText).toContain("Contacts[0].LastName"); // flattened header
  expect(copiedText).toContain("Yin"); // child data present even in Nested view
  vi.unstubAllGlobals();
});
```

(Check how `copyText` in `desktop/src/clipboard.ts` writes — if it goes through a Tauri API instead of `navigator.clipboard`, mock that module with `vi.mock` instead; keep the same assertions.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && rtk vitest run src/components/resultTable/ResultTable.expand.test.tsx`
Expected: FAIL — copied text has the count column, not `Contacts[0].LastName`.

- [ ] **Step 3: Implement**

In `ResultTable.tsx` add one helper and route both paths through it:

```ts
/** Flattened projection of the currently visible rows (filter + sort applied). */
const exportTable = (): { columns: string[]; rows: string[][] } => ({
  columns: flat.columns,
  rows: table.getRowModel().rows.map((r) => flat.rows[r.original.idx]),
});
```

- `exportAs`: `const t = exportTable(); await writeExportFile(path, fmt, t.columns, t.rows);` and the toast row count uses `t.rows.length`.
- `copyAs`: build tsv/md/json from `exportTable()` instead of `data.columns`/`data.rows`.
- The per-column copy button (header) is untouched — it already reads visible table values.

- [ ] **Step 4: Run tests, verify, commit**

Run: `cd desktop && rtk vitest run src/components/resultTable && rtk tsc && rtk pnpm lint`
Expected: PASS (existing `export.test.ts` untouched and green).

```bash
rtk git add desktop/src/components/ResultTable.tsx desktop/src/components/resultTable/ResultTable.expand.test.tsx
rtk git commit -m "feat(desktop): export/copy SOQL results as flattened projection of visible rows"
```

---

### Task 9: Advanced filter UI — react-querybuilder panel

**Files:**
- Modify: `desktop/package.json` + `desktop/pnpm-lock.yaml` (add `"react-querybuilder": "8.20.2"` — exact pin, no caret)
- Create: `desktop/src/components/resultTable/filter/fields.ts`
- Create: `desktop/src/components/resultTable/filter/fields.test.ts`
- Create: `desktop/src/components/resultTable/filter/FilterBuilder.tsx`
- Modify: `desktop/src/styles.css` (dark-theme overrides)
- Modify: `desktop/src/components/ResultTable.tsx` (toolbar toggle + panel mount; filter STATE only — evaluation lands in Task 10)

**Interfaces:**
- Consumes: `ChildLookup` (Task 3); `Field`, `RuleGroupType` types from react-querybuilder.
- Produces:
  - `function buildFilterFields(columns: string[], lookup: ChildLookup): Field[]` — parent columns as plain fields (red-team #7), each relationship as a `matchModes: true` field with `subproperties` = its child columns.
  - `FilterBuilder({ fields, query, onQueryChange }: { fields: Field[]; query: RuleGroupType; onQueryChange: (q: RuleGroupType) => void })`
  - ResultTable state: `const [advancedFilter, setAdvancedFilter] = useState<RuleGroupType>({ combinator: "and", rules: [] });` and `const [showFilter, setShowFilter] = useState(false);` — Task 10 consumes `advancedFilter`.
- The existing "Filter rows…" text input stays as-is (parent-row quick text filter, not child-aware — red-team #9).

- [ ] **Step 1: Add the dependency (pinned)**

Run: `cd desktop && rtk pnpm add react-querybuilder@8.20.2`
Then edit `desktop/package.json`: ensure the entry is exactly `"react-querybuilder": "8.20.2"` (strip any `^` pnpm added).
Run: `cd desktop && rtk pnpm install`
Expected: lockfile updated; `rtk grep '"react-querybuilder"' desktop/package.json` shows the bare version.

- [ ] **Step 2: Write the failing fields test**

`desktop/src/components/resultTable/filter/fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildChildLookup } from "../childData";
import { buildFilterFields } from "./fields";

describe("buildFilterFields", () => {
  it("emits plain fields for parent columns and matchModes fields for relationships", () => {
    const lookup = buildChildLookup([
      {
        rowIndex: 0,
        column: "Contacts",
        totalSize: 1,
        done: true,
        columns: ["LastName", "Age__c"],
        rows: [["Yin", 9]],
      },
    ]);
    const fields = buildFilterFields(["Id", "Name", "Contacts"], lookup);
    expect(fields.map((f) => f.name)).toEqual(["Id", "Name", "Contacts"]);
    expect(fields[0].matchModes).toBeUndefined();
    expect(fields[2].matchModes).toBe(true);
    expect(fields[2].subproperties).toEqual([
      { name: "LastName", label: "LastName" },
      { name: "Age__c", label: "Age__c" },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd desktop && rtk vitest run src/components/resultTable/filter/fields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `fields.ts`**

```ts
import type { Field } from "react-querybuilder";
import type { ChildLookup } from "../childData";

/**
 * RQB field config: every parent column filters directly; every subquery
 * relationship gets match modes (some/all/none/atLeast/atMost/exactly) over
 * its child columns.
 */
export function buildFilterFields(columns: string[], lookup: ChildLookup): Field[] {
  return columns.map((col) => {
    const childCols = lookup.childColumns.get(col);
    if (!childCols) return { name: col, label: col };
    return {
      name: col,
      label: `${col} (subquery)`,
      matchModes: true,
      subproperties: childCols.map((c) => ({ name: c, label: c })),
    };
  });
}
```

Run: `cd desktop && rtk vitest run src/components/resultTable/filter/fields.test.ts` — PASS.

- [ ] **Step 5: Implement `FilterBuilder.tsx`**

```tsx
import { QueryBuilder, type Field, type RuleGroupType } from "react-querybuilder";
import "react-querybuilder/dist/query-builder.css";

/** Thin RQB wrapper: UI only — evaluation lives in filter/evaluate.ts. */
export function FilterBuilder({
  fields,
  query,
  onQueryChange,
}: {
  fields: Field[];
  query: RuleGroupType;
  onQueryChange: (q: RuleGroupType) => void;
}) {
  return (
    <div className="uf-querybuilder border-b border-border bg-card px-4 py-2">
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={onQueryChange}
        showNotToggle
        resetOnFieldChange
      />
    </div>
  );
}
```

- [ ] **Step 6: Toolbar toggle + mount in ResultTable**

- Import `Filter` icon (lucide) and `FilterBuilder`, `buildFilterFields`.
- Toolbar button after the Columns dropdown:

```tsx
<button
  type="button"
  title="Advanced filter"
  aria-label="Advanced filter"
  onClick={() => setShowFilter((v) => !v)}
  className={cn(
    "focus-accent relative inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-[12px] cursor-pointer",
    showFilter || advancedFilter.rules.length > 0
      ? "text-foreground"
      : "text-muted-foreground hover:text-foreground"
  )}
>
  <Filter size={13} /> Filter
  {advancedFilter.rules.length > 0 && (
    <span className="absolute -right-1 -top-1 size-2 rounded-full bg-primary" />
  )}
</button>
```

- Between the toolbar div and the table container:

```tsx
{showFilter && (
  <FilterBuilder
    fields={useMemo(() => buildFilterFields(data.columns, lookup), [data.columns, lookup])}
    query={advancedFilter}
    onQueryChange={setAdvancedFilter}
  />
)}
```

(Hoist the `useMemo` to the component top level — hooks can't sit in JSX conditionals: `const filterFields = useMemo(...)`.)

- [ ] **Step 7: Dark-theme styles**

Append to `desktop/src/styles.css` (map RQB's CSS variables/classes onto the app tokens; adjust selectors to what the rendered DOM actually uses — inspect once in dev):

```css
/* react-querybuilder — match the app's dark theme */
.uf-querybuilder .queryBuilder {
  font-size: 12px;
}
.uf-querybuilder .ruleGroup {
  background: hsl(var(--secondary) / 0.5);
  border-color: hsl(var(--border));
  border-radius: 0.375rem;
}
.uf-querybuilder .ruleGroup .ruleGroup {
  background: hsl(var(--muted) / 0.4);
}
.uf-querybuilder select,
.uf-querybuilder input {
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--input));
  border-radius: 0.375rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  font-size: 12px;
}
.uf-querybuilder button {
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--input));
  border-radius: 0.375rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  cursor: pointer;
}
.uf-querybuilder button:hover {
  color: hsl(var(--foreground));
}
```

(If the app's CSS tokens aren't hsl-var based, read the top of `styles.css` and use whatever token syntax the file already uses — match existing style, don't invent.)

- [ ] **Step 8: Verify + smoke check**

Run: `cd desktop && rtk vitest run src/components/resultTable && rtk tsc && rtk pnpm lint`
Expected: PASS.
Run app: toggle the Filter panel on a subquery result — parent fields listed; relationship field offers match modes (has at least 1 / all / none / at least / at most / exactly) with child-field sub-rules; styling matches the dark theme. Rules build but don't filter yet (Task 10).

- [ ] **Step 9: Commit**

```bash
rtk git add desktop/package.json desktop/pnpm-lock.yaml desktop/src/components/resultTable/filter/fields.ts desktop/src/components/resultTable/filter/fields.test.ts desktop/src/components/resultTable/filter/FilterBuilder.tsx desktop/src/components/ResultTable.tsx desktop/src/styles.css
rtk git commit -m "feat(desktop): advanced filter builder UI (react-querybuilder, pinned 8.20.2)"
```

---

### Task 10: Filter evaluator + wiring (typed, no jsonLogic)

**Files:**
- Create: `desktop/src/components/resultTable/filter/evaluate.ts`
- Create: `desktop/src/components/resultTable/filter/evaluate.test.ts`
- Modify: `desktop/src/components/ResultTable.tsx`
- Modify: `desktop/src/components/resultTable/ResultTable.expand.test.tsx`

**Interfaces:**
- Consumes: `RuleGroupType`, `RuleType` from react-querybuilder (types only — no RQB runtime import); `ChildTableDto`, `Scalar`; `displayValue`.
- Produces:
  - `interface RowCtx { parent: Record<string, string>; children: ReadonlyMap<string, ChildTableDto> }`
  - `function evaluateGroup(g: RuleGroupType, ctx: RowCtx): boolean`
- Review this task with an **opus** reviewer (predicate semantics).

**Semantics:**
- Typed comparison: when both operands parse as finite numbers, compare numerically (so `9 < 10`, killing the `"10" < "9"` lexicographic bug); otherwise string comparison. Child cells are typed scalars; parent cells are display strings.
- Match modes (RQB v8: rule carries `match: { mode, threshold }`, `value` is a nested `RuleGroupType`, `operator` ignored): with `m` = matching child rows of `n` loaded — `some`: m>0 · `all`: m===n (vacuously true at n=0) · `none`: m===0 · `atLeast`: m>=t · `atMost`: m<=t · `exactly`: m===t. A parent row with **no** entry for the relationship has n=0.
- Empty rule set ⇒ no filtering. Unknown operators ⇒ rule passes (never silently hide rows on unsupported input).

- [ ] **Step 1: Write the failing tests**

`desktop/src/components/resultTable/filter/evaluate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RuleGroupType } from "react-querybuilder";
import { evaluateGroup, type RowCtx } from "./evaluate";
import type { ChildTableDto } from "../../../types";

const contacts = (rows: ChildTableDto["rows"]): ChildTableDto => ({
  rowIndex: 0,
  column: "Contacts",
  totalSize: rows.length,
  done: true,
  columns: ["LastName", "Age__c"],
  rows,
});

const ctx = (children?: ChildTableDto): RowCtx => ({
  parent: { Id: "001A", Name: "Acme", Amount: "150" },
  children: new Map(children ? [[children.column, children]] : []),
});

const g = (rules: RuleGroupType["rules"], combinator = "and"): RuleGroupType => ({
  combinator,
  rules,
});

describe("parent field rules", () => {
  it("compares numbers numerically, not lexicographically", () => {
    // "150" > "9" numerically true; lexicographic would say false.
    expect(evaluateGroup(g([{ field: "Amount", operator: ">", value: "9" }]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Amount", operator: "<", value: "9" }]), ctx())).toBe(false);
  });

  it("supports contains / beginsWith / null / between and or/not", () => {
    expect(evaluateGroup(g([{ field: "Name", operator: "contains", value: "cm" }]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Name", operator: "beginsWith", value: "Ac" }]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Id", operator: "null", value: "" }]), ctx())).toBe(false);
    expect(
      evaluateGroup(g([{ field: "Amount", operator: "between", value: "100,200" }]), ctx())
    ).toBe(true);
    expect(
      evaluateGroup(
        {
          combinator: "or",
          not: true,
          rules: [
            { field: "Name", operator: "=", value: "Nope" },
            { field: "Id", operator: "=", value: "Nope" },
          ],
        },
        ctx()
      )
    ).toBe(true);
  });
});

describe("match-mode rules over child tables", () => {
  const rows: ChildTableDto["rows"] = [
    ["Yin", 9],
    ["Zhao", 10],
    ["Wu", 30],
  ];
  const sub: RuleGroupType = {
    combinator: "and",
    rules: [{ field: "Age__c", operator: ">=", value: "10" }],
  };
  const rule = (mode: string, threshold?: number) =>
    g([{ field: "Contacts", operator: "=", match: { mode, threshold }, value: sub } as never]);

  it("evaluates some/all/none against typed child values", () => {
    expect(evaluateGroup(rule("some"), ctx(contacts(rows)))).toBe(true);
    expect(evaluateGroup(rule("all"), ctx(contacts(rows)))).toBe(false);
    expect(evaluateGroup(rule("none"), ctx(contacts(rows)))).toBe(false);
    // 9 vs "10": typed numeric comparison — 9 >= 10 is false (lexicographic "9">="10" is true!)
    expect(
      evaluateGroup(rule("all"), ctx(contacts([["Zhao", 10], ["Wu", 30]])))
    ).toBe(true);
  });

  it("evaluates count thresholds", () => {
    expect(evaluateGroup(rule("atLeast", 2), ctx(contacts(rows)))).toBe(true);
    expect(evaluateGroup(rule("atMost", 1), ctx(contacts(rows)))).toBe(false);
    expect(evaluateGroup(rule("exactly", 2), ctx(contacts(rows)))).toBe(true);
  });

  it("treats a missing relationship entry as zero child rows", () => {
    expect(evaluateGroup(rule("some"), ctx())).toBe(false);
    expect(evaluateGroup(rule("none"), ctx())).toBe(true);
    expect(evaluateGroup(rule("all"), ctx())).toBe(true); // vacuous
  });
});

describe("edge behavior", () => {
  it("empty group filters nothing; unknown operator passes", () => {
    expect(evaluateGroup(g([]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Name", operator: "??", value: "x" }]), ctx())).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && rtk vitest run src/components/resultTable/filter/evaluate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `evaluate.ts`**

```ts
import type { RuleGroupType, RuleType } from "react-querybuilder";
import type { ChildTableDto, Scalar } from "../../../types";
import { displayValue } from "../childData";

/** Everything one parent row exposes to the filter. */
export interface RowCtx {
  /** Parent cell display strings, keyed by column. */
  parent: Record<string, string>;
  /** Typed child tables for this row, keyed by relationship. */
  children: ReadonlyMap<string, ChildTableDto>;
}

const NUM = /^-?\d+(\.\d+)?$/;

/** 3-way compare; numeric when both sides are numbers, else string. null = incomparable. */
function cmp(v: Scalar, target: string): number | null {
  const s = displayValue(v);
  if (s === "" || target === "") return null;
  if ((typeof v === "number" || NUM.test(s)) && NUM.test(target)) {
    return Number(s) - Number(target);
  }
  return s < target ? -1 : s > target ? 1 : 0;
}

function testOp(v: Scalar, operator: string, value: unknown): boolean {
  const s = displayValue(v);
  const target = typeof value === "string" ? value : String(value ?? "");
  switch (operator) {
    case "=":
      return cmp(v, target) === 0 || s === target;
    case "!=":
      return !(cmp(v, target) === 0 || s === target);
    case "<": {
      const c = cmp(v, target);
      return c !== null && c < 0;
    }
    case "<=": {
      const c = cmp(v, target);
      return c !== null && c <= 0;
    }
    case ">": {
      const c = cmp(v, target);
      return c !== null && c > 0;
    }
    case ">=": {
      const c = cmp(v, target);
      return c !== null && c >= 0;
    }
    case "contains":
      return s.toLowerCase().includes(target.toLowerCase());
    case "doesNotContain":
      return !s.toLowerCase().includes(target.toLowerCase());
    case "beginsWith":
      return s.toLowerCase().startsWith(target.toLowerCase());
    case "endsWith":
      return s.toLowerCase().endsWith(target.toLowerCase());
    case "null":
      return v == null || s === "";
    case "notNull":
      return !(v == null || s === "");
    case "between":
    case "notBetween": {
      const [lo = "", hi = ""] = target.split(",").map((p) => p.trim());
      const cl = cmp(v, lo);
      const ch = cmp(v, hi);
      const inside = cl !== null && ch !== null && cl >= 0 && ch <= 0;
      return operator === "between" ? inside : !inside;
    }
    default:
      // Unknown operator: pass — never hide rows on unsupported input.
      return true;
  }
}

type MatchInfo = { mode: string; threshold?: number };

/** Evaluate an RQB group against one parent row (+ its typed child tables). */
export function evaluateGroup(group: RuleGroupType, ctx: RowCtx): boolean {
  const results = group.rules.map((r) => {
    if (typeof r === "string") return true; // independent-combinator strings: unused here
    if ("rules" in r) return evaluateGroup(r, ctx);
    return evaluateRule(r, ctx);
  });
  const combined =
    group.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
  return group.not ? !combined : combined;
}

function evaluateRule(rule: RuleType, ctx: RowCtx): boolean {
  const match = (rule as RuleType & { match?: MatchInfo }).match;
  if (match) {
    const entry = ctx.children.get(rule.field);
    const rows = entry?.rows ?? [];
    const cols = entry?.columns ?? [];
    const sub = rule.value as RuleGroupType;
    const m = rows.filter((row) => evalChildRow(sub, cols, row)).length;
    const t = match.threshold ?? 0;
    switch (match.mode) {
      case "some":
        return m > 0;
      case "all":
        return m === rows.length; // vacuously true when no children loaded
      case "none":
        return m === 0;
      case "atLeast":
        return m >= t;
      case "atMost":
        return m <= t;
      case "exactly":
        return m === t;
      default:
        return true;
    }
  }
  return testOp(ctx.parent[rule.field] ?? "", rule.operator, rule.value);
}

/** Evaluate a subquery rule group against one typed child row. */
function evalChildRow(group: RuleGroupType, cols: string[], row: Scalar[]): boolean {
  const results = group.rules.map((r) => {
    if (typeof r === "string") return true;
    if ("rules" in r) return evalChildRow(r, cols, row);
    const i = cols.indexOf(r.field);
    return testOp(i >= 0 ? (row[i] ?? null) : null, r.operator, r.value);
  });
  const combined =
    group.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
  return group.not ? !combined : combined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && rtk vitest run src/components/resultTable/filter/evaluate.test.ts`
Expected: PASS. If any RQB type detail (e.g. `match` placement) mismatches the installed 8.20.2 typings, check `desktop/node_modules/react-querybuilder/dist/types` and adapt the cast — semantics above stay.

- [ ] **Step 5: Wire into ResultTable**

Pre-filter by ORIGINAL row index before building GridRows (works identically in both view modes because flatten preserves row order):

```ts
const activeIdx = useMemo(() => {
  const all = data.rows.map((_, i) => i);
  if (advancedFilter.rules.length === 0) return all;
  return all.filter((i) =>
    evaluateGroup(advancedFilter, {
      parent: Object.fromEntries(data.columns.map((c, ci) => [c, data.rows[i][ci] ?? ""])),
      children: lookup.byRow.get(i) ?? new Map(),
    })
  );
}, [data, advancedFilter, lookup]);
```

The GridRow memo maps `activeIdx` instead of all rows:

```ts
const rows = useMemo<GridRow[]>(
  () =>
    activeIdx.map((idx) => {
      const cells: Record<string, string> = {};
      activeColumns.forEach((c, i) => (cells[c] = activeRows[idx][i] ?? ""));
      return { idx, cells };
    }),
  [activeIdx, activeColumns, activeRows]
);
```

Everything downstream (`expanded` by idx, sidecar lookup by idx, `exportTable()` via `r.original.idx`, the "X / Y shown" counter comparing `tableRows.length` to `data.totalSize`) keeps working because idx stays original.

**Important:** the advanced filter evaluates parent predicates against ORIGINAL parent columns even in Flat view (fields come from `data.columns` — Task 9 already builds them that way). This is intended: the filter's meaning is view-independent.

- [ ] **Step 6: End-to-end component test**

Append to `ResultTable.expand.test.tsx` — drive the filter through state by rendering, opening the panel, and asserting rows hide. Driving RQB's UI in jsdom is brittle; instead export a test hook: add an optional prop `initialAdvancedFilter?: RuleGroupType` to ResultTable used as the useState initializer (one line, no runtime cost):

```tsx
it("advanced filter hides parent rows whose children fail the predicate", () => {
  render(
    <ResultTable
      data={data}
      initialAdvancedFilter={{
        combinator: "and",
        rules: [
          {
            field: "Contacts",
            operator: "=",
            match: { mode: "some" },
            value: {
              combinator: "and",
              rules: [{ field: "Age__c", operator: ">=", value: "10" }],
            },
          } as never,
        ],
      }}
    />
  );
  expect(screen.getByText("Acme")).toBeTruthy(); // has a contact aged 10
  expect(screen.queryByText("Globex")).toBeNull(); // no children → some=false
  expect(screen.getByText(/1 \/ 2 shown/)).toBeTruthy();
});
```

- [ ] **Step 7: Full verification**

Run: `cd desktop && rtk vitest run && rtk tsc && rtk pnpm lint`
Run: `rtk cargo test`
Expected: everything green.
Manual: run the app, build a filter `Contacts has at least 2 [Age__c >= 10]` on a real result — rows filter live; export respects it; "X / Y shown" updates; clearing rules restores all rows.

- [ ] **Step 8: Commit**

```bash
rtk git add desktop/src/components/resultTable/filter/evaluate.ts desktop/src/components/resultTable/filter/evaluate.test.ts desktop/src/components/ResultTable.tsx desktop/src/components/resultTable/ResultTable.expand.test.tsx
rtk git commit -m "feat(desktop): typed child-record filter evaluation wired into SOQL results"
```

---

### Task 11: Final verification + plan status

**Files:**
- Modify: `docs/superpowers/plans/PLAN-STATUS.md` (add/update the row for this plan)
- Modify: `desktop/src/components/ResultTable.tsx` — ONLY if it exceeded 800 lines (check: `wc -l desktop/src/components/ResultTable.tsx`); if so, extract the toolbar into `desktop/src/components/resultTable/Toolbar.tsx` keeping props explicit, and re-run the full suite.

- [ ] **Step 1: Full suite**

```bash
rtk cargo test
rtk cargo clippy
cd desktop && rtk vitest run && rtk tsc && rtk pnpm lint
bash scripts/check-arch.sh
```

Expected: all pass; check-arch confirms no file (other than grandfathered) exceeds 800 lines.

- [ ] **Step 2: Line-cap check**

Run: `wc -l desktop/src/components/ResultTable.tsx`
If > 800: extract `Toolbar.tsx` (search box, Columns menu, view toggle, filter button, copy/export controls) as described above; re-run Step 1.

- [ ] **Step 3: Update PLAN-STATUS.md, commit**

```bash
rtk git add docs/superpowers/plans/PLAN-STATUS.md docs/superpowers/plans/2026-07-08-subquery-display.md
rtk git commit -m "docs: mark subquery-display plan implemented"
```

- [ ] **Step 4: Report** — branch stays local (`feat/subquery-display`); do NOT push or open a PR (origin diverged). Hand back to the main session for merge decision via superpowers:finishing-a-development-branch.
