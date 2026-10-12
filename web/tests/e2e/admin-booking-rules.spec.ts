import { test, expect } from "@playwright/test";

/**
 * Booking Rules settings page. Toggles the same-day switch, saves, then
 * toggles back and saves so the seed state (same-day on) is restored.
 */
test.describe("admin booking rules", () => {
  test("toggle same-day booking, save, and restore", async ({ page }) => {
    await page.goto("/settings/booking");
    await expect(page.getByRole("heading", { name: "Booking rules" })).toBeVisible({
      timeout: 15000,
    });

    const sameDay = page.getByRole("switch", { name: /book for later today/i });
    await expect(sameDay).toBeChecked();

    await sameDay.click();
    await expect(sameDay).not.toBeChecked();
    await page.getByRole("button", { name: "Save booking rules" }).click();
    await expect(page.getByText("Booking rules saved")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page.getByRole("switch", { name: /book for later today/i })).not.toBeChecked();

    // Restore the seed state.
    await page.getByRole("switch", { name: /book for later today/i }).click();
    await page.getByRole("button", { name: "Save booking rules" }).click();
    await expect(page.getByText("Booking rules saved")).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page.getByRole("switch", { name: /book for later today/i })).toBeChecked();
  });
});
