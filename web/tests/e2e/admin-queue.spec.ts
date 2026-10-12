import { test, expect as baseExpect } from "@playwright/test";
import postgres from "postgres";

/**
 * The walk-in line on the seeded `test-salon` tenant.
 *
 * Front desk opens the line, a customer joins from their phone (a fresh browser with no
 * cookies), the front desk calls them, the customer's page changes to "It's your turn.",
 * and the front desk starts and finishes the visit.
 *
 * The file is named admin-queue so it runs in the admin project (signed-in storage state).
 * It cleans up after itself so it can run again: leftover entries for the test phone are
 * removed first (the same phone cannot be in line twice), the join rate limits are cleared,
 * and the line is closed at the end so other specs are not affected.
 */
const SLUG = "test-salon";
const SCHEMA = '"tenant_test-salon"';
const PHONE_FORMATTED = "(555) 555-0142";
const PHONE = "+15555550142";
const CUSTOMER = "Pat Walker";

test.describe.configure({ mode: "serial" });
// The first visit to each page compiles it in dev mode, which is slow.
test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 15_000 });

async function cleanup(sql: ReturnType<typeof postgres>) {
  // Visits first (their client has the test phone), then the line, then the client.
  await sql.unsafe(
    `DELETE FROM ${SCHEMA}.appointments WHERE client_id IN (SELECT id FROM ${SCHEMA}.clients WHERE phone = '${PHONE}')`,
  );
  await sql.unsafe(`DELETE FROM ${SCHEMA}.queue_entries WHERE phone = '${PHONE}' OR name = '${CUSTOMER}'`);
  await sql.unsafe(`DELETE FROM ${SCHEMA}.clients WHERE phone = '${PHONE}'`);
  await sql.unsafe(
    `DELETE FROM otp_rate_limits WHERE tenant_slug = '${SLUG}' AND normalized_key LIKE 'queue_join:%'`,
  );
}

test.beforeAll(async () => {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await cleanup(sql);
    await sql.unsafe(`UPDATE ${SCHEMA}.business_settings SET queue_open = 0`);
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await cleanup(sql);
    await sql.unsafe(`UPDATE ${SCHEMA}.business_settings SET queue_open = 0`);
  } finally {
    await sql.end();
  }
});

test("a customer joins the line, is called, and is served", async ({ page, browser }) => {
  // 1. Front desk opens the line.
  await page.goto("/walk-ins");
  await expect(page.getByRole("heading", { name: "Walk-ins", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Open the line" }).click();
  await expect(page.getByText("The line is open", { exact: true })).toBeVisible();

  // 2. The customer joins from their phone: a new browser with no cookies.
  const customerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const customer = await customerContext.newPage();
    await customer.goto(`/q/${SLUG}`);
    await customer.getByLabel("Your name").fill(CUSTOMER);
    await customer.getByLabel("Phone").fill(PHONE_FORMATTED);
    await customer.getByLabel("Service").selectOption({ label: "Haircut" });
    await customer.getByRole("button", { name: "Join the line" }).click();
    await expect(customer.getByRole("status")).toHaveText(
      /^You're number 1\. (About \d+ minutes|It's almost your turn|We'll let you know when it's your turn)\.$/,
    );

    // 3. Front desk sees them and calls them for Test Stylist.
    await page.reload();
    const waiting = page.locator('section[aria-labelledby="walkin-waiting"]:visible');
    await expect(waiting.getByText(CUSTOMER)).toBeVisible();
    await waiting.getByRole("button", { name: "Call", exact: true }).click();
    await page.getByRole("button", { name: "Test Stylist", exact: true }).click();
    const called = page.locator('section[aria-labelledby="walkin-called"]:visible');
    // The first call compiles the line action in dev and can take longer than the default wait.
    await expect(called.getByText(CUSTOMER)).toBeVisible({ timeout: 45_000 });

    // 4. The customer's page updates by itself (it checks every 15 seconds).
    await expect(customer.getByText("It's your turn.")).toBeVisible({ timeout: 20_000 });
  } finally {
    await customerContext.close();
  }

  // 5. Front desk starts the visit, finishes it, and can check the customer out.
  const called = page.locator('section[aria-labelledby="walkin-called"]:visible');
  await called.getByRole("button", { name: "Start", exact: true }).click();
  const serving = page.locator('section[aria-labelledby="walkin-serving"]:visible');
  await expect(serving.getByText(CUSTOMER)).toBeVisible();
  await serving.getByRole("button", { name: "Done", exact: true }).click();
  await expect(serving.getByRole("button", { name: "Check out" })).toBeVisible();

  // 6. The QR page.
  await page.goto("/walk-ins/qr");
  await expect(page.getByText("Scan to join the line")).toBeVisible();
  await expect(page.locator("main svg:visible").first()).toBeVisible();
});
