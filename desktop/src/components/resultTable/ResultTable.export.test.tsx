// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResultTable } from "../ResultTable";
import { writeExportFile } from "../export";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "/tmp/query-result.out"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(async () => {}),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../export")>()),
  writeExportFile: vi.fn(async () => {}),
}));

// jsdom lacks ResizeObserver, which ResultTable observes on its scroll container.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom lacks pointer-capture / scrollIntoView, which Radix menus need.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const data = {
  columns: ["Id", "Name"],
  rows: [["001A", "Acme"]],
  totalSize: 1,
  childTables: [],
};

describe("export button", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("left-click exports CSV immediately (no menu)", async () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(writeExportFile).toHaveBeenCalledTimes(1));
    const fmt = vi.mocked(writeExportFile).mock.calls[0][1];
    expect(fmt.id).toBe("csv");
    expect(screen.queryByText("Export as JSON")).toBeNull();
  });

  it("right-click shows all formats and picking one exports it", async () => {
    render(<ResultTable data={data} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByText("Export as CSV")).toBeTruthy();
    expect(screen.getByText("Export as TSV")).toBeTruthy();
    expect(screen.getByText("Export as Excel (XLSX)")).toBeTruthy();
    expect(screen.getByText("Export as Markdown")).toBeTruthy();

    fireEvent.click(screen.getByText("Export as JSON"));
    await waitFor(() => expect(writeExportFile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(writeExportFile).mock.calls[0][1].id).toBe("json");
  });

  it("success toast carries an Open action that opens the file", async () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const opts = vi.mocked(toast.success).mock.calls[0][1] as {
      action: { label: string; onClick: () => void };
    };
    expect(opts.action.label).toBe("Open");
    opts.action.onClick();
    expect(openPath).toHaveBeenCalledWith("/tmp/query-result.out");
  });
});
