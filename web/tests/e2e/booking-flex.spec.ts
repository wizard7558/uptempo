import { test, expect } from "@playwright/test";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import { bookingSessionCookie } from "./fixtures/auth";
import { passLocationStep } from "./helpers/booking-location-step";

const TEST_TENANT_SLUG = "test-salon";
const TENANT_BASE_URL = `http://${TEST_TENANT_SLUG}.localhost:3000`;
const TEST_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000001";
const TEST_CLIENT_NAME = "E2E Test Client";

async function setupBookingMocks(
  page: import("@playwright/test").Page,
  options: { isReturning?: boolean } = {},
) {
  await mockStripe(page);
  await mockCalendarApi(page);

  await page.route("**/api/booking/send-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, type: "email" }),
    }),
  );

  await page.route("**/api/booking/verify-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        clientId: TEST_CLIENT_ID,
        name: TEST_CLIENT_NAME,
        isReturning: options.isReturning ?? false,
      }),
    }),
  );
}

test.describe("booking flex (double-book) slot", () => {
  test.setTimeout(120_000);

  test("books a processing-gap flex slot with host linkage", async ({
    page,
  }) => {
    await setupBookingMocks(page, { isReturning: true });

    await page.goto(`${TENANT_BASE_URL}/book/${TEST_TENANT_SLUG}`);

    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible({
      timeout: 15000,
    });

    // 30-minute service so it fits the 30-minute processing gap from seed data
    await page.locator("label").filter({ hasText: "Haircut" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await passLocationStep(page);

    await expect(page.getByText("Select date & time")).toBeVisible({
      timeout: 15000,
    });

    // Date strip must load (server action + render). Do not rely on
    // enumerateFlexHostSeedDays matching seed-time "now" — scan whatever dates
    // the UI shows after a fresh seed.
    await expect(page.locator("[data-booking-date]").first()).toBeVisible({
      timeout: 15000,
    });

    let pickedFlex = false;

    for (let month = 0; month < 2 && !pickedFlex; month++) {
      const dateCount = await page.locator("[data-booking-date]").count();
      for (let i = 0; i < dateCount; i++) {
        await page.locator("[data-booking-date]").nth(i).click();
        await expect(page.locator("[data-slot-double-book]").first()).toBeVisible({
          timeout: 15000,
        });
        const flexSlot = page.locator('[data-slot-double-book="true"]');
        if ((await flexSlot.count()) === 0) continue;
        await flexSlot.first().click();
        pickedFlex = true;
        break;
      }
      if (pickedFlex) break;
      const nextMonth = page.getByRole("button", { name: "Go to the Next Month" });
      if (!(await nextMonth.isEnabled())) break;
      await nextMonth.click();
    }

    expect(
      pickedFlex,
      "Expected a flex slot on at least one available day — run scripts/seed-e2e-data.ts before this test",
    ).toBe(true);

    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Name").fill(TEST_CLIENT_NAME);
    await page.getByLabel("Phone").fill("+15555550199");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("Confirm your booking")).toBeVisible({
      timeout: 15000,
    });
    await page.context().addCookies([
      bookingSessionCookie(TEST_CLIENT_ID, `${TEST_TENANT_SLUG}.localhost`),
    ]);
    await page.getByRole("button", { name: "Confirm booking" }).click();

    const successText = page.getByText("You're booked!");
    const paymentStep = page.getByRole("heading", {
      name: "Save card on file",
    });

    await expect(successText.or(paymentStep)).toBeVisible({
      timeout: 30000,
    });
  });
});
