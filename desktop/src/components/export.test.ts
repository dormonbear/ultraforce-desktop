import { describe, expect, it } from "vitest";
import { toTsv, toJson, toMarkdown } from "./export";
import { guardFormula, toCsv } from "./csv";

const cols = ["Name", "Note"];
const rows = [
  ["Acme", "a\tb"],
  ["Pipe|Co", "line1\nline2"],
];

describe("export serializers", () => {
  it("tsv collapses embedded tabs/newlines to spaces", () => {
    const out = toTsv(cols, rows);
    expect(out).toBe(
      "Name\tNote\n" + "Acme\ta b\n" + "Pipe|Co\tline1 line2\n",
    );
  });

  it("json emits an array of column-keyed objects", () => {
    expect(JSON.parse(toJson(cols, rows))).toEqual([
      { Name: "Acme", Note: "a\tb" },
      { Name: "Pipe|Co", Note: "line1\nline2" },
    ]);
  });

  it("markdown escapes pipes and newlines", () => {
    const out = toMarkdown(cols, rows);
    expect(out).toContain("| Name | Note |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| Pipe\\|Co | line1<br>line2 |");
  });

  it("handles ragged rows (missing cells become empty)", () => {
    expect(toTsv(["A", "B"], [["x"]])).toBe("A\tB\nx\t\n");
  });
});

describe("formula-injection guard", () => {
  it("prefixes dangerous leads but leaves numbers/text alone", () => {
    expect(guardFormula("=2+5")).toBe("'=2+5");
    expect(guardFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(guardFormula("+1800")).toBe("'+1800");
    expect(guardFormula("-HYPERLINK(x)")).toBe("'-HYPERLINK(x)");
    expect(guardFormula("-5")).toBe("-5"); // negative number untouched
    expect(guardFormula("-5.2")).toBe("-5.2");
    expect(guardFormula("Acme")).toBe("Acme");
  });

  it("csv export neutralizes a formula cell", () => {
    expect(toCsv(["F"], [["=cmd|'/c calc'"]])).toContain("'=cmd");
  });

  it("tsv export neutralizes a formula cell", () => {
    expect(toTsv(["F"], [["=2+5"]])).toBe("F\n'=2+5\n");
  });
});
