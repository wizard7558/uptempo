import { test, expect } from "@playwright/test";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import {
  STUDIO_TEST_USER,
  seedTestSession,
  sessionCookie,
} from "./fixtures/auth";

/**
 * Non-salon tenant: the seeded `test-studio` tattoo tenant. Its pack leaves
 * assistant tasks off and aftercare on, so module gating is visible end to end.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("tattoo studio tenant", () => {
  test.beforeEach(async ({ context, page }) => {
    const { signedCookieValue } = await seedTestSession(STUDIO_TEST_USER);
    await context.addCookies([sessionCookie(signedCookieValue)]);
    await mockStripe(page);
    await mockCalendarApi(page);
  });

  test("assistants page sends owners to Features", async ({ page }) => {
    await page.goto("/settings/assistants");

    await expect(page).toHaveURL(/\/settings\/modules\?off=assistant_tasks/);
    await expect(
      page.getByText("This feature is off: Assistant tasks"),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: /Aftercare messages/ }),
    ).toBeChecked();
  });

  test("expenses page lists the tattoo categories", async ({ page }) => {
    await page.goto("/expenses");

    await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
    await expect(page.getByText("Ink").first()).toBeVisible();
    await expect(
      page.getByText("Needles and cartridges").first(),
    ).toBeVisible();
    await expect(page.getByText("Backbar")).toHaveCount(0);
    await expect(
      page.locator("nextjs-portal [data-nextjs-dialog-overlay]"),
    ).toHaveCount(0);
  });

  test("revenue page uses artist and session terms", async ({ page }) => {
    await page.goto("/revenue");

    await expect(page.getByRole("heading", { name: "Revenue" })).toBeVisible();
    await expect(
      page.getByText("Per-artist earnings from completed sessions."),
    ).toBeVisible();
    await expect(
      page.locator("nextjs-portal [data-nextjs-dialog-overlay]"),
    ).toHaveCount(0);
  });

  test("analytics page shows per-piece and per-artist tables", async ({
    page,
  }) => {
    await page.goto("/analytics/services");

    await expect(
      page.getByRole("heading", { name: "Service analytics" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "By piece", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "By artist", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("nextjs-portal [data-nextjs-dialog-overlay]"),
    ).toHaveCount(0);
  });
});
