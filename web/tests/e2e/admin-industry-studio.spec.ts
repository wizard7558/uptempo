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

  test("staff service creation uses tattoo and tenant-defined categories", async ({
    page,
  }, testInfo) => {
    const categoryName = `Studio custom ${Date.now()}`;
    const serviceName = `Studio service ${Date.now()}`;

    await page.goto("/services");
    await page.getByRole("button", { name: "Add Service" }).click();
    await page.getByLabel("Category").click();
    await page.getByRole("option", { name: "+ New category…" }).click();
    await page.getByPlaceholder("e.g., Maintenance").fill(categoryName);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator("#service-category")).toContainText(categoryName);

    await page.goto(
      "/settings/staff/f0e2e200-0000-4000-8000-0000000000a1/services",
    );
    await expect(page.getByText("Small tattoo", { exact: true })).toBeVisible();
    await expect(page.getByText("Cut", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Add custom service" }).click();
    await page.getByLabel("Service name").fill(serviceName);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: categoryName }).click();
    await page.getByRole("button", { name: "Create service" }).click();

    const serviceRow = page.getByRole("button", { name: new RegExp(serviceName) });
    await expect(serviceRow).toContainText(categoryName);
    await serviceRow.click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(serviceRow).toContainText(categoryName);
    if (process.env.INDUSTRY_CATALOG_CAPTURE === "1") {
      await page.screenshot({
        path: testInfo.outputPath("staff-service-category.png"),
        fullPage: true,
      });
    }
  });

  test("hair service categories still expose the legacy defaults", async ({
    context,
    page,
  }) => {
    const { signedCookieValue } = await seedTestSession();
    await context.addCookies([sessionCookie(signedCookieValue)]);
    await page.goto("/services");
    await page.getByRole("button", { name: "Add Service" }).click();
    await page.getByLabel("Category").click();

    await expect(page.getByRole("option", { name: "Cut", exact: true })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Color", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Extensions", exact: true }),
    ).toBeVisible();
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
