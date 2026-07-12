import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the tauri-plugin-store wrapper, so the round-trip test
// exercises the real key derivation + get/set flow without a backend.
const mem = new Map<string, unknown>();
vi.mock("./store", () => ({
  getJson: vi.fn(async (key: string, fallback: unknown) =>
    mem.has(key) ? mem.get(key) : fallback,
  ),
  setJson: vi.fn(async (key: string, value: unknown) => {
    mem.set(key, value);
  }),
  flush: vi.fn(async () => {}),
}));

import {
  getOrgConfig,
  setOrgConfig,
  orgConfigKey,
  normalizeApiVersion,
  parseTimeoutSecs,
} from "./orgConfig";
import { flush } from "./store";
import type { OrgConfig } from "./types";

beforeEach(() => {
  mem.clear();
  vi.clearAllMocks();
});

describe("normalizeApiVersion", () => {
  it("appends .0 to a bare integer", () => {
    expect(normalizeApiVersion("58")).toBe("58.0");
    expect(normalizeApiVersion(" 60 ")).toBe("60.0");
    expect(normalizeApiVersion("058")).toBe("58.0");
  });

  it("keeps an already-suffixed NN.0", () => {
    expect(normalizeApiVersion("58.0")).toBe("58.0");
    expect(normalizeApiVersion("7.0")).toBe("7.0");
  });

  it("rejects non-.0 decimals, empty, and non-numeric input", () => {
    expect(normalizeApiVersion("58.5")).toBeNull();
    expect(normalizeApiVersion("")).toBeNull();
    expect(normalizeApiVersion("abc")).toBeNull();
    expect(normalizeApiVersion("v58")).toBeNull();
    expect(normalizeApiVersion("58.")).toBeNull();
  });
});

describe("parseTimeoutSecs", () => {
  it("accepts positive whole seconds", () => {
    expect(parseTimeoutSecs("120")).toBe(120);
    expect(parseTimeoutSecs(" 30 ")).toBe(30);
  });

  it("rejects zero, negative, decimals, and non-numeric", () => {
    expect(parseTimeoutSecs("0")).toBeNull();
    expect(parseTimeoutSecs("-5")).toBeNull();
    expect(parseTimeoutSecs("1.5")).toBeNull();
    expect(parseTimeoutSecs("")).toBeNull();
    expect(parseTimeoutSecs("abc")).toBeNull();
  });
});

describe("OrgConfig store round-trip", () => {
  it("uses the orgConfig.<username> key", () => {
    expect(orgConfigKey("me@x.com")).toBe("orgConfig.me@x.com");
  });

  it("returns an empty object when unset", async () => {
    expect(await getOrgConfig("nobody@x.com")).toEqual({});
  });

  it("writes then reads back the same config and flushes", async () => {
    const cfg: OrgConfig = {
      apiVersion: "58.0",
      timeoutSecs: 90,
      alias: "prod",
      color: "red",
    };
    await setOrgConfig("me@x.com", cfg);
    expect(flush).toHaveBeenCalledOnce();
    expect(await getOrgConfig("me@x.com")).toEqual(cfg);
    // Isolated per username.
    expect(await getOrgConfig("other@x.com")).toEqual({});
  });
});
