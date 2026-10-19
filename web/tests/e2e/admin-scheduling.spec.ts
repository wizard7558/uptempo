import { test, expect } from "@playwright/test";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";

/**
 * Admin scheduling and settings E2E tests.
 *
 * Auth: The "admin" Playwright project depends on the "setup" project which
 * seeds a real database session and saves storageState. Every test in this
 * file runs with the session cookie already set -- no mocking of
 * auth endpoints is needed.
 *
 * Database dependency: Tests require the dev database with at least
 * one admin user, one salon, stylists, and working hours.
 */

// ---------------------------------------------------------------------------
// Tests -- Schedule
// ---------------------------------------------------------------------------

test.describe("admin scheduling", () => {
  test.beforeEach(async ({ page }) => {
    await mockStripe(page);
    await mockCalendarApi(page);
  });

  test("schedule page loads with day view", async ({ page }) => {
    await page.goto("/schedule");

    // The schedule page should load and show the main schedule grid
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Verify we are on the schedule page (not redirected to login)
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("schedule page date navigation", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Look for the Today button -- this is always present on the schedule page
    const todayButton = page.getByRole("button", { name: /today/i });
    await expect(todayButton).toBeVisible({ timeout: 10000 });

    // Look for a next/forward navigation button
    const nextButton = page.locator(
      'button:has([data-testid="chevron-right"]), button:has(svg.lucide-chevron-right), [aria-label="Next day"], [aria-label="Next"]',
    );

    // If a next button exists, click it and verify navigation
    if ((await nextButton.count()) > 0) {
      await nextButton.first().click();
      // After clicking next, the Today button should still be visible
      await expect(todayButton).toBeVisible();

      // Click Today to return
      await todayButton.click();
      await expect(todayButton).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests -- Settings
// ---------------------------------------------------------------------------

test.describe("admin settings", () => {
  test.beforeEach(async ({ page }) => {
    await mockStripe(page);
    await mockCalendarApi(page);
  });

  test("settings hub shows all cards", async ({ page }) => {
    await page.goto("/settings");

    // Verify we are on settings (not redirected to login)
    await expect(page).not.toHaveURL(/\/login/);

    // Wait for the settings page to load
    const settingsHeading = page.getByText("Settings");
    await expect(settingsHeading.first()).toBeVisible({ timeout: 15000 });

    // Verify all 6 settings cards are visible
    const settingCards = [
      "General",
      "Working Hours",
      "Stylists",
      "Policies",
      "Calendar Connections",
      "Notifications",
    ];

    for (const card of settingCards) {
      await expect(page.getByText(card, { exact: false }).first()).toBeVisible();
    }
  });

  test("legacy /settings/stylists redirects to /settings/staff", async ({ page }) => {
    await page.goto("/settings/stylists");
    await expect(page).toHaveURL(/\/settings\/staff$/);
  });

  test("settings sub-pages load without error", async ({ page }) => {
    const settingsPages = [
      "/settings/general",
      "/settings/hours",
      "/settings/staff",
      "/settings/policies",
      "/settings/calendars",
      "/settings/notifications",
    ];

    for (const path of settingsPages) {
      await page.goto(path);

      // Each page should load without error (no Next.js error overlay)
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 15000 });

      // Verify no Next.js error overlay is present. The <nextjs-portal> host
      // itself always exists in dev (it hosts the dev indicator), so look for
      // the error dialog inside its shadow root.
      const errorOverlay = page.locator(
        "nextjs-portal [data-nextjs-dialog-overlay]",
      );
      await expect(errorOverlay).toHaveCount(0);

      // Verify we are not redirected to login
      await expect(page).not.toHaveURL(/\/login/);
    }
  });

  test("notification settings toggles work", async ({ page }) => {
    await page.goto("/settings/notifications");

    // Verify the notification settings page loaded
    const notifHeading = page.getByText("Notification Settings");
    await expect(notifHeading.first()).toBeVisible({ timeout: 15000 });

    // Verify toggle switches are present (the form uses switch/checkbox components)
    const switches = page.getByRole("switch");
    await expect(switches.first()).toBeVisible({ timeout: 10000 });

    // Click a toggle and verify it responds
    const firstSwitch = switches.first();
    const initialState = await firstSwitch.getAttribute("aria-checked");
    await firstSwitch.click();
    const newState = await firstSwitch.getAttribute("aria-checked");

    // Toggle state should have changed
    expect(newState).not.toBe(initialState);
  });
});

// ---------------------------------------------------------------------------
// Tests -- Console errors
// ---------------------------------------------------------------------------

test.describe("admin schedule operations", () => {
  test("schedule page renders without JavaScript errors", async ({
    page,
  }, testInfo) => {
    await mockStripe(page);
    await mockCalendarApi(page);

    // Collect console errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/schedule");

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible({ timeout: 15000 });

    // Wait a moment for any async errors
    await page.waitForTimeout(2000);

    // Filter out expected console errors (Stripe mocking side effects)
    const unexpectedErrors = consoleErrors.filter(
      (err) =>
        !err.includes("Stripe") &&
        !err.includes("Failed to load resource") &&
        !err.includes("net::ERR"),
    );

    if (consoleErrors.length > 0) {
      await testInfo.attach("console-errors", {
        body: JSON.stringify(consoleErrors, null, 2),
        contentType: "application/json",
      });
    }

    // No unexpected errors should be present
    expect(unexpectedErrors).toHaveLength(0);
  });
});
