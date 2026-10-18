import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * First-run smoke for a fresh single-mode (self-hosted) install: setup,
 * onboarding, public booking, the closed signup route, health, and a logo
 * upload through the local file store.
 *
 * The steps share one browser context (the owner session created in step 2)
 * and one database, so they run serially and a failure skips the rest.
 */

const BUSINESS = "Smoke Test Studio";
const SLUG = "smoke-test-studio";

// 1x1 transparent PNG, generated from base64 so no binary fixture is needed.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.serial("self-host first run", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("1. root redirects to /setup on a fresh install", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  });

  test("2. setup creates the business and owner", async () => {
    await page.getByLabel("Your name").fill("Sam Owner");
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("smoke-test-pass-1");
    await page.getByLabel("Business name").fill(BUSINESS);
    // The design calls this industry "Barber"; the setup form's radio is
    // labelled "Barbershop" (src/lib/verticals/barber.ts).
    await page.getByRole("radio", { name: "Barbershop" }).check();
    await page.getByRole("button", { name: "Create salon account" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 60_000 });
  });

  test("3. onboarding wizard completes and launches", async () => {
    // Business details. Setup already named the business; the wizard asks
    // for the contact details the booking page needs.
    await page.getByLabel("Phone").fill("555-0100");
    await page.getByLabel("Address").fill("1 Main Street");
    await page.getByRole("button", { name: "Continue" }).click();

    // Review. There is no separate template/hours/policies step: choosing the
    // Barbershop industry in setup seeds the first service pack, default
    // hours and default policies, and this step shows them for review.
    await expect(page.getByRole("heading", { name: "Review your shop" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hours" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Payments. A self-hosted install has no Stripe Connect "skip" button;
    // Stripe is configured through env vars (none here), so the step only
    // offers Continue, which records the payments step as skipped.
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByTestId("booking-link")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("booking-link")).toHaveAttribute("href", `/book/${SLUG}`);
  });

  test("4. root redirects to the booking page once set up", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/book/${SLUG}$`));
  });

  test("5. a service can be selected and time slots are offered", async () => {
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("button[data-slot-double-book]").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("6. /signup is closed in single mode", async () => {
    await page.goto("/signup");
    // /signup redirects to / which then redirects to the booking page.
    await expect(page).toHaveURL(new RegExp(`/book/${SLUG}$`));
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /create .*account/i })).toHaveCount(0);
  });

  test("7. /api/health reports ok in single mode", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("single");
  });

  test("8. branding logo upload is served from /api/files", async () => {
    await page.goto("/settings/branding");
    await expect(page.getByText("Drop your logo here or click to browse")).toBeVisible({
      timeout: 30_000,
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });

    const logo = page.locator('img[src*="/api/files/"]').first();
    await expect(logo).toBeVisible({ timeout: 30_000 });
    const src = await logo.getAttribute("src");
    expect(src).toBeTruthy();
    const response = await context.request.get(src!);
    expect(response.status()).toBe(200);
  });
});
