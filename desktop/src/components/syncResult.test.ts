import { describe, expect, it } from "vitest";
import { syncLabel } from "./syncResult";

describe("syncLabel", () => {
  it("summarizes the change counts", () => {
    expect(syncLabel({ org: "o", added: 2, updated: 1, removed: 0 })).toBe(
      "Synced 3 updates",
    );
    expect(syncLabel({ org: "o", added: 0, updated: 1, removed: 0 })).toBe(
      "Synced 1 update",
    );
  });
});
