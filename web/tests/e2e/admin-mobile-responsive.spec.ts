import { test, expect } from "@playwright/test";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";

/**
 * Mobile viewport smoke: targeted admin routes from the responsive performance plan.
 * Uses the same auth session as other admin tests (setup project).
 * Note: /settings/billing is owner-only; we use /settings/general instead for a
 * representative settings subpage without role gating edge cases.
 */
test.describe("admin mobile responsive smoke", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await mockStripe(page);
    await mockCalendarApi(page);
  });

  async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "document should not scroll horizontally").toBe(false);
  }

  test("settings hub", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible({
      timeout: 15000,
    });
    await assertNoHorizontalOverflow(page);
  });

  test("general settings subpage", async ({ page }) => {
    await page.goto("/settings/general");
    await expect(
      page.getByRole("heading", { name: /general settings/i }),
    ).toBeVisible({ timeout: 15000 });
    await assertNoHorizontalOverflow(page);
  });

  test("clients", async ({ page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /^clients$/i })).toBeVisible({
      timeout: 15000,
    });
    await assertNoHorizontalOverflow(page);
  });

  test("schedule", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
    await assertNoHorizontalOverflow(page);
  });
});
