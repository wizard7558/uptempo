import { test, expect } from "@playwright/test";

/**
 * In-person sale, a balance adjustment, and the public balance page.
 * The seeded salon has no Stripe Connect account, so the public buy page
 * says gift cards are not available.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test("sell, adjust, and check a gift card balance", async ({ page, browser }) => {
  await page.goto("/gift-cards");
  await page.getByRole("button", { name: "Sell a gift card" }).click();
  await page.getByLabel("Other amount").fill("50");
  await page.getByRole("radio", { name: "Paid at the front desk" }).check();
  await page.getByRole("button", { name: "Create gift card" }).click();

  const code = (await page.getByTestId("gift-card-code").innerText()).trim();
  const last4 = code.replace(/[\s-]/g, "").slice(-4);
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByRole("cell", { name: `Ending in ${last4}` })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$50.00" })).toBeVisible();

  await page.getByRole("button", { name: "Adjust balance" }).click();
  await page.getByLabel("Amount to add or remove").fill("-10.00");
  await page.getByLabel("Reason (required)").fill("Test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "$40.00" })).toBeVisible();

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto("/gift/test-salon/balance");
  await guestPage.getByLabel("Gift card code").fill(code);
  await guestPage.getByRole("button", { name: "Check balance" }).click();
  await expect(guestPage.getByText("Balance: $40.00")).toBeVisible();
  await guest.close();

  await page.goto("/gift/test-salon");
  await expect(page.getByText("Gift cards aren't available right now.")).toBeVisible();
});
