import type { ColumnLabelsDto } from "../../types";

/** Flattened child column id as synthesized by flatten.ts: `rel[i].childCol`. */
const FLAT_COL = /^([^[\]]+)\[(\d+)\]\.(.+)$/;

/**
 * Display label for a result column id in label mode. Handles the three id
 * shapes the table renders: parent columns (possibly dotted paths),
 * relationship count columns, and flattened child columns (`rel[i].childCol`),
 * which decompose so each segment resolves — or falls back — independently.
 * Column ids themselves stay API names (sort/filter/export untouched).
 */
export function displayColumnLabel(
  id: string,
  labels: ColumnLabelsDto | null | undefined,
): string {
  if (!labels) return id;
  const parent = labels.parent[id];
  if (parent) return parent;
  const rel = labels.children[id]?.label;
  if (rel) return rel;
  const m = FLAT_COL.exec(id);
  if (!m) return id;
  const child = labels.children[m[1]];
  if (!child) return id;
  return `${child.label ?? m[1]}[${m[2]}].${child.columns[m[3]] ?? m[3]}`;
}
