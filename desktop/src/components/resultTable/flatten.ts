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

  // fallow-ignore-next-line complexity
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
