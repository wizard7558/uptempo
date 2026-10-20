import { test, expect } from "@playwright/test";

/**
 * Settings -> Billing: the hosted plan card. The seeded test-salon is not
 * comped and has no platform Stripe customer, so the card shows the card
 * processing rate and no "Manage billing" button. The rate itself is not
 * hard-coded because dev and seed tenants can carry a backfilled rate.
 */
test.describe("hosted plan card", () => {
  test("shows the plan and card processing line, with no Manage billing", async ({ page }) => {
    await page.goto("/settings/billing");
    await expect(page.getByText("Your plan")).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/^Card processing: .+ of card payments$/),
    ).toBeVisible();
    await expect(page.getByText("Uptempo is free for your business.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
  });
});
