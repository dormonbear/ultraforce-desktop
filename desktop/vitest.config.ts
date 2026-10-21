import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuse the app's vite config (the @ alias etc.), but scope vitest to unit
// tests under src — the Playwright e2e specs under e2e/ are NOT vitest tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      environment: "node",
      coverage: {
        provider: "v8",
        // Count untouched source too, so untested modules cannot disappear. / 同时统计未触及源码，避免未测试模块从覆盖率中消失。
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
        reporter: ["text", "html", "lcov", "json-summary"],
        thresholds: {
          statements: 40,
          branches: 38,
          functions: 37,
          lines: 40,
        },
      },
    },
  }),
);
