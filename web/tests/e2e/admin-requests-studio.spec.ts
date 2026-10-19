import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { mockStripe, mockCalendarApi } from "./fixtures/mocks";
import {
  STUDIO_TEST_USER,
  bookingSessionCookie,
  seedTestSession,
  sessionCookie,
} from "./fixtures/auth";

/**
 * Request -> quote -> accept with deposit -> booked, on the seeded `test-studio`
 * tattoo tenant.
 *
 * The deposit is taken through the PAYMENTS_FAKE seam (playwright.config.ts sets
 * it for the dev server it starts, with STORAGE_PROVIDER=local for the photos).
 * A dev server you started yourself and reuse must also be started with
 * PAYMENTS_FAKE=1 STORAGE_PROVIDER=local, or the page shows "Deposit due"
 * instead of "Deposit paid" and the photo upload fails.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const STUDIO_HOST = "test-studio.localhost";
const PORT = process.env.E2E_PORT ?? "3000";
const STUDIO_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000101";
const SCHEMA = '"tenant_test-studio"';

// A 1x1 PNG, base64.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let appointmentId: string | null = null;

test.afterAll(async () => {
  if (!appointmentId) return;
  const sql = postgres(process.env.DATABASE_URL!);
  await sql.unsafe(`UPDATE ${SCHEMA}.appointments SET status = 'cancelled' WHERE id = '${appointmentId}'`);
  await sql.end();
});

async function createRequestAndVerifyPrivatePhotos(
  context: BrowserContext,
  page: Page,
): Promise<string> {
  const { signedCookieValue } = await seedTestSession(STUDIO_TEST_USER);
  await context.addCookies([
    sessionCookie(signedCookieValue),
    bookingSessionCookie(STUDIO_CLIENT_ID, STUDIO_HOST),
  ]);
  await mockStripe(page);
  await mockCalendarApi(page);

  // 1. The client picks a service entry, describes the job, confirms who they are, and sends two photos.
  await page.goto(`http://${STUDIO_HOST}:${PORT}/book/test-studio`);
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Describe what you need" })).toBeVisible();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await page.getByLabel("Where on your body?").fill("Left forearm");
  await page.getByLabel("About how big?").selectOption({ label: "Medium (2 to 5 in)" });
  await page.locator('input[type="file"]:visible').setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: PNG },
    { name: "two.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.getByText("Uploaded")).toHaveCount(2);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Not you?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Send request" })).toBeVisible();
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Send request. The deposit comes with the quote." }).click();
  await expect(page.getByText("Request sent")).toBeVisible();

  // 2. The owner opens it and sees both photos, served privately.
  await page.goto(`http://localhost:${PORT}/requests`);
  await page.getByRole("row", { name: /Studio Client/ }).first().getByRole("link", { name: "Open" }).click();
  const photos = page.locator('img[src^="/api/attachments/test-studio/"]');
  await expect(photos).toHaveCount(2);
  const src = await photos.first().getAttribute("src");
  const file = await page.request.get(src!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("image/png");
  return src!;
}

async function expectUnsignedPhotoLinkDenied(
  context: BrowserContext,
  src: string,
) {
  const unsignedUrl = new URL(src, `http://localhost:${PORT}`);
  unsignedUrl.search = "";
  const browser = context.browser();
  if (!browser) {
    throw new Error("Expected the E2E browser context to have a browser");
  }
  const anonymousContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  try {
    const unsignedFile = await anonymousContext.request.get(
      unsignedUrl.toString(),
    );
    expect(unsignedFile.status()).toBe(403);
  } finally {
    await anonymousContext.close();
  }
}

test("request photos upload privately", async ({ context, page }) => {
  const src = await createRequestAndVerifyPrivatePhotos(context, page);
  await expectUnsignedPhotoLinkDenied(context, src);
});

test("request with 2 photos -> quote -> accept with deposit -> booked", async ({ context, page }) => {
  test.setTimeout(180_000);
  await createRequestAndVerifyPrivatePhotos(context, page);

  // 3. The owner writes and sends a quote with a $100 deposit.
  await page.getByRole("link", { name: "Write a quote" }).click();
  await page.getByLabel("Service").selectOption({ label: "Half-day session" });
  await page.getByLabel("Deposit").fill("100");
  await page.getByLabel("Who will do it").selectOption({ label: "Riley Artist" });
  await page.getByRole("button", { name: "Send quote" }).click();
  await expect(page.getByText("Quote sent").first()).toBeVisible();

  // 4. The client opens the link on the studio's own address.
  const link = await page.getByLabel("Quote link").inputValue();
  expect(link).toContain("/book/test-studio/quote/");
  const url = new URL(link);
  await page.goto(`http://${STUDIO_HOST}:${PORT}${url.pathname}`);
  await expect(page.getByText("$600.00").first()).toBeVisible();
  await expect(page.getByText("Deposit due today")).toBeVisible();

  // 5. They pick a day and a time, sign, and pay.
  await page.locator("[data-booking-date]:not([disabled])").first().click();
  await page.locator("[data-slot-time]").first().click();
  await page.getByLabel("Type your full name to accept").fill("Studio Client");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept and pay $100.00 deposit" }).click();
  await expect(page.getByText("You're booked")).toBeVisible();
  await expect(page.getByText("Deposit paid")).toBeVisible();

  // 6. The database agrees.
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const [req] = await sql.unsafe(
      `SELECT id, status, appointment_id FROM ${SCHEMA}.booking_requests ORDER BY created_at DESC LIMIT 1`,
    );
    expect(req.status).toBe("converted");
    appointmentId = req.appointment_id;
    const [quote] = await sql.unsafe(
      `SELECT status, appointment_id FROM ${SCHEMA}.quotes WHERE request_id = '${req.id}' AND status = 'accepted'`,
    );
    expect(quote.appointment_id).toBe(appointmentId);
    const [appt] = await sql.unsafe(`SELECT deposit_cents FROM ${SCHEMA}.appointments WHERE id = '${appointmentId}'`);
    expect(appt.deposit_cents).toBe(10000);
    const [charge] = await sql.unsafe(
      `SELECT reason, status FROM ${SCHEMA}.charges WHERE appointment_id = '${appointmentId}'`,
    );
    expect(charge).toMatchObject({ reason: "deposit", status: "completed" });
    const [line] = await sql.unsafe(
      `SELECT duration_minutes, price_charged_cents FROM ${SCHEMA}.appointment_services WHERE appointment_id = '${appointmentId}'`,
    );
    expect(line).toMatchObject({ duration_minutes: 240, price_charged_cents: 60000 });
  } finally {
    await sql.end();
  }
});
