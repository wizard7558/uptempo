import { test, expect } from "@playwright/test";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import { STUDIO_TEST_USER, seedTestSession, sessionCookie } from "./fixtures/auth";

const APPOINTMENT_ID = "e2e00000-0000-4000-8000-0000000057a1";
const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  storageState: { cookies: [], origins: [] },
});

test.describe("appointment work on a phone", () => {
  test.beforeEach(async ({ context, page }) => {
    const { signedCookieValue } = await seedTestSession(STUDIO_TEST_USER);
    await context.addCookies([sessionCookie(signedCookieValue)]);
    await mockStripe(page);
    await mockCalendarApi(page);
  });

  test("checks the studio checklist and adds before and after photos", async ({ page }) => {
    await page.goto(`/appointments/${APPOINTMENT_ID}`);

    await expect(page.getByRole("heading", { name: "E2E Studio Client" })).toBeVisible();
    await expect(page.getByText("0 of 3 done")).toBeVisible();

    for (const label of ["Clean station", "Stencil approved", "Aftercare explained"]) {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.ok() &&
            response.url().includes(`/appointments/${APPOINTMENT_ID}`),
        ),
        page.getByRole("checkbox", { name: label }).click(),
      ]);
    }

    await expect(page.getByText("3 of 3 done")).toBeVisible();
    await page.reload();
    await expect(page.getByText("3 of 3 done")).toBeVisible();

    await page.locator('input[type="file"]').nth(0).setInputFiles({
      name: "before.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_1x1_BASE64, "base64"),
    });
    await expect(page.getByText("Photo added")).toBeVisible();
    await expect(page.locator('img[alt^="Before"]')).toBeVisible();

    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "after.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_1x1_BASE64, "base64"),
    });
    await expect(page.locator('img[alt^="After"]')).toBeVisible();
  });
});
