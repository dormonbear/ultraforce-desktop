// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, within } from "@testing-library/react";
import type { Progress } from "./indexBar";

// Capture the `index-progress` listener so tests can drive the stream.
let progressHandler: ((e: { payload: Progress }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, cb: (e: { payload: Progress }) => void) => {
    progressHandler = cb;
    return Promise.resolve(() => {
      progressHandler = null;
    });
  },
}));

vi.mock("../org", () => ({ useOrgs: () => ({ selected: "me@example.com" }) }));
vi.mock("../indexSettings", () => ({
  getNamespacePolicy: vi.fn(async () => "all"),
}));
vi.mock("../ipc/schema", () => ({ reindexOrg: vi.fn(async () => {}) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SchemaRefresh } from "./SchemaRefresh";

/** Emit an index-progress event into the mounted component. */
function emit(phase: string) {
  act(() => {
    progressHandler?.({
      payload: { org: "me@example.com", phase, done: 1, total: 10 },
    });
  });
}

describe("SchemaRefresh spinner dedupe", () => {
  beforeEach(() => {
    progressHandler = null;
  });
  afterEach(cleanup);

  it("is enabled with no spinner when idle", () => {
    render(<SchemaRefresh />);
    const button = screen.getByRole("button", { name: "Reindex org" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    expect(within(button).queryByLabelText("Loading")).toBeNull();
  });

  it("disables the button without a second spinner while indexing", () => {
    render(<SchemaRefresh />);
    emit("sobjects");
    const button = screen.getByRole("button", { name: "Reindex org" });
    // Disabled state is conveyed to assistive tech...
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // ...but the button never shows its own loading spinner (the top-bar pill
    // owns the single spinner during indexing).
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    expect(within(button).queryByLabelText("Loading")).toBeNull();
  });

  it("re-enables the button once indexing completes", () => {
    render(<SchemaRefresh />);
    emit("sobjects");
    emit("done");
    const button = screen.getByRole("button", { name: "Reindex org" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
  });
});
