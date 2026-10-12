import { test, expect as baseExpect } from "@playwright/test";

/**
 * Claim a seeded waitlist hold with no cookies, then add a desk entry.
 * Named admin-slot-waitlist so it runs in the signed-in admin project.
 * The plan's slot-waitlist.spec.ts matches no Playwright project.
 */
const TOKEN = "e2eClaimToken0000000000000000001";

test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 15_000 });

test("a held time can be booked, and the desk can add someone", async ({ page, browser }) => {
  const customerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const customer = await customerContext.newPage();
    await customer.goto(`/book/test-salon/claim/${TOKEN}`);
    await expect(customer.getByRole("heading", { name: "A time opened up" })).toBeVisible();
    await expect(customer.getByText(/at 2:00 PM/)).toBeVisible();
    await customer.getByRole("button", { name: "Book this time" }).click();
    await expect(customer.getByRole("heading", { name: "You're booked!" })).toBeVisible();
  } finally {
    await customerContext.close();
  }

  await page.goto("/slot-waitlist");
  await expect(page.getByRole("heading", { name: "Waitlist", level: 1 })).toBeVisible();
  await expect(page.getByText("Booked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add to waitlist" }).click();
  await page.getByRole("button", { name: "Search clients..." }).click();
  await page.getByPlaceholder("Search by name, email, or phone...").fill("E2E Test Client");
  await page.getByRole("option", { name: /E2E Test Client/ }).click();
  await page.getByRole("checkbox", { name: "Haircut" }).check();
  await page.getByRole("checkbox", { name: /agreed to get texts/ }).check();
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByText("Waiting", { exact: true })).toBeVisible();
});
