import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the self-host smoke test (.github/workflows/selfhost-smoke.yml).
 *
 * Unlike playwright.config.ts this has no webServer and loads no .env files:
 * the stack under test is the docker compose install, already running at
 * SELFHOST_URL (default http://localhost:3000). The specs drive a fresh
 * single-mode install from first run, so they share one database and run
 * serially in one worker.
 */
export default defineConfig({
  testDir: "./tests/selfhost",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.SELFHOST_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
