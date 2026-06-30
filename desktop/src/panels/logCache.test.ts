import { describe, expect, it, vi } from "vitest";
import { cacheFilePath, loadLogView } from "./logCache";
import type { LogViewDto } from "../types";

const dto = (raw: string): LogViewDto => ({
  raw,
  api_version: "60.0",
  units: [],
});

describe("cacheFilePath", () => {
  it("places a log under <appData>/workspace/logcache/<id>.log", () => {
    expect(cacheFilePath("/app", "07L1")).toBe("/app/workspace/logcache/07L1.log");
  });
});

describe("loadLogView", () => {
  it("parses the cached body locally and never downloads on a cache hit", async () => {
    const getLog = vi.fn();
    const writeCache = vi.fn();
    const parse = vi.fn(async (body: string) => dto(body));

    const view = await loadLogView("07L1", {
      readCache: async () => "CACHED BODY",
      parse,
      getLog,
      writeCache,
    });

    expect(view.raw).toBe("CACHED BODY");
    expect(parse).toHaveBeenCalledWith("CACHED BODY");
    expect(getLog).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("downloads and writes the body to cache on a miss", async () => {
    const writeCache = vi.fn(async () => {});
    const parse = vi.fn();

    const view = await loadLogView("07L1", {
      readCache: async () => null,
      parse,
      getLog: async () => dto("DOWNLOADED"),
      writeCache,
    });

    expect(view.raw).toBe("DOWNLOADED");
    expect(parse).not.toHaveBeenCalled();
    expect(writeCache).toHaveBeenCalledWith("07L1", "DOWNLOADED");
  });
});
