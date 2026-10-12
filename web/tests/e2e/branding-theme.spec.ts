import { test, expect, type Page } from "@playwright/test";
import { contrastRatio } from "../../src/lib/utils/contrast";

test.use({ colorScheme: "light" });

async function restoreDefaults(page: Page) {
  await page.goto("/settings/branding");
  await page.getByRole("textbox", { name: "Your color" }).fill("#B3122E");
  await page
    .getByRole("radiogroup", { name: "Page background" })
    .getByRole("radio", { name: "Light" })
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Branding saved")).toBeVisible({ timeout: 10000 });
}

test("owner previews a readable accent and a dark booking page", async ({ page }) => {
  try {
    await page.goto("/settings/branding");
    await expect(page.getByRole("heading", { name: "Appointment page" })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("textbox", { name: "Your color" }).fill("#FFFF00");
    await expect(page.getByText("We darkened your color so text stays readable.")).toBeVisible();

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Branding saved")).toBeVisible({ timeout: 10000 });

    await page.goto("/book/test-salon");
    const shell = page.locator("[data-theme-scope=booking]");
    await expect(shell).toBeVisible({ timeout: 15000 });
    const accent = await shell.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--accent").trim(),
    );
    expect(contrastRatio(accent, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);

    await page.goto("/settings/branding");
    await page
      .getByRole("radiogroup", { name: "Page background" })
      .getByRole("radio", { name: "Dark" })
      .click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Branding saved")).toBeVisible({ timeout: 10000 });

    await page.goto("/book/test-salon");
    const darkShell = page.locator("[data-theme-scope=booking]");
    await expect(darkShell).toBeVisible({ timeout: 15000 });
    await expect(darkShell).toHaveClass(/dark/);
    const background = await darkShell.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe("rgb(14, 14, 14)");
  } finally {
    await restoreDefaults(page);
  }
});
