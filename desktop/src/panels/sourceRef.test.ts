import { describe, it, expect } from "vitest";
import { parseSourceRef } from "./sourceRef";

describe("parseSourceRef", () => {
  it("pulls class + line from a METHOD_ENTRY detail", () => {
    expect(parseSourceRef("[15] | 01p | MyClass.doWork()")).toEqual({
      className: "MyClass",
      line: 15,
    });
  });

  it("pulls class with no line from a hotspot signature", () => {
    expect(parseSourceRef("MyClass.doWork()")).toEqual({ className: "MyClass", line: null });
  });

  it("uses the class, not the namespace, for ns.Class.method()", () => {
    expect(parseSourceRef("ns.MyClass.doWork()")?.className).toBe("MyClass");
  });

  it("returns null when there's no method-call shape", () => {
    expect(parseSourceRef("USER_DEBUG")).toBeNull();
    expect(parseSourceRef("MyTrigger on Account trigger event")).toBeNull();
  });
});
