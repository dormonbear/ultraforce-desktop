import { describe, expect, it } from "vitest";
import type { LogRefDto } from "../types";
import { filterLogs, fmtDuration, fmtSize, fmtTime } from "./logList";

const mk = (o: Partial<LogRefDto>): LogRefDto => ({
  id: "1",
  operation: "/op",
  status: "Success",
  startTime: "",
  application: "Unknown",
  user: "Alice",
  durationMs: 0,
  logLength: 0,
  ...o,
});

describe("filterLogs", () => {
  const logs = [
    mk({ id: "a", operation: "/runTests", user: "Alice", status: "Success" }),
    mk({ id: "b", operation: "/opalrest", user: "Bob", status: "Assertion Failed: x" }),
  ];

  it("matches operation or user, case-insensitive", () => {
    expect(filterLogs(logs, { query: "alice" }).map((l) => l.id)).toEqual(["a"]);
    expect(filterLogs(logs, { query: "opal" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLogs(logs, { query: "Bob" }).map((l) => l.id)).toEqual(["b"]);
  });

  it("returns all logs when query is empty", () => {
    expect(filterLogs(logs, { query: "" }).map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("formatters", () => {
  it("duration", () => {
    expect(fmtDuration(500)).toBe("500ms");
    expect(fmtDuration(46070)).toBe("46.1s");
  });
  it("size", () => {
    expect(fmtSize(512)).toBe("512 B");
    expect(fmtSize(118636)).toBe("115.9 KB");
    expect(fmtSize(2_000_000)).toBe("1.9 MB");
  });
  it("time invalid → empty", () => {
    expect(fmtTime("")).toBe("");
    expect(fmtTime("nope")).toBe("");
  });
});
