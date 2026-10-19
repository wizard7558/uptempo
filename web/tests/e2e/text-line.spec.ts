import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SLUG = "test-salon";
const SCREENSHOT_DIR =
  process.env.TEXT_LINE_SCREENSHOT_DIR ?? "test-results/text-line-screenshots";
const TEST_EIN = "12-3456789";
const CARRIER_REGISTRATION_PAID_FEE_FIXTURE =
  process.env.E2E_PREPAID_CARRIER_FIXTURE === "1"
    ? {
        setupFeeState: "added",
        setupFeeInvoiceItemId: "ii_e2e_paid_fixture",
      }
    : {};

test.setTimeout(180_000);

type SmsSnapshot = {
  sms_line_status: string;
  sms_brand_id: string | null;
  sms_campaign_id: string | null;
  sms_messaging_service_sid: string | null;
  sms_phone_number: string | null;
  sms_registration: Record<string, unknown>;
};

async function saveSmsSnapshot(
  sql: ReturnType<typeof postgres>,
): Promise<SmsSnapshot> {
  const [row] = await sql<SmsSnapshot[]>`
    select sms_line_status, sms_brand_id, sms_campaign_id,
      sms_messaging_service_sid, sms_phone_number, sms_registration
    from public.tenants where slug = ${SLUG}
  `;
  if (!row) throw new Error(`Missing ${SLUG} tenant in isolated E2E database`);
  return row;
}

async function setSmsState(
  sql: ReturnType<typeof postgres>,
  status: string,
  registration: Record<string, unknown> = {},
  columns: Partial<
    Omit<SmsSnapshot, "sms_line_status" | "sms_registration">
  > = {},
) {
  await sql`
    update public.tenants set
      sms_line_status = ${status},
      sms_brand_id = ${columns.sms_brand_id ?? null},
      sms_campaign_id = ${columns.sms_campaign_id ?? null},
      sms_messaging_service_sid = ${columns.sms_messaging_service_sid ?? null},
      sms_phone_number = ${columns.sms_phone_number ?? null},
      sms_registration = ${sql.json(registration as never)}
    where slug = ${SLUG}
  `;
}

async function prepareCarrierRegistrationFixture(
  sql: ReturnType<typeof postgres>,
) {
  // The production smoke opts into an already-paid fixture because production
  // must keep real Stripe charging enabled. The full dev suite leaves this
  // empty so its fake-payment path remains part of the functional flow.
  await setSmsState(sql, "off", { ...CARRIER_REGISTRATION_PAID_FEE_FIXTURE });
}

async function restoreSmsSnapshot(
  sql: ReturnType<typeof postgres>,
  snapshot: SmsSnapshot,
) {
  await sql`
    update public.tenants set
      sms_line_status = ${snapshot.sms_line_status},
      sms_brand_id = ${snapshot.sms_brand_id},
      sms_campaign_id = ${snapshot.sms_campaign_id},
      sms_messaging_service_sid = ${snapshot.sms_messaging_service_sid},
      sms_phone_number = ${snapshot.sms_phone_number},
      sms_registration = ${sql.json(snapshot.sms_registration as never)}
    where slug = ${SLUG}
  `;
}

async function submitRegistrationForm(
  page: Page,
  { ein }: { ein?: string } = {},
) {
  await page.getByRole("button", { name: "Set up text reminders" }).click();
  await page
    .getByLabel("Legal business name")
    .fill("Northwind Uptempo Salon LLC");
  await page
    .getByLabel("Business type")
    .selectOption(ein ? "LLC" : "SOLE_PROPRIETOR");
  if (ein) await page.getByLabel(/EIN/).fill(ein);
  await page.getByLabel("Business street address").fill("123 Main Street");
  await page.getByLabel("City").fill("Seattle");
  await page.getByLabel("State").fill("WA");
  await page.getByLabel("ZIP code").fill("98101");
  await page.getByLabel("Owner first name").fill("Riley");
  await page.getByLabel("Owner last name").fill("Owner");
  await page.getByLabel("Owner title").fill("Owner");
  await page.getByLabel("Owner email").fill("owner@example.com");
  await page.getByLabel("Owner mobile number").fill("+12065550123");
  await page
    .getByRole("checkbox", { name: /setup and monthly text line costs/ })
    .check();
  await page
    .getByRole("button", { name: "Submit for carrier approval" })
    .click();
}

async function advanceFakeRegistration(
  request: APIRequestContext,
  sql: ReturnType<typeof postgres>,
  limit = 40,
) {
  for (let attempt = 0; attempt < limit; attempt++) {
    const response = await request.get("/api/cron/sync-sms-registrations", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    if (!response.ok())
      throw new Error(`Fake registration cron returned ${response.ok()}`);
    const [row] = await sql<{ sms_line_status: string }[]>`
      select sms_line_status from public.tenants where slug = ${SLUG}
    `;
    if (row?.sms_line_status === "active") return;
  }
  throw new Error(
    "Fake registration did not reach active before the bounded cron loop ended",
  );
}

async function captureStateScreenshots(page: Page, state: string) {
  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const theme of ["light", "dark"] as const) {
      await page.locator("html").evaluate((element, isDark) => {
        element.classList.toggle("dark", isDark);
      }, theme === "dark");
      const card = page.locator("[aria-labelledby='text-line-title']");
      await expect(card).toBeVisible();
      await card.screenshot({
        path: path.join(
          SCREENSHOT_DIR,
          `${state}-${viewport.name}-${theme}.png`,
        ),
      });
    }
  }
}

