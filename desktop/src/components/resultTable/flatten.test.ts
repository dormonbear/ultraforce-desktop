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
