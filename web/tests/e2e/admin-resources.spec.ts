import { test, expect } from "@playwright/test";

/**
 * Settings -> Rooms and equipment: add four chairs in one go, see them numbered,
 * turn one off, and see it listed as off. The seed re-creates the tenant on every
 * run, so the test starts with nothing added.
 */
test.describe("admin rooms and equipment", () => {
  test("add four chairs at once, then turn one off", async ({ page }) => {
    await page.goto("/settings/resources");
    await expect(page.getByRole("heading", { name: "Rooms and equipment" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Nothing added yet.")).toBeVisible();

    await page.getByLabel("Name").fill("Pedicure chair");
    await page.getByLabel("Type").click();
    await page.getByRole("option", { name: "Chair" }).click();
    await page.getByLabel("How many of these").fill("4");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const rows = page.getByTestId("resource-row");
    await expect(rows).toHaveCount(4, { timeout: 10000 });
    for (const n of [1, 2, 3, 4]) {
      await expect(rows.nth(n - 1)).toContainText(`Pedicure chair ${n}`);
    }
    await expect(rows.first()).toContainText("1 at once");
    await expect(rows.first()).toContainText("On");

    await rows.nth(3).getByRole("button", { name: "Turn off" }).click();
    await expect(rows.nth(3)).toContainText("Off", { timeout: 10000 });
    await expect(rows.nth(3).getByRole("button", { name: "Turn on" })).toBeVisible();
  });

  test("a service can list what it needs, and the need survives a reload", async ({ page }) => {
    // Something to need.
    await page.goto("/settings/resources");
    await page.getByLabel("Name").fill("Color bar");
    await page.getByLabel("Type").click();
    await page.getByRole("option", { name: "Station" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("resource-row").filter({ hasText: "Color bar" })).toHaveCount(1, {
      timeout: 10000,
    });

    await page.goto("/services");
    await page.getByRole("button", { name: "Edit Color" }).click();
    const needs = page.getByTestId("service-needs");
    await expect(needs).toBeVisible({ timeout: 15000 });
    await needs.getByRole("button", { name: "Add a need" }).click();
    await expect(needs.getByTestId("need-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Update Service" }).click();
    await expect(page.getByText("Service updated")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.getByRole("button", { name: "Edit Color" }).click();
    await expect(page.getByTestId("service-needs").getByTestId("need-row")).toHaveCount(1, {
      timeout: 15000,
    });

    // Put the seeded service back the way it was.
    await page.getByTestId("service-needs").getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Update Service" }).click();
    await expect(page.getByText("Service updated")).toBeVisible({ timeout: 10000 });
    await page.reload();
    await page.getByRole("button", { name: "Edit Color" }).click();
    await expect(page.getByTestId("service-needs").getByTestId("need-row")).toHaveCount(0, {
      timeout: 15000,
    });
  });
});
