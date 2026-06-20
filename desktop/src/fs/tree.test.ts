import { describe, it, expect } from "vitest";
import { sortEntries } from "./tree";

describe("sortEntries", () => {
  it("dirs first, then files, each name-sorted", () => {
    const out = sortEntries([
      { name: "b.soql", isDirectory: false },
      { name: "Zfolder", isDirectory: true },
      { name: "a.soql", isDirectory: false },
      { name: "Afolder", isDirectory: true },
    ]);
    expect(out.map((e) => e.name)).toEqual([
      "Afolder",
      "Zfolder",
      "a.soql",
      "b.soql",
    ]);
  });
});
