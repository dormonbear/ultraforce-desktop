import { defineConfig, devices } from "@playwright/test";

/**
 * Fixed e2e config. Runs the Vite dev server and drives the app with a mocked
 * Tauri IPC layer (see e2e/fixtures.ts) — no native window, no real org.
 * Persistence is mocked onto localStorage so reload-survival can be asserted.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1421",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Dedicated port (1420 is the Tauri dev server) so the suite is self-contained.
    command: "pnpm vite --port 1421 --strictPort",
    url: "http://localhost:1421",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
