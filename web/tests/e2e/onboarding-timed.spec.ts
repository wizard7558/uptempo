import { test, expect } from "@playwright/test";
import postgres from "postgres";

/**
 * A new owner picks a barbershop, accepts the pack defaults, skips payments,
 * publishes, and sees an open time on the public booking page.
 * The clock starts once the signup page is ready and fails above 5 minutes.
 */

test.setTimeout(320_000);

test("barber signup accepts defaults, publishes, and shows a time", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `owner-${stamp}@example.com`;
  const business = `North ${stamp} Barber`;
  let slug: string | null = null;
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);

  try {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "What kind of business is this?" })).toBeVisible();
    const started = Date.now();

    await page.getByRole("button", { name: "Barbershop" }).click();
    await page.getByLabel("Your name").fill("Riley North");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password1");
    await page.getByLabel("Shop name").fill(business);
    await page.getByRole("button", { name: "Create your shop account" }).click();

    await page.waitForURL("**/onboarding", { timeout: 60_000 });
    await page.getByLabel("Phone").fill("555-0100");
    await page.getByLabel("Address").fill("1 Main Street");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Review your shop" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: "Do this later" }).click();
    await page.getByRole("button", { name: "Yes, do this later" }).click();
    await page.getByRole("button", { name: "Got it, continue" }).click();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const link = page.getByTestId("booking-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute("href");
    const match = href?.match(/\/book\/([a-z][a-z0-9-]*)$/);
    slug = match?.[1] ?? null;
    expect(slug).toBeTruthy();

    await page.goto(`/book/${slug}`);
    await page.getByRole("checkbox", { name: /Haircut/ }).first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("[data-slot-double-book]").first()).toBeVisible({
      timeout: 30_000,
    });

    const elapsed = Date.now() - started;
    console.log(`onboarding elapsed ${Math.round(elapsed / 1000)}s`);
    expect(elapsed).toBeLessThanOrEqual(300_000);
  } finally {
    await dropScratch(email, slug);
  }
});

function isSlug(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

async function dropScratch(email: string, slug: string | null) {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const sql = postgres(url, { max: 1 });
  try {
    const slugs = new Set<string>();
    if (slug && isSlug(slug)) slugs.add(slug);
    const memberships = await sql`
      select m.tenant_slug as slug
      from memberships m
      join "user" u on u.id = m.user_id
      where u.email = ${email}
    `;
    for (const row of memberships) {
      if (typeof row.slug === "string" && isSlug(row.slug)) slugs.add(row.slug);
    }
    for (const name of slugs) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${name}" CASCADE`);
      await sql`delete from tenants where slug = ${name}`;
    }
    await sql`delete from "user" where email = ${email}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
