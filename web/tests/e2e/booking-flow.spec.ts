import { test, expect } from "@playwright/test";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import { bookingSessionCookie } from "./fixtures/auth";
import { passLocationStep } from "./helpers/booking-location-step";

/**
 * Client booking flow E2E tests.
 *
 * These tests exercise the full booking wizard using tenant-aware subdomain
 * routing. The middleware extracts the tenant slug from the subdomain
 * (e.g., test-salon.localhost:3000) and sets the x-tenant-slug header.
 *
 * For local development: add `127.0.0.1 test-salon.localhost` to /etc/hosts
 * if your OS does not resolve *.localhost automatically (macOS does).
 *
 * For CI: the GitHub Actions workflow adds the hosts entry automatically.
 *
 * Database dependency: Tests require the database to have a tenant with slug
 * "test-salon" provisioned, with at least one active stylist, assigned
 * services, and working hours configured.
 *
 * OTP bypass: send-code and verify-code endpoints are mocked via page.route()
 * to bypass real OTP delivery.
 *
 * External services: Stripe and calendar routes are fully mocked via page.route().
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The tenant slug used for E2E tests. The test database must have this tenant
 * provisioned with test data. In local dev, the booking page is accessed via
 * `test-salon.localhost:3000/book/test-salon`.
 */
const TEST_TENANT_SLUG = "test-salon";
const PORT = process.env.E2E_PORT ?? "3000";

/**
 * Base URL for the test tenant subdomain.
 * The booking page route is /book/{slug} and also requires the subdomain
 * for the middleware to set x-tenant-slug.
 */
const TENANT_BASE_URL = `http://${TEST_TENANT_SLUG}.localhost:${PORT}`;

// Test client returned by the mocked verify-code endpoint.
const TEST_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000001";
const TEST_CLIENT_NAME = "E2E Test Client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply all external service mocks and OTP mocks to the page.
 */
async function setupMocks(
  page: import("@playwright/test").Page,
  options: { isReturning?: boolean } = {},
) {
  await mockStripe(page);
  await mockCalendarApi(page);

  // Mock OTP send-code -- always succeeds
  await page.route("**/api/booking/send-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, type: "email" }),
    }),
  );

  // Mock OTP verify-code -- always returns our test client
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function signInForConfirm(page: import("@playwright/test").Page) {
  await page.context().addCookies([
    bookingSessionCookie(TEST_CLIENT_ID, `${TEST_TENANT_SLUG}.localhost`),
  ]);
}

async function pickServiceAndTime(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible({
    timeout: 15000,
  });
  const serviceCheckboxes = page.getByRole("checkbox");
  await expect(serviceCheckboxes.first()).toBeVisible({ timeout: 10000 });
  await serviceCheckboxes.first().check();
  await page.getByRole("button", { name: "Continue" }).click();

  await passLocationStep(page);
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await expect(page.locator("[data-booking-date]").first()).toBeVisible({ timeout: 15000 });
  await page.locator("[data-booking-date]").first().click();
  const timeSlot = page.locator("[data-slot-double-book]").first();
  await expect(timeSlot).toBeVisible({ timeout: 15000 });
  await timeSlot.click();
  await page.getByRole("button", { name: "Continue" }).click();
}

test.describe("booking flow", () => {
  test("a new client books end to end", async ({ page }) => {
    await setupMocks(page, { isReturning: true });
    await page.goto(`${TENANT_BASE_URL}/book/${TEST_TENANT_SLUG}`);
    await pickServiceAndTime(page);

    await expect(page.getByLabel("Name")).toBeVisible({ timeout: 10000 });
    await page.getByLabel("Name").fill("E2E Test Client");
    await page.getByLabel("Phone").fill("+15555550199");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("Verification code")).toBeVisible({ timeout: 10000 });
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByRole("heading", { name: "Confirm your booking" })).toBeVisible({
      timeout: 10000,
    });
    await signInForConfirm(page);
    await page.getByRole("button", { name: "Confirm booking" }).click();

    const successText = page.getByText("You're booked!");
    const paymentStep = page.getByRole("heading", { name: "Save card on file" });
    await expect(successText.or(paymentStep)).toBeVisible({ timeout: 30000 });
    if (await successText.isVisible()) {
      await expect(page.getByRole("button", { name: "Book Another Appointment" })).toBeVisible();
    }
  });

  test("a returning client with a session skips code entry", async ({ page }) => {
    await setupMocks(page, { isReturning: true });
    await signInForConfirm(page);
    await page.goto(`${TENANT_BASE_URL}/book/${TEST_TENANT_SLUG}`);
    await pickServiceAndTime(page);

    await expect(page.getByText(TEST_CLIENT_NAME)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Not you?" })).toBeVisible();
    await expect(page.getByLabel("Verification code")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Confirm your booking" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("an unknown slug returns 404", async ({ page }) => {
    await setupMocks(page);
    const response = await page.goto(`${TENANT_BASE_URL}/book/nonexistent-salon-12345`);
    expect(response?.status()).toBe(404);
  });

  test("Any available books a slot", async ({ page }) => {
    await setupMocks(page, { isReturning: true });
    await page.goto(`${TENANT_BASE_URL}/book/${TEST_TENANT_SLUG}`);
    await expect(page.getByRole("button", { name: "Anyone available" })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Anyone available" }).click();
    await pickServiceAndTime(page);

    await page.getByLabel("Name").fill("E2E Test Client");
    await page.getByLabel("Phone").fill("+15555550199");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("heading", { name: "Confirm your booking" })).toBeVisible({
      timeout: 10000,
    });
    await signInForConfirm(page);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(
      page.getByText("You're booked!").or(page.getByRole("heading", { name: "Save card on file" })),
    ).toBeVisible({ timeout: 30000 });
  });
});
