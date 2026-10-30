import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("fallow/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  version: string;
  bin: { fallow: string };
};
const cli = join(dirname(manifestPath), manifest.bin.fallow);

describe("Fallow dependency resolution / Fallow 依赖解析", () => {
  it("uses a stable release with the path-boundary fixes / 使用包含路径边界修复的稳定版本", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor] = manifest.version.split(".").map(Number);
    expect(major > 3 || (major === 3 && minor >= 34)).toBe(true);
  });

  it("honors the telemetry kill switch / 遵守遥测禁用开关", () => {
    const result = spawnSync(process.execPath, [cli, "telemetry", "status"], {
      env: { ...process.env, FALLOW_TELEMETRY: "on", FALLOW_TELEMETRY_DEBUG: "1", FALLOW_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/disabled_by_admin/);
  });

  it("still fails the audit gate for introduced unused code / 新增未使用代码仍会使审计门禁失败", () => {
    const root = mkdtempSync(join(tmpdir(), "uf-fallow-gate-"));
    try {
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "hooks"));
      writeFileSync(join(root, "git-global"), "");
      const env = {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(root, "git-global"),
        FALLOW_TELEMETRY_DISABLED: "1",
        FALLOW_AUDIT_BASE: "HEAD",
        FALLOW_CACHE_DIR: join(root, ".fallow-cache"),
      };
      const git = (...args: string[]) => {
        const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", timeout: 15_000 });
        expect(result.status).toBe(0);
      };
      git("init", "--quiet");
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "synthetic-fallow-gate",
        private: true,
        scripts: { start: "node src/index.js" },
      }));
      writeFileSync(join(root, "src", "index.js"), 'console.log("Synthetic fixture / 合成夹具");\n');
      git("add", "package.json", "src/index.js");
      git("-c", `core.hooksPath=${join(root, "hooks")}`, "-c", "commit.gpgsign=false",
        "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid",
        "commit", "--quiet", "-m", "fixture / 夹具");
      const audit = () => spawnSync(process.execPath, [cli, "audit"], {
        cwd: root, env, encoding: "utf8", timeout: 20_000,
      });
      expect(audit().status).toBe(0);
      writeFileSync(join(root, "src", "unused.js"), "export const syntheticUnused = 1;\n");
      git("add", "src/unused.js");
      const failure = audit();
      expect(failure.status).toBe(1);
      expect(failure.stdout + failure.stderr).toMatch(/unused\.js/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
