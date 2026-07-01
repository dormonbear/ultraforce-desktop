import { describe, it, expect } from "vitest";
import { flameColor } from "./flameColor";

describe("flameColor", () => {
  it("colors by event category", () => {
    expect(flameColor("EXCEPTION_THROWN")).toBe("#ef4444");
    expect(flameColor("SOQL_EXECUTE_BEGIN")).toBe("#22c55e");
    expect(flameColor("DML_BEGIN")).toBe("#22c55e");
    expect(flameColor("METHOD_ENTRY")).toBe("#64748b");
    expect(flameColor("SOMETHING_ELSE")).toBe("#475569");
  });
});
