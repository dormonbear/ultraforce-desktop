import { describe, expect, it } from "vitest";
import type { LogRefDto } from "../types";
import { filterLogs, fmtDuration, fmtSize, fmtTime, logUsers } from "./logList";

const mk = (o: Partial<LogRefDto>): LogRefDto => ({
  id: "1",
  operation: "/op",
  status: "Success",
  start_time: "",
  application: "Unknown",
  user: "Alice",
  duration_ms: 0,
  log_length: 0,
  ...o,
});

describe("filterLogs", () => {
  const logs = [
    mk({ id: "a", operation: "/runTests", user: "Alice", status: "Success" }),
    mk({ id: "b", operation: "/opalrest", user: "Bob", status: "Assertion Failed: x" }),
  ];

  it("filters by status", () => {
    expect(filterLogs(logs, { query: "", status: "failed", user: "" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLogs(logs, { query: "", status: "success", user: "" }).map((l) => l.id)).toEqual(["a"]);
  });

  it("filters by user and query (operation or user)", () => {
    expect(filterLogs(logs, { query: "", status: "all", user: "Bob" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLogs(logs, { query: "alice", status: "all", user: "" }).map((l) => l.id)).toEqual(["a"]);
    expect(filterLogs(logs, { query: "opal", status: "all", user: "" }).map((l) => l.id)).toEqual(["b"]);
  });

  it("lists distinct sorted users", () => {
    expect(logUsers(logs)).toEqual(["Alice", "Bob"]);
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
