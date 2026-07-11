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

  it("shows the button with no spinner when idle", () => {
    render(<SchemaRefresh />);
    const button = screen.getByRole("button", { name: "Reindex org" });
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    expect(within(button).queryByLabelText("Loading")).toBeNull();
  });

  it("hides the button entirely while indexing (pill owns the only spinner)", () => {
    render(<SchemaRefresh />);
    emit("sobjects");
    expect(screen.queryByRole("button", { name: "Reindex org" })).toBeNull();
  });

  it("shows the button again once indexing completes", () => {
    render(<SchemaRefresh />);
    emit("sobjects");
    emit("done");
    // getByRole throws if absent, so this asserts the button is back.
    expect(screen.getByRole("button", { name: "Reindex org" })).toBeTruthy();
  });
});
