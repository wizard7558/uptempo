import { expect, test } from "@playwright/test";
import { industrySlug, marketingIndustries } from "../../src/lib/marketing/industries";

const PAGES = [
  "/",
  "/pricing",
  "/open-source",
  ...marketingIndustries().map((industry) => `/for/${industrySlug(industry.id)}`),
];

for (const path of PAGES) {
  test(`${path} renders with one h1`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
  });
}

test("an unknown industry is a 404", async ({ page }) => {
  const response = await page.goto("/for/not-an-industry");
  expect(response?.status()).toBe(404);
});

test("the homepage demo switches industry and continues to signup", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.locator('a[href="/signup"]')).toBeVisible();
  await expect(footer.locator('a[href="/waitlist"]')).toHaveCount(0);

  const switcher = page.getByRole("group", { name: "Show a sample booking page for" });
  const nails = switcher.getByRole("button", { name: "Nail salon" });
  // A click before hydration does nothing, so retry until the switch takes.
  await expect(async () => {
    await nails.click();
    await expect(nails).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();
  await expect(page.getByRole("heading", { name: "Book a pedicure" })).toBeVisible();

  const demo = page.locator("section").filter({ has: switcher });
  await demo.getByRole("button", { name: /^\d{1,2}:\d{2}\s?(AM|PM)$/ }).first().click();
  await demo.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/signup\?industry=nail_salon$/);
});

test("the legacy waitlist URL redirects to the signup form", async ({ page }) => {
  await page.goto("/waitlist?src=expo-2026");

  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "What kind of business is this?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nail salon" })).toBeVisible();
});
