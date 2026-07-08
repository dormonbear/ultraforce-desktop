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
