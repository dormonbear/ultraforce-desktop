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
