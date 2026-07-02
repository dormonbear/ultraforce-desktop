import { describe, expect, it } from "vitest";
import { buildInsertion, isStatementPosition, KEYWORD_SNIPPETS } from "./apexSuggest";
import type { ApexCandidateDto } from "../types";

const ctx = (over: Partial<Parameters<typeof buildInsertion>[1]> = {}) => ({
  nextChar: "",
  lineBeforeWord: "System.",
  lineAfterCursor: "",
  ...over,
});
const method = (over: Partial<ApexCandidateDto> = {}): ApexCandidateDto => ({
  label: "debug",
  kind: "method",
  detail: "void",
  params: ["Object"],
  ...over,
});

describe("buildInsertion — methods", () => {
  it("inserts placeholder-arg call snippets (fill-arguments style)", () => {
    const ins = buildInsertion(method({ detail: "String", params: ["Object", "Integer"] }), ctx({ lineBeforeWord: "x = System." }));
    expect(ins).toEqual({
      insertText: "debug(${1:Object}, ${2:Integer})$0",
      isSnippet: true,
      triggerSignatureHelp: true,
    });
  });
  it("void method in statement position gets the semicolon inside the snippet", () => {
    const ins = buildInsertion(method(), ctx({ lineBeforeWord: "  System." }));
    expect(ins.insertText).toBe("debug(${1:Object});$0");
  });
  it("non-void methods never gain a semicolon", () => {
    const ins = buildInsertion(method({ detail: "String" }), ctx({ lineBeforeWord: "System." }));
    expect(ins.insertText).toBe("debug(${1:Object})$0");
  });
  it("semicolon suppressed when text follows the caret on the line", () => {
    const ins = buildInsertion(method(), ctx({ lineAfterCursor: " x" }));
    expect(ins.insertText).toBe("debug(${1:Object})$0");
  });
  it("no-arg method inserts empty parens, no signature help", () => {
    const ins = buildInsertion(method({ label: "now", detail: "Datetime", params: [] }), ctx({ lineBeforeWord: "x = Datetime." }));
    expect(ins).toEqual({ insertText: "now()$0", isSnippet: true, triggerSignatureHelp: false });
  });
  it("no-arg void method in statement position still gets the semicolon", () => {
    const ins = buildInsertion(method({ label: "commit", params: [] }), ctx());
    expect(ins.insertText).toBe("commit();$0");
  });
  it("skips parens entirely when the next char is already (", () => {
    const ins = buildInsertion(method(), ctx({ nextChar: "(", lineAfterCursor: "()" }));
    expect(ins).toEqual({ insertText: "debug", isSnippet: false, triggerSignatureHelp: false });
  });
  it("methods without params info fall back to plain label", () => {
    const ins = buildInsertion(method({ params: null }), ctx());
    expect(ins).toEqual({ insertText: "debug", isSnippet: false, triggerSignatureHelp: false });
  });
});

describe("buildInsertion — types and constructors", () => {
  it("generic builtin types keep the <> snippet", () => {
    expect(buildInsertion({ label: "List", kind: "type" }, ctx({ lineBeforeWord: "" })).insertText).toBe("List<$0>");
    expect(buildInsertion({ label: "Map", kind: "type" }, ctx({ lineBeforeWord: "" })).insertText).toBe("Map<$1, $2>");
  });
  it("plain types insert the bare label", () => {
    expect(buildInsertion({ label: "Account", kind: "type" }, ctx())).toEqual({
      insertText: "Account", isSnippet: false, triggerSignatureHelp: false,
    });
  });
  it("constructors insert call parens", () => {
    expect(buildInsertion({ label: "Account", kind: "constructor" }, ctx()).insertText).toBe("Account($1)$0");
  });
  it("generic constructors combine <> and ()", () => {
    expect(buildInsertion({ label: "List", kind: "constructor" }, ctx()).insertText).toBe("List<$1>($2)$0");
  });
  it("constructor skips parens when they already follow", () => {
    expect(buildInsertion({ label: "Account", kind: "constructor" }, ctx({ nextChar: "(" })).insertText).toBe("Account");
  });
});

describe("isStatementPosition", () => {
  it("true for a bare receiver chain at line start", () => {
    expect(isStatementPosition("  System.")).toBe(true);
    expect(isStatementPosition("")).toBe(true);
  });
  it("false inside an expression", () => {
    expect(isStatementPosition("if (x) System.")).toBe(false);
    expect(isStatementPosition("foo(System.")).toBe(false);
    expect(isStatementPosition("Integer n = Math.")).toBe(false);
  });
});

describe("KEYWORD_SNIPPETS", () => {
  it("covers the control-flow blocks", () => {
    for (const kw of ["if", "for", "while", "try"]) expect(KEYWORD_SNIPPETS[kw]?.length).toBeGreaterThan(0);
    expect(KEYWORD_SNIPPETS.for).toHaveLength(2); // classic + for-each
    expect(KEYWORD_SNIPPETS.if[0].body).toContain("$0");
  });
});
