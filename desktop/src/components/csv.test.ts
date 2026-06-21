import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("renders header + rows with CRLF line endings", () => {
    const csv = toCsv(["Id", "Name"], [["001", "Acme"]]);
    expect(csv).toBe("Id,Name\r\n001,Acme\r\n");
  });

  it("quotes fields containing comma, quote, or newline (RFC 4180)", () => {
    const csv = toCsv(
      ["A", "B", "C"],
      [["a,b", 'he said "hi"', "line1\nline2"]],
    );
    expect(csv).toBe('A,B,C\r\n"a,b","he said ""hi""","line1\nline2"\r\n');
  });

  it("handles empty rows (header only)", () => {
    expect(toCsv(["X"], [])).toBe("X\r\n");
  });

  it("pads short rows so every column is present", () => {
    const csv = toCsv(["A", "B"], [["only-a"]]);
    expect(csv).toBe("A,B\r\nonly-a,\r\n");
  });
});
