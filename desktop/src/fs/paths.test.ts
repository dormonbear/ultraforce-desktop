import { describe, it, expect } from "vitest";
import {
  joinPath,
  basename,
  dirname,
  movedPath,
  ancestorsWithin,
  normalizePath,
  isWithin,
  rebasePath,
} from "./paths";

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
    expect(dirname("/a")).toBe("/");
  });
  it("movedPath re-parents an item into a dir", () => {
    expect(movedPath("/a/b/c.soql", "/a/x")).toBe("/a/x/c.soql");
  });
  it("ancestorsWithin lists dir and its parents below root", () => {
    expect(ancestorsWithin("/ws", "/ws/a/b")).toEqual(["/ws/a/b", "/ws/a"]);
    expect(ancestorsWithin("/ws", "/ws")).toEqual([]);
    expect(ancestorsWithin("/ws", "/elsewhere/a")).toEqual([]);
  });
  it("handles native drive and UNC roots and mixed Windows separators", () => {
    expect(joinPath("C:\\", "workspace", "a.soql")).toBe(
      "C:\\workspace\\a.soql",
    );
    expect(joinPath("C:/workspace/", "nested\\a.soql")).toBe(
      "C:\\workspace\\nested\\a.soql",
    );
    expect(joinPath("\\\\server\\share\\", "a.soql")).toBe(
      "\\\\server\\share\\a.soql",
    );
    expect(basename("C:\\workspace\\a.soql")).toBe("a.soql");
    expect(dirname("C:\\a.soql")).toBe("C:\\");
    expect(dirname("\\\\server\\share\\a.soql")).toBe("\\\\server\\share\\");
    expect(ancestorsWithin("C:\\", "C:\\a\\b")).toEqual(["C:\\a\\b", "C:\\a"]);
    expect(
      ancestorsWithin("\\\\server\\share\\", "\\\\server\\share\\a\\b"),
    ).toEqual(["\\\\server\\share\\a\\b", "\\\\server\\share\\a"]);
  });
  it("preserves relative and POSIX paths including literal backslash names", () => {
    expect(joinPath("relative", "a.soql")).toBe("relative/a.soql");
    expect(joinPath("", "a.soql")).toBe("a.soql");
    expect(dirname("/a.soql")).toBe("/");
    expect(joinPath("/tmp", "a\\b.soql")).toBe("/tmp/a\\b.soql");
    expect(basename("/tmp/a\\b.soql")).toBe("a\\b.soql");
    expect(ancestorsWithin("/", "/a/b")).toEqual(["/a/b", "/a"]);
    expect(ancestorsWithin("/Case", "/case/a")).toEqual([]);
    expect(ancestorsWithin("/ws", "/ws-other/a")).toEqual([]);
    expect(joinPath("C:relative", "a.soql")).toBe("C:relative/a.soql");
    expect(normalizePath("/tmp/C:\\literal\\file")).toBe(
      "/tmp/C:\\literal\\file",
    );
    expect(normalizePath("\\literal\\file")).toBe("\\literal\\file");
    expect(rebasePath("/old/a\\b.soql", "/old", "/new")).toBe("/new/a\\b.soql");
    expect(isWithin("/old\\folder/a.soql", "/old")).toBe(false);
    expect(isWithin("/Case/a.soql", "/case")).toBe(false);
  });
  it.each([
    "C:\\",
    "c:/workspace/a.soql",
    "\\\\server\\share",
    "\\\\server\\share\\a\\b",
    "/",
    "relative/a",
    "/tmp/literal\\name",
  ])("canonicalization is idempotent for %s", (path) => {
    expect(normalizePath(normalizePath(path))).toBe(normalizePath(path));
  });
  it("compares drive spelling without folding filenames or crossing roots", () => {
    expect(isWithin("c:/workspace/a.soql", "C:\\workspace")).toBe(true);
    expect(isWithin("C:\\Workspace\\a.soql", "C:\\workspace")).toBe(false);
    expect(isWithin("D:\\workspace\\a.soql", "C:\\")).toBe(false);
    expect(isWithin("\\\\server\\share2\\a", "\\\\server\\share\\")).toBe(
      false,
    );
    expect(
      ancestorsWithin("\\\\server\\share", "\\\\server\\share\\a"),
    ).toEqual(["\\\\server\\share\\a"]);
    expect(dirname("C:\\")).toBe("C:\\");
    expect(dirname("\\\\server\\share\\")).toBe("\\\\server\\share\\");
    expect(joinPath("\\\\server/share", "a.soql")).toBe(
      "\\\\server\\share\\a.soql",
    );
    expect(normalizePath("\\\\server/share/folder/a.soql")).toBe(
      "\\\\server\\share\\folder\\a.soql",
    );
    // A leading POSIX // is not enough to infer UNC semantics. Native UNC
    // starts with backslashes; canonicalization never changes that prefix.
    expect(joinPath("//server/share", "literal\\name")).toBe(
      "//server/share/literal\\name",
    );
  });
});
