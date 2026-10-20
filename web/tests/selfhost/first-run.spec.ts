import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * First-run smoke for a fresh single-mode install: setup, onboarding, public
 * booking availability, closed signup, health, and local logo storage.
 * The serial steps share one browser context and database.
 */

const BUSINESS = "Smoke Test Studio";
const SLUG = "smoke-test-studio";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("self-host first run", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      baseURL: process.env.SELFHOST_URL ?? "http://localhost:3000",
    });
    page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(90_000);
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
    await page.getByRole("radio", { name: "Barbershop" }).check();
    await page.getByRole("button", { name: "Create business account" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 60_000 });
  });

  test("3. onboarding launches a bookable business", async () => {
    await page.getByLabel("Phone").fill("555-0100");
    await page.getByLabel("Address").fill("1 Main Street");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Review your shop" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hours" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // No Stripe key is configured in this disposable self-host stack.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const bookingLink = page.getByTestId("booking-link");
    await expect(bookingLink).toBeVisible({ timeout: 30_000 });
    await expect(bookingLink).toHaveAttribute("href", `/book/${SLUG}`);
  });

  test("4. root redirects to the public booking page after setup", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/book/${SLUG}$`));
  });

  test("5. a service has an available booking time", async () => {
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    const firstDate = page.locator("[data-booking-date]").first();
    await expect(firstDate).toBeVisible({ timeout: 30_000 });
    await firstDate.click();
    await expect(page.locator("[data-slot-double-book]").first()).toBeVisible({ timeout: 30_000 });
  });

  test("6. /signup is closed in single mode", async () => {
    const signup = await context.request.get("/signup", { maxRedirects: 0 });
    expect([307, 308]).toContain(signup.status());
    expect(new URL(signup.headers()["location"], "http://x").pathname).toBe("/");

    await page.goto("/signup");
    await expect(page).toHaveURL(new RegExp(`/book/${SLUG}$`));
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /create .*account/i })).toHaveCount(0);
  });

  test("7. health reports a working single-mode install", async () => {
    const response = await context.request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("single");
  });

  test("8. a branding logo is served from local file storage", async () => {
    await page.goto("/settings/branding");
    await expect(page.getByText("Drop your logo here or click to browse")).toBeVisible({ timeout: 30_000 });
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
