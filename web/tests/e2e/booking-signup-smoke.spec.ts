import { test, expect } from "@playwright/test";

/**
 * Signup page smoke test.
 *
 * Verifies the signup page renders correctly without requiring
 * authentication or a running database. Does NOT submit the form
 * to avoid external service dependencies.
 *
 * Runs in the "booking" project (no auth needed).
 */

test.describe("Signup page", () => {
  test("renders signup form with all required fields", async ({ page }) => {
    await page.goto("/signup");

    // Brand: the header shows the Uptempo mark image (alt "Uptempo") plus the
    // "Uptempo" wordmark heading (signup/page.tsx, since 0d5ffbe).
    await expect(page.getByRole("img", { name: "Uptempo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Uptempo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What kind of business is this?" })).toBeVisible();

    await page.getByRole("button", { name: "Hair salon" }).click();
    await expect(page.getByRole("button", { name: /create your salon account/i })).toBeVisible();

    // Verify form fields are present
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByLabel("Salon name")).toBeVisible();
    await expect(page.getByLabel("Timezone")).toBeVisible();

    // Verify submit button
    await expect(page.getByRole("button", { name: /create your salon account/i })).toBeVisible();
  });

  test("has sign-in link pointing to /login", async ({ page }) => {
    await page.goto("/signup");

    const signInLink = page.getByRole("link", { name: /sign in/i });
    await expect(signInLink).toBeVisible();
    await expect(signInLink).toHaveAttribute("href", "/login");
  });

  test("accepts input in the account fields", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Hair salon" }).click();

    // The booking-URL slug + availability preview moved to the onboarding
    // wizard, so this just confirms the account form is usable (no DB or
    // route-mock dependency).
    await page.getByLabel("Your name").fill("Jane Smith");
    await page.getByLabel("Email").fill("jane@example.com");

    await expect(page.getByLabel("Your name")).toHaveValue("Jane Smith");
    await expect(page.getByLabel("Email")).toHaveValue("jane@example.com");
  });
});
