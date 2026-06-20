import { describe, it, expect } from "vitest";
import { planMigration } from "./migrate";

describe("planMigration", () => {
  it("maps titles to unique <name>.<ext> files", () => {
    const out = planMigration("soql", [
      { title: "My Query", query: "SELECT Id FROM Account" },
      { title: "My Query", query: "SELECT Name FROM Lead" },
    ]);
    expect(out).toEqual([
      { name: "My Query.soql", content: "SELECT Id FROM Account" },
      { name: "My Query (2).soql", content: "SELECT Name FROM Lead" },
    ]);
  });
  it("uses src for apex", () => {
    const out = planMigration("apex", [
      { title: "x", src: "System.debug(1);" },
    ]);
    expect(out).toEqual([{ name: "x.apex", content: "System.debug(1);" }]);
  });
});
