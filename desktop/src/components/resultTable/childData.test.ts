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
  children: [],
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
