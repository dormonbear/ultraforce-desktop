import { describe, expect, it } from "vitest";
import {
  splitSpanIntoLineRanges,
  type LineTextBounds,
} from "./soqlSubqueryHighlight";

/** Monaco-convention bounds from raw lines (1-based; 0 = whitespace-only). */
function boundsFrom(lines: string[]) {
  return (lineNumber: number): LineTextBounds => {
    const text = lines[lineNumber - 1] ?? "";
    const trimmed = text.trimEnd();
    const first = text.length - text.trimStart().length;
    if (trimmed.length === 0) {
      return { firstNonWhitespaceColumn: 0, lastNonWhitespaceColumn: 0 };
    }
    return {
      firstNonWhitespaceColumn: first + 1,
      lastNonWhitespaceColumn: trimmed.length + 1,
    };
  };
}

describe("splitSpanIntoLineRanges", () => {
  it("trims leading indentation on the closing-paren line", () => {
    const lines = [
      "SELECT Id, (SELECT Name", // span starts at col 12
      "    FROM Contacts",
      "  ) FROM Account", // span ends after ")" at col 4
    ];
    const ranges = splitSpanIntoLineRanges(
      { lineNumber: 1, column: 12 },
      { lineNumber: 3, column: 4 },
      boundsFrom(lines),
    );
    expect(ranges).toHaveLength(3);
    // Closing line: starts at the ")" (col 3), not at col 1 indentation.
    expect(ranges[2]).toEqual({
      startLineNumber: 3,
      startColumn: 3,
      endLineNumber: 3,
      endColumn: 4,
    });
  });

  it("trims middle full lines to their text (no leading/trailing whitespace)", () => {
    const lines = [
      "SELECT Id, (SELECT Name",
      "    FROM Contacts   ", // text spans cols 5..18
      ")",
    ];
    const ranges = splitSpanIntoLineRanges(
      { lineNumber: 1, column: 12 },
      { lineNumber: 3, column: 2 },
      boundsFrom(lines),
    );
    expect(ranges[1]).toEqual({
      startLineNumber: 2,
      startColumn: 5,
      endLineNumber: 2,
      endColumn: 18,
    });
    // First line keeps the span's own start column.
    expect(ranges[0]).toEqual({
      startLineNumber: 1,
      startColumn: 12,
      endLineNumber: 1,
      endColumn: 24,
    });
  });

  it("skips whitespace-only lines inside the span", () => {
    const lines = [
      "SELECT Id, (SELECT Name",
      "   ", // blank line inside the subquery
      "  FROM Contacts)",
    ];
    const ranges = splitSpanIntoLineRanges(
      { lineNumber: 1, column: 12 },
      { lineNumber: 3, column: 17 },
      boundsFrom(lines),
    );
    expect(ranges).toHaveLength(2);
    expect(ranges.map((r) => r.startLineNumber)).toEqual([1, 3]);
  });

  it("keeps a single-line span within its own columns", () => {
    const lines = ["SELECT Id, (SELECT Name FROM Contacts) FROM Account"];
    const ranges = splitSpanIntoLineRanges(
      { lineNumber: 1, column: 12 },
      { lineNumber: 1, column: 39 },
      boundsFrom(lines),
    );
    expect(ranges).toEqual([
      { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 39 },
    ]);
  });
});
