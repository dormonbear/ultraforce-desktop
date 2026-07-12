// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SchemaSearchBar } from "./SchemaSearchBar";
import type { SchemaSearchHit } from "../../types";

vi.mock("../../ipc/schema", () => ({
  searchSchema: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("./useSchemaNav", () => ({
  navigateTo: vi.fn(),
}));

import { searchSchema } from "../../ipc/schema";
import { toast } from "sonner";
import { navigateTo } from "./useSchemaNav";

const hits: SchemaSearchHit[] = [
  {
    objectName: "Account",
    fieldName: "Industry",
    fieldLabel: "Industry Label",
    snippet: "type [pick] here",
  },
  {
    objectName: "Contact",
    fieldName: "Email",
    fieldLabel: "Email Address",
    snippet: "the [mail] field",
  },
];

/** Type a query and let the 150ms debounce + resolved promise settle. */
async function typeAndSettle(value: string) {
  const input = screen.getByLabelText("Search schema") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(150);
  });
  return input;
}

describe("SchemaSearchBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("debounces typing and calls searchSchema with (org, query, 30)", async () => {
    vi.mocked(searchSchema).mockResolvedValue([]);
    render(<SchemaSearchBar org="ultraforce" />);
    const input = screen.getByLabelText("Search schema") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ind" } });
    // Not called until the debounce elapses.
    expect(searchSchema).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(searchSchema).toHaveBeenCalledWith("ultraforce", "ind", 30);
  });

  it("renders results as object.field, label and a highlighted snippet", async () => {
    vi.mocked(searchSchema).mockResolvedValue(hits);
    render(<SchemaSearchBar org="ultraforce" />);
    await typeAndSettle("i");
    expect(screen.getByText("Account.Industry")).toBeTruthy();
    expect(screen.getByText("Industry Label")).toBeTruthy();
    const marked = screen.getByText("pick");
    expect(marked.tagName).toBe("MARK");
  });

  it("Enter picks the active result, navigates, and clears+closes", async () => {
    vi.mocked(searchSchema).mockResolvedValue(hits);
    render(<SchemaSearchBar org="ultraforce" />);
    const input = await typeAndSettle("i");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigateTo).toHaveBeenCalledWith({
      object: "Account",
      field: "Industry",
    });
    expect(input.value).toBe("");
    expect(screen.queryByText("Account.Industry")).toBeNull();
  });

  it("ArrowDown moves the active row so Enter picks the next result", async () => {
    vi.mocked(searchSchema).mockResolvedValue(hits);
    render(<SchemaSearchBar org="ultraforce" />);
    const input = await typeAndSettle("i");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigateTo).toHaveBeenCalledWith({
      object: "Contact",
      field: "Email",
    });
  });

  it("clicking a result navigates and closes", async () => {
    vi.mocked(searchSchema).mockResolvedValue(hits);
    render(<SchemaSearchBar org="ultraforce" />);
    await typeAndSettle("i");
    fireEvent.click(screen.getByText("Contact.Email"));
    expect(navigateTo).toHaveBeenCalledWith({
      object: "Contact",
      field: "Email",
    });
    expect(screen.queryByText("Contact.Email")).toBeNull();
  });

  it("Esc closes the results but keeps the input focused", async () => {
    vi.mocked(searchSchema).mockResolvedValue(hits);
    render(<SchemaSearchBar org="ultraforce" />);
    const input = await typeAndSettle("i");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Account.Industry")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("blur closes the dropdown", async () => {
    vi.mocked(searchSchema).mockResolvedValue(hits);
    render(<SchemaSearchBar org="ultraforce" />);
    const input = await typeAndSettle("i");
    fireEvent.blur(input);
    expect(screen.queryByText("Account.Industry")).toBeNull();
  });

  it("with a null org, shows a hint and never queries", async () => {
    render(<SchemaSearchBar org={null} />);
    await typeAndSettle("x");
    expect(searchSchema).not.toHaveBeenCalled();
    expect(screen.getByText(/select an org first/i)).toBeTruthy();
  });

  it("toasts and closes the dropdown on an ipc error", async () => {
    vi.mocked(searchSchema).mockRejectedValue({ code: "io", message: "boom" });
    render(<SchemaSearchBar org="ultraforce" />);
    await typeAndSettle("x");
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(screen.queryByText("Account.Industry")).toBeNull();
  });
});
