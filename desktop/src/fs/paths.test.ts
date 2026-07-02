import { describe, it, expect } from "vitest";
import { joinPath, basename, dirname, movedPath, ancestorsWithin } from "./paths";

describe("paths", () => {
  it("joins parts with a single slash", () => {
    expect(joinPath("/a", "b", "c.soql")).toBe("/a/b/c.soql");
    expect(joinPath("/a/", "/b/")).toBe("/a/b");
  });
  it("basename returns the last segment", () => {
    expect(basename("/a/b/c.soql")).toBe("c.soql");
    expect(basename("c.soql")).toBe("c.soql");
  });
  it("dirname returns the parent", () => {
    expect(dirname("/a/b/c.soql")).toBe("/a/b");
    expect(dirname("/a")).toBe("");
  });
  it("movedPath re-parents an item into a dir", () => {
    expect(movedPath("/a/b/c.soql", "/a/x")).toBe("/a/x/c.soql");
  });
  it("ancestorsWithin lists dir and its parents below root", () => {
    expect(ancestorsWithin("/ws", "/ws/a/b")).toEqual(["/ws/a/b", "/ws/a"]);
    expect(ancestorsWithin("/ws", "/ws")).toEqual([]);
    expect(ancestorsWithin("/ws", "/elsewhere/a")).toEqual([]);
  });
});
