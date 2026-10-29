import { defaultMatchModes, type Field } from "react-querybuilder";
import type { ChildLookup } from "../childData";
import { translate, type Locale, type MessageKey } from "../../../i18n";

const matchLabels: Record<string, MessageKey> = {
  all: "all", some: "some", none: "none", atLeast: "at least", atMost: "at most", exactly: "exactly",
};

/**
 * RQB field config: every parent column filters directly; every subquery
 * relationship gets match modes (some/all/none/atLeast/atMost/exactly) over
 * its child columns.
 */
export function buildFilterFields(columns: string[], lookup: ChildLookup, locale: Locale = "en"): Field[] {
  return columns.map((col) => {
    const childCols = lookup.childColumns.get(col);
    if (!childCols) return { name: col, label: col };
    return {
      name: col,
      label: translate(locale, "{field} (subquery)", { field: col }),
      matchModes: locale === "en" ? true : defaultMatchModes.map((mode) => ({
        ...mode, label: translate(locale, matchLabels[mode.name]),
      })),
      subproperties: childCols.map((c) => ({ name: c, label: c })),
    };
  });
}
