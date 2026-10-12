import { test, expect } from "@playwright/test";

/**
 * Settings -> Working Hours: split shifts and days off / special hours.
 * Sunday is closed in the seed. The test opens it with two shifts, saves,
 * reloads, then closes it again so the seed state is restored.
 */
test.describe("admin working hours", () => {
  test("add a second shift on Sunday, save, reload, then restore", async ({ page }) => {
    await page.goto("/settings/hours");
    const sunday = page.getByTestId("hours-day-0");
    await expect(sunday).toBeVisible({ timeout: 15000 });

    await sunday.getByRole("switch", { name: "Open on Sunday" }).click();
    await expect(sunday.getByTestId("shift-row")).toHaveCount(1);
    await sunday.getByRole("button", { name: "Add another shift" }).click();
    await expect(sunday.getByTestId("shift-row")).toHaveCount(2);

    await page.getByRole("button", { name: "Save Working Hours" }).click();
    await expect(page.getByText("Working hours saved")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page.getByTestId("hours-day-0").getByTestId("shift-row")).toHaveCount(2, {
      timeout: 15000,
    });

    // Restore: Sunday closed again.
    await page.getByTestId("hours-day-0").getByRole("switch", { name: "Open on Sunday" }).click();
    await page.getByRole("button", { name: "Save Working Hours" }).click();
    await expect(page.getByText("Working hours saved")).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page.getByTestId("hours-day-0").getByRole("switch")).not.toBeChecked({
      timeout: 15000,
    });
  });

  test("add a closed day, see it in the list, remove it", async ({ page }) => {
    await page.goto("/settings/hours");
    await expect(page.getByText("Days off and special hours")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Add a day off or special hours" }).click();
    const calendar = page.getByTestId("override-calendar");
    await expect(calendar).toBeVisible();
    await page.getByRole("button", { name: "Go to the Next Month" }).click();
    await calendar.locator("button", { hasText: /^15$/ }).click();
    await page.getByLabel("Note (optional)").fill("Vacation");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const rows = page.getByTestId("override-row");
    await expect(rows).toHaveCount(1, { timeout: 10000 });
    await expect(rows.first()).toContainText("Closed");
    await expect(rows.first()).toContainText("Vacation");

    await rows.first().getByRole("button", { name: "Remove" }).click();
    await expect(rows).toHaveCount(0, { timeout: 10000 });
  });
});
