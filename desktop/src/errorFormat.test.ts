import { describe, it, expect } from "vitest";
import { parseSfError, isCliUnavailable } from "./errorFormat";

describe("isCliUnavailable", () => {
  it("detects the sf-not-found error", () => {
    expect(
      isCliUnavailable("`sf` CLI not found on PATH; install the Salesforce CLI"),
    ).toBe(true);
  });
  it("is false for ordinary query errors", () => {
    expect(
      isCliUnavailable(
        'Command { status: 1, name: "INVALID_TYPE", message: "..." }',
      ),
    ).toBe(false);
  });
});

describe("parseSfError", () => {
  it("humanizes the name and un-escapes a multi-line sf message", () => {
    // What `format!("{e:?}")` forwards for an `sf` Command failure: the real
    // newlines in the message arrive escaped as the two characters `\n`.
    const raw =
      'Command { status: 1, name: "INVALID_TYPE", message: "\\nFROM Maycur_Form__c\\n     ^\\nERROR at Row:2:Column:6\\nsObject type \'Maycur_Form__c\' is not supported." }';
    const e = parseSfError(raw);
    expect(e.title).toBe("Invalid type");
    expect(e.detail).toBe(
      "FROM Maycur_Form__c\n     ^\nERROR at Row:2:Column:6\nsObject type 'Maycur_Form__c' is not supported.",
    );
    expect(e.detail).not.toContain("\\n");
    expect(e.raw).toBe(raw);
  });

  it("un-escapes embedded quotes and backslashes", () => {
    const raw =
      'Command { status: 1, name: "MALFORMED_QUERY", message: "unexpected token: \\"SE\\"" }';
    expect(parseSfError(raw).detail).toBe('unexpected token: "SE"');
  });

  it("falls back to the raw string when it is not a Command error", () => {
    const e = parseSfError("`sf` timed out after 300s");
    expect(e.title).toBe("Error");
    expect(e.detail).toBe("`sf` timed out after 300s");
  });
});
