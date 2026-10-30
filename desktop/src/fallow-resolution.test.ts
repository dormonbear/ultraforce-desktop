import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("fallow/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  version: string;
  bin: { fallow: string };
};

describe("Fallow dependency resolution / Fallow 依赖解析", () => {
  it("uses a stable release with the path-boundary fixes / 使用包含路径边界修复的稳定版本", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor] = manifest.version.split(".").map(Number);
    expect(major > 3 || (major === 3 && minor >= 34)).toBe(true);
  });

  it("honors the telemetry kill switch / 遵守遥测禁用开关", () => {
    const result = spawnSync(process.execPath, [join(dirname(manifestPath), manifest.bin.fallow), "telemetry", "status"], {
      env: { ...process.env, FALLOW_TELEMETRY: "on", FALLOW_TELEMETRY_DEBUG: "1", FALLOW_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/disabled_by_admin/);
  });
});
