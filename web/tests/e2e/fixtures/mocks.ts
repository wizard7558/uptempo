import type { Page } from "@playwright/test";

/**
 * Shared mock fixtures for Emme Scheduler E2E tests.
 *
 * These helpers intercept external service calls via Playwright's page.route()
 * so that tests never hit real Stripe, calendar APIs, or email APIs.
 */

// ---------------------------------------------------------------------------
// Stripe mocks
// ---------------------------------------------------------------------------

/**
 * Mock all Stripe-related endpoints and scripts.
 * Prevents any real Stripe API calls or Stripe.js loading.
 */
export async function mockStripe(page: Page): Promise<void> {
  // Mock SetupIntent creation API
  await page.route("**/api/stripe/setup-intent", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        clientSecret: "seti_mock_secret_mock_secret",
      }),
    }),
  );

  // Block Stripe.js SDK from loading (prevents real Stripe calls)
  await page.route("**/js.stripe.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "// Stripe.js mocked for E2E tests",
    }),
  );

  // Mock Stripe webhook endpoint
  await page.route("**/api/stripe/webhook", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ received: true }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Calendar API mocks
// ---------------------------------------------------------------------------

/**
 * Mock calendar sync / OAuth routes so E2E never calls the Google Calendar API.
 */
export async function mockCalendarApi(page: Page): Promise<void> {
  await page.route("**/api/calendar/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Email / OTP mocks
// ---------------------------------------------------------------------------

/**
 * Mock the OTP send-code and verify-code endpoints for E2E booking flow.
 *
 * - send-code: Returns success without actually sending an email/SMS
 * - verify-code: Accepts any 6-digit code and returns a test client
 *
 * This allows the booking flow to proceed without real email delivery
 * or database OTP verification.
 */
export async function mockOtp(
  page: Page,
  options: {
    clientId?: string;
    clientName?: string;
    isReturning?: boolean;
  } = {},
): Promise<void> {
  const {
    clientId = "test-client-00000000-0000-0000-0000-000000000001",
    clientName = "Test Client",
    isReturning = false,
  } = options;

  // Mock send-code -- always succeeds
  await page.route("**/api/booking/send-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, type: "email" }),
    }),
  );

  // Mock verify-code -- always succeeds with test client
  await page.route("**/api/booking/verify-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        clientId,
        name: clientName,
        isReturning,
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Convenience: apply all mocks at once
// ---------------------------------------------------------------------------

/**
 * Apply all external service mocks to the page.
 * Use this at the start of most E2E tests.
 */
export async function mockAllExternalServices(
  page: Page,
  otpOptions?: Parameters<typeof mockOtp>[1],
): Promise<void> {
  await mockStripe(page);
  await mockCalendarApi(page);
  await mockOtp(page, otpOptions);
}
