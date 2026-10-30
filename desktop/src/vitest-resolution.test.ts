import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const projectRequire = createRequire(import.meta.url);
const vitestPackage = projectRequire.resolve("vitest/package.json");
const vitestRequire = createRequire(vitestPackage);

function packageVersion(path: string): string {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

describe("Vitest dependency resolution / Vitest 依赖解析", () => {
  const vitestVersion = packageVersion(vitestPackage);
  const mockerVersion = packageVersion(vitestRequire.resolve("@vitest/mocker/package.json"));
  const coverageVersion = packageVersion(projectRequire.resolve("@vitest/coverage-v8/package.json"));

  it("uses a patched stable release / 使用已修复的稳定版本", () => {
    expect(vitestVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = vitestVersion.split(".").map(Number);
    expect(major > 4 || (major === 4 && (minor > 1 || (minor === 1 && patch >= 12)))).toBe(true);
  });

  it("aligns Vitest, its mocker and coverage provider / 对齐 Vitest、模拟器与覆盖率提供器", () => {
    expect(mockerVersion).toBe(vitestVersion);
    expect(coverageVersion).toBe(vitestVersion);
  });
});
