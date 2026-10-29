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
        children: [],
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

  it("localizes relationship labels without changing match-mode identifiers / 本地化关系标签且不改变匹配模式标识", () => {
    const lookup = buildChildLookup([{
      rowIndex: 0, column: "Contacts", totalSize: 0, done: true,
      columns: ["LastName"], rows: [], children: [],
    }]);
    const field = buildFilterFields(["Contacts"], lookup, "zh-CN")[0];
    expect(field.name).toBe("Contacts");
    expect(field.label).toBe("Contacts（子查询）");
    expect(field.matchModes).toEqual([
      { name: "all", value: "all", label: "全部" },
      { name: "some", value: "some", label: "至少一个" },
      { name: "none", value: "none", label: "无" },
      { name: "atLeast", value: "atLeast", label: "至少" },
      { name: "atMost", value: "atMost", label: "至多" },
      { name: "exactly", value: "exactly", label: "恰好" },
    ]);
  });
});
