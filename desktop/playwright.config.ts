import { defineConfig, devices } from "@playwright/test";

/**
 * Fixed e2e config. Runs the Vite dev server and drives the app with a mocked
 * Tauri IPC layer (see e2e/fixtures.ts) — no native window, no real org.
 * Persistence is mocked onto localStorage so reload-survival can be asserted.
 *
 * PERF_PROD=1 swaps the dev server for a production build served by `vite
 * preview` (minified React, no HMR) so the page-switch perf harness can measure
 * the acceptance gate against a release-like frontend. The mocked IPC is injected
 * at runtime via addInitScript, so it works identically on dev or preview.
 */
const PROD = !!process.env.PERF_PROD;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // The suite runs serially on one shared dev server for ~3 min; the default
  // 5 s assertion budget occasionally underruns late in the run (Monaco mount,
  // completion providers, dialog round-trips). Give assertions/actions headroom
  // so timing variance under load doesn't flake unrelated tests.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    // 127.0.0.1, not localhost: Vite 7 binds IPv6 (::1) only, while Playwright's
    // readiness probe hits IPv4 — pin both sides to IPv4 so they meet.
    baseURL: "http://127.0.0.1:1421",
    actionTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Dedicated port (1420 is the Tauri dev server) so the suite is self-contained.
    // PERF_PROD builds once then serves the minified bundle via `vite preview`;
    // don't reuse a possibly-dev server on that port, and give the build headroom.
    command: PROD
      ? "pnpm vite build && pnpm vite preview --port 1421 --strictPort --host 127.0.0.1"
      : "pnpm vite --port 1421 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: PROD ? false : !process.env.CI,
    timeout: PROD ? 180_000 : 60_000,
  },
});
