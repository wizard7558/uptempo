import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import { GYM_TEST_USER, bookingSessionCookie, seedTestSession, sessionCookie } from "./fixtures/auth";
import { GYM_CLIENT_B_ID, GYM_TIMEZONE, seedGymClass } from "./helpers/gym-class";
import { localDay } from "../../src/lib/scheduling/intervals";

/**
 * Group classes on the seeded `test-gym` tenant.
 *
 * The seed makes one Bootcamp tomorrow at 6:00 AM with one seat. Gym A holds it with a
 * pack credit. Gym B joins the waitlist from the public page, the owner cancels Gym A's
 * spot and gives the credit back, and Gym B is promoted into the seat.
 *
 * The three steps depend on each other, so they run in order, and the first one puts the
 * class back the way the seed leaves it (tomorrow moves every day).
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const GYM_HOST = "test-gym.localhost";

/** Public booking host. Port follows Playwright's baseURL and stays 3000 unless that URL says otherwise. */
function gymBookUrl(baseURL: string | undefined, path: string): string {
  const port = baseURL ? new URL(baseURL).port || "3000" : "3000";
  return `http://${GYM_HOST}:${port}${path}`;
}

let tomorrow = "";

test("a full class takes Gym B onto the waitlist", async ({ context, page }) => {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const { start } = await seedGymClass(sql);
    tomorrow = localDay(start, GYM_TIMEZONE);
  } finally {
    await sql.end();
  }

  await context.addCookies([bookingSessionCookie(GYM_CLIENT_B_ID, GYM_HOST)]);
  await mockStripe(page);
  await mockCalendarApi(page);

  await page.goto(gymBookUrl(test.info().project.use.baseURL, "/book/test-gym/classes"));
  await expect(page.getByText("6:00 AM to 6:45 AM").first()).toBeVisible();
  await expect(page.getByText("Full, join the waitlist").first()).toBeVisible();
  await page.getByRole("button", { name: /Full, join the waitlist/ }).click();
  await expect(page.getByText("Step 3 of 4")).toBeVisible();
  await expect(page.getByText("Gym B")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  // Gym B has no pack, so the class is paid at the gym.
  await expect(page.getByText("Pay at the gym: $20.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm session" }).click();
  await expect(page.getByText("You're on the waitlist (number 1)").first()).toBeVisible();
});

test("the owner cancels Gym A's spot, gives the credit back, and Gym B moves up", async ({ context, page }) => {
  const { signedCookieValue } = await seedTestSession(GYM_TEST_USER);
  await context.addCookies([sessionCookie(signedCookieValue)]);

  // Tomorrow can fall in next week (Sunday), so ask for the week that holds it.
  await page.goto(`/classes?week=${tomorrow}`);
  await expect(page.getByRole("heading", { name: "Classes", level: 1 })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Bootcamp" }).first();
  await row.getByRole("link", { name: "Open" }).click();

  await expect(page.getByRole("heading", { name: "Booked", level: 2 }).first()).toBeVisible();
  const gymA = page.getByRole("listitem").filter({ hasText: "Gym A" }).first();
  await expect(gymA).toContainText("Uses a credit");
  await gymA.getByRole("button", { name: "Cancel spot" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Give it back" }).click();

  const bookedSection = page.locator('section[aria-labelledby="booked-heading"]:visible');
  const waitlistSection = page.locator('section[aria-labelledby="waitlist-heading"]:visible');
  await expect(bookedSection).toContainText("Gym B");
  await expect(bookedSection).not.toContainText("Gym A");
  await expect(waitlistSection).toContainText("No one is on the waitlist.");
});

test("Gym B sees the class under My classes as Booked", async ({ context, page }) => {
  await context.addCookies([bookingSessionCookie(GYM_CLIENT_B_ID, GYM_HOST)]);
  await mockStripe(page);
  await mockCalendarApi(page);

  await page.goto(gymBookUrl(test.info().project.use.baseURL, "/book/test-gym/classes"));
  await page.reload();
  const mine = page.locator('section[aria-labelledby="my-classes-heading"]:visible');
  await expect(mine.getByRole("heading", { name: "My classes" })).toBeVisible();
  await expect(mine).toContainText("Bootcamp");
  await expect(mine).toContainText("Booked");
});
