import { describe, expect, it } from "vitest";
import { renameIntent, stemSelectionEnd } from "./nameEdit";

describe("stemSelectionEnd", () => {
  it("stops before the extension dot", () => {
    expect(stemSelectionEnd("query.soql")).toBe(5);
    expect(stemSelectionEnd("MyClass.apex")).toBe(7);
  });

  it("uses the last dot for multi-dot names", () => {
    expect(stemSelectionEnd("a.b.soql")).toBe(3);
  });

  it("selects the whole name when there is no extension", () => {
    expect(stemSelectionEnd("README")).toBe(6);
  });

  it("selects the whole name for dotfiles", () => {
    expect(stemSelectionEnd(".env")).toBe(4);
  });
});

describe("renameIntent", () => {
  it("rejects an empty name so the editor stays open", () => {
    expect(renameIntent("  ", "a.soql", "/a.soql")).toEqual({
      kind: "done",
      ok: false,
    });
  });

  it("treats an unchanged name as a no-op that closes", () => {
    expect(renameIntent("a.soql", "a.soql", "/a.soql")).toEqual({
      kind: "done",
      ok: true,
    });
  });

  it("retitles an untitled tab (no path) in memory", () => {
    expect(renameIntent("Draft", "Untitled-1", "")).toEqual({
      kind: "title",
      name: "Draft",
    });
  });

  it("renames a saved tab's file, trimming the input", () => {
    expect(renameIntent(" b.soql ", "a.soql", "/a.soql")).toEqual({
      kind: "file",
      name: "b.soql",
    });
  });
});
