import { describe, it, expect } from "vitest";
import { resolveRoot } from "./workspace";

describe("resolveRoot", () => {
  it("uses the override when set", () => {
    expect(resolveRoot("soql", "/custom/soql", "/app")).toBe("/custom/soql");
  });
  it("falls back to appData/workspace/<tool>", () => {
    expect(resolveRoot("apex", null, "/app")).toBe("/app/workspace/apex");
  });
});
