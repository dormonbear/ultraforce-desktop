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
