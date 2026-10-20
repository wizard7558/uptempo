import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

/**
 * Load env files exactly the way Next does (.env, .env.local,
 * .env.development, ...) so the Playwright runner and the spawned `next dev`
 * agree (dev mode, so .env.production* is never read). Test workers (auth-setup, fixtures) read DATABASE_URL and
 * BETTER_AUTH_SECRET from process.env.
 */
loadEnvConfig(process.cwd(), true);

const e2ePort = process.env.E2E_PORT ?? "3000";
const e2eBaseUrl = `http://localhost:${e2ePort}`;
const e2eDevCommand = process.env.E2E_DEV_COMMAND ?? "npm run dev";

// Signed private-file URLs have no dev fallback for the secret, and the e2e
// fixtures sign the booking_session cookie with it. Default it once here so the
// spawned dev server and the test workers agree (an .env.local value wins).
process.env.BOOKING_SESSION_SECRET ||= "e2e-booking-session-secret";

/**
 * Playwright E2E test configuration for Uptempo Scheduler.
 *
 * Projects:
 *   - setup: Seeds a real admin session in the database and saves storageState
 *   - admin: Admin tests that depend on setup (use storageState for auth)
 *   - booking: Public booking tests (no auth needed)
 *   - marketing: Public marketing pages (no auth needed)
 *
 * External services (Stripe, Cronofy, Resend) are mocked via page.route()
 * so tests require no API keys.
 *
 * Database dependency: Tests require a running Postgres database with seed
 * data (at least one tenant, salon, stylist, and services).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker: every spec shares the single seeded test-salon tenant, and the
  // booking specs create appointments that consume the slots the others look
  // for (parallel runs made booking-flex / booking-flow fail intermittently).
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "html",

  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },

  projects: [
    // Auth setup -- runs first, creates session cookie
    {
      name: "setup",
      testMatch: /auth-setup\.ts/,
    },

    // Admin tests -- require authentication
    {
      name: "admin",
      testMatch:
        /admin-.*\.spec\.ts|hosted-billing\.spec\.ts|text-line\.spec\.ts|appointment-work-mobile\.spec\.ts|custom-fields\.spec\.ts|branding-theme\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/admin.json",
      },
    },

    // Booking tests -- no auth needed (public pages)
    {
      name: "booking",
      // Anchored so admin-booking-*.spec.ts runs only in the authenticated admin project.
      testMatch: /(^|\/)booking-.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    {
      name: "a11y",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/admin.json",
      },
    },

    {
      name: "marketing",
      testMatch: /marketing\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    {
      name: "onboarding",
      testMatch: /onboarding-timed\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    // Invitation acceptance uses a unique synthetic invitee and starts without
    // the admin session created by the setup project.
    {
      name: "team-invitation",
      testMatch: /team-invitation\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
    },

    // One project per industry flow. These select the specs that already book,
    // request, enroll, and join the queue, so CI lists each flow on its own.
    {
      name: "book",
      testMatch: /booking-flow\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "request",
      testMatch: /admin-requests-studio\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/admin.json",
      },
    },
    {
      name: "class",
      testMatch: /admin-classes-gym\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/admin.json",
      },
    },
    {
      name: "queue",
      testMatch: /admin-queue\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/admin.json",
      },
    },
  ],

  webServer: {
    command: e2eDevCommand,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // PAYMENTS_FAKE makes off-session charges succeed without Stripe, and the
    // local storage provider keeps request photos on disk (private files have
    // no Blob fallback). A reused local dev server must also be started with
    // PAYMENTS_FAKE=1 STORAGE_PROVIDER=local.
    // SMS_PROVIDER=log sends no real texts but still writes sms_messages.
    // Spread process.env so loadEnvConfig values and BOOKING_SESSION_SECRET
    // keep reaching the dev server.
    env: {
      ...(process.env as Record<string, string>),
      PAYMENTS_FAKE: "1",
      STORAGE_PROVIDER: "local",
      SMS_PROVIDER: "log",
      TWILIO_PRIMARY_CUSTOMER_PROFILE_SID: "BU_E2E_PRIMARY_PROFILE",
      VERCEL_TEAM_ID: "team_e2e",
    },
  },
});
