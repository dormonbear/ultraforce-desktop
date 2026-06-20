import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuse the app's vite config (the @ alias etc.), but scope vitest to unit
// tests under src — the Playwright e2e specs under e2e/ are NOT vitest tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  }),
);