test("EIN registration becomes active through the fake cron without saving a full EIN", async ({
  page,
  request,
}) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const original = await saveSmsSnapshot(sql);
  try {
    await prepareCarrierRegistrationFixture(sql);
    await page.goto("/settings/notifications");
    await expect(page.getByText(/one-time \$19 setup/)).toBeVisible();
    await submitRegistrationForm(page, { ein: TEST_EIN });
    await expect(
      page.getByText(
        "Waiting for carrier approval. Email reminders keep working.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await advanceFakeRegistration(request, sql);

    const [row] = await sql<
      { sms_registration: Record<string, unknown>; sms_line_status: string }[]
    >`
      select sms_line_status, sms_registration from public.tenants where slug = ${SLUG}
    `;
    expect(row.sms_line_status).toBe("active");
    expect(row.sms_registration.einLast4).toBe("6789");
    expect(JSON.stringify(row.sms_registration)).not.toContain("123456789");
    expect(JSON.stringify(row.sms_registration)).not.toContain("12-3456789");

    await page.reload();
    await expect(
      page.getByText(/Text reminders are on\. Your number/),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(TEST_EIN);
  } finally {
    await restoreSmsSnapshot(sql, original);
    await sql.end();
  }
});

test("sole-proprietor registration requests YES and lets the owner resend", async ({
  page,
  request,
}) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const original = await saveSmsSnapshot(sql);
  try {
    await prepareCarrierRegistrationFixture(sql);
    await page.goto("/settings/notifications");
    await submitRegistrationForm(page);

    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request.get("/api/cron/sync-sms-registrations", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      if (!response.ok())
        throw new Error("Fake registration cron did not succeed");
      const [row] = await sql<
        { sms_line_status: string; sms_registration: Record<string, unknown> }[]
      >`
        select sms_line_status, sms_registration from public.tenants where slug = ${SLUG}
      `;
      if (
        row?.sms_line_status === "action_needed" &&
        row.sms_registration.reason === "confirm_text"
      )
        break;
      if (attempt === 39)
        throw new Error(
          "Sole-proprietor registration did not request text confirmation",
        );
    }

    await page.reload();
    await expect(
      page.getByText(
        "Twilio sent a text to +12065550123. Reply YES within 24 hours to confirm.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Send it again" }).click();
    await expect(
      page.getByText("The confirmation text was sent again."),
    ).toBeVisible();
    const [row] = await sql<{ sms_registration: Record<string, unknown> }[]>`
      select sms_registration from public.tenants where slug = ${SLUG}
    `;
    expect(row.sms_registration.confirmationSentAt).toBeTruthy();
    expect(JSON.stringify(row.sms_registration)).not.toContain("ein");
  } finally {
    await restoreSmsSnapshot(sql, original);
    await sql.end();
  }
});

test("captures owner card states at mobile and desktop sizes in light and dark themes", async ({
  page,
}) => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const original = await saveSmsSnapshot(sql);
  try {
    const states: Array<{
      key: string;
      status: string;
      registration?: Record<string, unknown>;
      columns?: Partial<
        Omit<SmsSnapshot, "sms_line_status" | "sms_registration">
      >;
      text: RegExp | string;
    }> = [
      { key: "off", status: "off", text: /Text reminders cost \$4 a month/ },
      {
        key: "shared",
        status: "shared",
        text: "Texts send from Uptempo's shared number. Set up your own number for free.",
      },
      {
        key: "pending",
        status: "pending",
        registration: { status: "submitted", step: "create_brand" },
        text: "Waiting for carrier approval. Email reminders keep working.",
      },
      {
        key: "action-needed",
        status: "action_needed",
        registration: {
          status: "action_needed",
          brandType: "STANDARD",
          reason: "business_rejected",
          reasonMessage: "Carrier requested updated business information.",
        },
        text: "Carrier requested updated business information.",
      },
      {
        key: "confirm-text",
        status: "action_needed",
        registration: {
          status: "action_needed",
          brandType: "SOLE_PROPRIETOR",
          reason: "confirm_text",
          reasonMessage: "Reply YES to confirm.",
          input: { ownerMobile: "+12065550123" },
          resources: { brandSid: "BU_BRAND_TEST" },
        },
        text: "Twilio sent a text to +12065550123. Reply YES within 24 hours to confirm.",
      },
      {
        key: "active",
        status: "active",
        registration: { status: "active", step: "active" },
        columns: {
          sms_messaging_service_sid: "MG_TEST_APPROVED",
          sms_phone_number: "+12065550100",
        },
        text: "Text reminders are on. Your number is +12065550100.",
      },
    ];

    for (const state of states) {
      await setSmsState(
        sql,
        state.status,
        state.registration ?? {},
        state.columns,
      );
      await page.goto("/settings/notifications");
      await expect(page.getByText(state.text)).toBeVisible();
      await captureStateScreenshots(page, state.key);
    }
  } finally {
    await restoreSmsSnapshot(sql, original);
    await sql.end();
  }
});
