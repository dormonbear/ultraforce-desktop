import { describe, it, expect } from "vitest";
import {
  parseSfError,
  isCliUnavailable,
  isApexLogAccessDenied,
  formatIpcError,
} from "./errorFormat";

describe("formatIpcError", () => {
  it("passes plain strings through", () => {
    expect(formatIpcError("boom")).toBe("boom");
  });
  it("extracts message from a CommandError object", () => {
    expect(formatIpcError({ code: "command", message: "it failed" })).toBe(
      "it failed",
    );
  });
  it("uses an Error's message", () => {
    expect(formatIpcError(new Error("oops"))).toBe("oops");
  });
  it("falls back to String() for anything else", () => {
    expect(formatIpcError(42)).toBe("42");
    expect(formatIpcError(null)).toBe("null");
    expect(formatIpcError({ message: 7 })).toBe("[object Object]");
  });
});

describe("isCliUnavailable", () => {
  it("detects the sf-not-found error", () => {
    expect(
      isCliUnavailable("`sf` CLI not found on PATH; install the Salesforce CLI"),
    ).toBe(true);
  });
  it("is false for ordinary query errors", () => {
    expect(
      isCliUnavailable(
        "`sf` command failed (status 1): INVALID_TYPE: sObject type not supported",
      ),
    ).toBe(false);
  });
});

describe("isApexLogAccessDenied", () => {
  it("detects the ApexLog missing-permission error", () => {
    expect(
      isApexLogAccessDenied(
        "`sf` command failed (status 1): INVALID_TYPE: sObject type 'ApexLog' is not supported.",
      ),
    ).toBe(true);
  });
  it("is false for INVALID_TYPE on other objects", () => {
    expect(
      isApexLogAccessDenied(
        "`sf` command failed (status 1): INVALID_TYPE: sObject type 'Maycur_Form__c' is not supported.",
      ),
    ).toBe(false);
  });
});

describe("parseSfError", () => {
  it("humanizes the name and keeps a multi-line sf message", () => {
    // What the backend forwards for an `sf` Command failure: `SfError`'s
    // Display text, with the message's real newlines intact.
    const raw =
      "`sf` command failed (status 1): INVALID_TYPE: \nFROM Maycur_Form__c\n     ^\nERROR at Row:2:Column:6\nsObject type 'Maycur_Form__c' is not supported.";
    const e = parseSfError(raw);
    expect(e.title).toBe("Invalid type");
    expect(e.detail).toBe(
      "FROM Maycur_Form__c\n     ^\nERROR at Row:2:Column:6\nsObject type 'Maycur_Form__c' is not supported.",
    );
    expect(e.raw).toBe(raw);
  });

  it("keeps colons inside the message", () => {
    const raw =
      '`sf` command failed (status 1): MALFORMED_QUERY: unexpected token: "SE"';
    expect(parseSfError(raw).detail).toBe('unexpected token: "SE"');
  });

  it("falls back to the raw string when it is not a Command error", () => {
    const e = parseSfError("`sf` timed out after 300s");
    expect(e.title).toBe("Error");
    expect(e.detail).toBe("`sf` timed out after 300s");
  });
});
