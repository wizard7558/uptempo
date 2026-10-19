import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import {
  HOME_TEST_USER,
  bookingSessionCookie,
  seedTestSession,
  sessionCookie,
} from "./fixtures/auth";

/**
 * On-site visits on the seeded `test-home` tenant: the request form refuses a
 * ZIP code outside the service areas, takes one inside, and the owner sees the
 * service area on the settings page.
 *
 * The booking-session cookie stands in for the OTP step, which e2e mocks.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const HOME_HOST = "test-home.localhost";
const PORT = process.env.E2E_PORT ?? "3000";
const HOME_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000201";
const SCHEMA = '"tenant_test-home"';

test.describe("home services on-site visits", () => {
  // Start clean so the spec can run again against the same seeded database.
  test.beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!);
    await sql.unsafe(`DELETE FROM ${SCHEMA}.booking_requests WHERE client_id = '${HOME_CLIENT_ID}'`);
    await sql.unsafe(`DELETE FROM ${SCHEMA}.client_addresses WHERE client_id = '${HOME_CLIENT_ID}'`);
    await sql.end();
  });

  test("a request from outside the service area is refused, one inside is sent", async ({ context, page }) => {
    await context.addCookies([bookingSessionCookie(HOME_CLIENT_ID, HOME_HOST)]);
    await mockStripe(page);
    await mockCalendarApi(page);

    await page.goto(`http://${HOME_HOST}:${PORT}/book/test-home`);
    await expect(page.getByText("Step 1 of 4")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Describe what you need" })).toBeVisible();
    await page.getByLabel("Describe the job").fill("Deep clean of a two bedroom apartment");
    await page.getByLabel("Street address").fill("350 5th Ave");
    await page.getByLabel("City").fill("Beverly Hills");
    await page.getByLabel("State").fill("CA");
    await page.getByLabel("ZIP code").fill("90210");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Not you?" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Send request. The deposit comes with the quote." }).click();
    await expect(page.getByText("We don't serve 90210 yet.").first()).toBeVisible();

    // Nothing was written for the refused request.
    const sql = postgres(process.env.DATABASE_URL!);
    try {
      const [before] = await sql.unsafe(
        `SELECT count(*)::int AS n FROM ${SCHEMA}.booking_requests WHERE client_id = '${HOME_CLIENT_ID}'`,
      );
      expect(before.n).toBe(0);

      // Fix the ZIP code and send again.
      await page.getByRole("button", { name: "Describe what you need", exact: true }).click();
      await page.getByLabel("ZIP code").fill("10001");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Send request. The deposit comes with the quote." }).click();
      await expect(page.getByText("Request sent")).toBeVisible();

      const [req] = await sql.unsafe(
        `SELECT r.address_id, a.postal_code, a.lat, a.geo_source
           FROM ${SCHEMA}.booking_requests r
           JOIN ${SCHEMA}.client_addresses a ON a.id = r.address_id
          WHERE r.client_id = '${HOME_CLIENT_ID}'`,
      );
      expect(req).toMatchObject({ postal_code: "10001", geo_source: "postal_centroid" });
      expect(Math.abs(Number(req.lat) - 40.75)).toBeLessThan(0.05);
    } finally {
      await sql.end();
    }
  });

  test("the owner sees the service area", async ({ context, page }) => {
    const { signedCookieValue } = await seedTestSession(HOME_TEST_USER);
    await context.addCookies([sessionCookie(signedCookieValue)]);
    await mockStripe(page);
    await mockCalendarApi(page);

    await page.goto("/settings/service-areas");
    await expect(page.getByRole("heading", { name: "Service area" })).toBeVisible();
    await expect(page.getByText("3 ZIP codes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save arrival window" })).toBeVisible();
  });
});
