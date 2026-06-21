import { describe, expect, it } from "vitest";
import { limitInsertion } from "./soqlQuickfix";

describe("limitInsertion", () => {
  it("appends LIMIT at the end of a plain query", () => {
    const q = "SELECT Id FROM Account";
    const { offset, text } = limitInsertion(q);
    expect(offset).toBe(q.length);
    expect(text).toBe(" LIMIT 200");
  });

  it("ignores trailing whitespace when appending", () => {
    const q = "SELECT Id FROM Account   ";
    const { offset, text } = limitInsertion(q);
    expect(offset).toBe("SELECT Id FROM Account".length);
    expect(text).toBe(" LIMIT 200");
  });

  it("inserts LIMIT before OFFSET", () => {
    const q = "SELECT Id FROM Account OFFSET 10";
    const { offset, text } = limitInsertion(q);
    expect(q.slice(offset)).toBe("OFFSET 10");
    expect(text).toBe("LIMIT 200 ");
  });

  it("inserts LIMIT before FOR UPDATE", () => {
    const q = "SELECT Id FROM Account FOR UPDATE";
    const { offset, text } = limitInsertion(q);
    expect(q.slice(offset)).toBe("FOR UPDATE");
    expect(text).toBe("LIMIT 200 ");
  });

  it("respects a custom count", () => {
    expect(limitInsertion("SELECT Id FROM Account", 50).text).toBe(" LIMIT 50");
  });
});
