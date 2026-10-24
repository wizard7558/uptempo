import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

/**
 * DB-backed: needs DATABASE_URL with every public migration through 0038.
 * Uses throwaway scratch tenants and a mocked Stripe; skipped without a DB.
 */

const state = vi.hoisted(() => ({
  single: false,
  /** subscription id -> metered item creation time, or null when absent */
  meters: {} as Record<string, number | null>,
  failIdentifierPrefix: null as string | null,
}));

const meterCreate = vi.hoisted(() => vi.fn());
const subsRetrieve = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: subsRetrieve },
    events: { list: async () => ({ data: [], has_more: false }) },
    prices: { list: async () => ({ data: [{ id: "price_texts", lookup_key: "hosted_texts_metered" }] }) },
    billing: { meterEvents: { create: meterCreate } },
  }),
}));

const NOW = new Date("2031-05-25T02:00:00.000Z");
const DATE = "2031-05-10";
const NEXT = "2031-05-11";
const QUIET = "2031-05-12";
const FAIL = "2031-05-14";
const CUTOVER = "2031-05-20";
const CUTOVER_NEXT = "2031-05-21";
const METER_FROM = Date.parse("2031-05-01T00:00:00Z") / 1000;

describe.skipIf(!process.env.DATABASE_URL)("reportSmsUsage (db)", () => {
  let publicDb: typeof import("@/lib/db").publicDb;
  let schema: typeof import("@/lib/db/schema");
  let reportSmsUsage: typeof import("./sms-usage").reportSmsUsage;
  let a: import("@/lib/scheduling/db-fixtures").ScratchTenant;
  let b: import("@/lib/scheduling/db-fixtures").ScratchTenant;

  const callsFor = (slug: string) =>
    meterCreate.mock.calls.filter(([p]) => String(p.identifier).startsWith(`${slug}:`));
  const report = (date: string) => reportSmsUsage(date, { now: NOW });

  async function rowsFor(slug: string, date?: string) {
    const rows = await publicDb
      .select()
      .from(schema.smsUsageReports)
      .where(eq(schema.smsUsageReports.tenantSlug, slug));
    return date ? rows.filter((r) => r.usageDate === date) : rows;
  }

  async function addSms(
    t: import("@/lib/scheduling/db-fixtures").ScratchTenant,
    n: number,
    sid: string | null,
    status: string,
    at: string,
  ) {
    for (let i = 0; i < n; i++) {
      await t.run(
        `INSERT INTO "${t.schema}".sms_messages (to_phone, body, message_sid, status, created_at)
         VALUES ('+15550000000', 'hi', ${sid ? `'${sid}-${at}-${status}-${i}-${t.slug}'` : "NULL"}, '${status}', '${at}')`,
      );
    }
  }

  /** Bind billing ids and a ready lifecycle whose cursor starts at `from`. */
  async function setReady(slug: string, from: string, billableFrom = `${from}T00:00:00.000Z`) {
    await publicDb
      .update(schema.tenants)
      .set({ comped: 0, stripeSubscriptionId: `sub_${slug}`, platformStripeCustomerId: `cus_${slug}` })
      .where(eq(schema.tenants.slug, slug));
    await publicDb.delete(schema.hostedTextBillingState).where(eq(schema.hostedTextBillingState.tenantSlug, slug));
    await publicDb.insert(schema.hostedTextBillingState).values({
      tenantSlug: slug,
      customerId: `cus_${slug}`,
      subscriptionId: `sub_${slug}`,
      billableFrom: new Date(billableFrom),
      boundaryKind: "created",
      meterItemId: `si_meter_${slug}`,
      nextUsageDate: from,
      lifecycleState: "ready",
    });
    state.meters[`sub_${slug}`] = METER_FROM;
  }

  async function cursorOf(slug: string) {
    const [row] = await publicDb
      .select({ nextUsageDate: schema.hostedTextBillingState.nextUsageDate })
      .from(schema.hostedTextBillingState)
      .where(eq(schema.hostedTextBillingState.tenantSlug, slug));
    return row?.nextUsageDate ?? null;
  }

  beforeAll(async () => {
    ({ publicDb } = await import("@/lib/db"));
    schema = await import("@/lib/db/schema");
    ({ reportSmsUsage } = await import("./sms-usage"));
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    a = await scratchTenant("smsusagea");
    b = await scratchTenant("smsusageb");

    // Tenant A on DATE: 3 sent, 1 failed, 1 without a sid; plus 1 sent the next day.
    await addSms(a, 2, "SMa", "delivered", `${DATE}T08:00:00Z`);
    await addSms(a, 1, "SMa", "sent", `${DATE}T23:59:59Z`);
    await addSms(a, 1, "SMa", "failed", `${DATE}T10:00:00Z`);
    await addSms(a, 1, null, "queued", `${DATE}T11:00:00Z`);
    await addSms(a, 1, "SMa", "sent", `${NEXT}T00:00:00Z`);
    await addSms(a, 2, "SMa", "sent", `${FAIL}T09:00:00Z`);
    await addSms(b, 4, "SMb", "sent", `${FAIL}T09:00:00Z`);
    await addSms(a, 1, "SMcutover", "sent", `${CUTOVER}T11:59:59Z`);
    await addSms(a, 1, "SMcutover", "sent", `${CUTOVER}T12:00:00Z`);
    await addSms(a, 1, "SMcutover-next", "sent", `${CUTOVER_NEXT}T08:00:00Z`);
  }, 120_000);

  beforeEach(async () => {
    state.single = false;
    state.failIdentifierPrefix = null;
    meterCreate.mockReset();
    meterCreate.mockImplementation(async (p: { identifier: string }) => {
      if (state.failIdentifierPrefix && p.identifier.startsWith(state.failIdentifierPrefix)) {
        throw new Error("meter down");
      }
      return {};
    });
    subsRetrieve.mockReset();
    subsRetrieve.mockImplementation(async (id: string) => {
      const slug = id.replace(/^sub_/, "");
      const created = state.meters[id];
      return {
        id,
        customer: `cus_${slug}`,
        status: "active",
        metadata: { tenantSlug: slug, purpose: "uptempo_hosted_plan" },
        items: {
          data: created == null ? [] : [{ id: `si_meter_${slug}`, created, price: { lookup_key: "hosted_texts_metered" } }],
          has_more: false,
        },
      };
    });
    await publicDb.delete(schema.smsUsageReports).where(inArray(schema.smsUsageReports.tenantSlug, [a.slug, b.slug]));
    await setReady(a.slug, DATE);
    await setReady(b.slug, DATE);
  });

  afterAll(async () => {
    const slugs = [a?.slug, b?.slug].filter(Boolean) as string[];
    try {
      if (slugs.length > 0) {
        await publicDb.delete(schema.smsUsageReports).where(inArray(schema.smsUsageReports.tenantSlug, slugs));
        await publicDb.delete(schema.hostedTextBillingState).where(inArray(schema.hostedTextBillingState.tenantSlug, slugs));
      }
    } finally {
      await a?.drop();
      await b?.drop();
    }
  });

  it("reports each pending day once with frozen facts, advances the cursor, then skips on rerun", async () => {
    const first = await report(NEXT);
    expect(first.reported).toContain(a.slug);
    const calls = callsFor(a.slug);
    expect(calls.map(([params]) => params)).toEqual([
      {
        event_name: "uptempo_texts",
        payload: { stripe_customer_id: `cus_${a.slug}`, value: "3" },
        identifier: `${a.slug}:${DATE}`,
        timestamp: Math.floor(Date.parse(`${DATE}T23:59:59Z`) / 1000),
      },
      {
        event_name: "uptempo_texts",
        payload: { stripe_customer_id: `cus_${a.slug}`, value: "1" },
        identifier: `${a.slug}:${NEXT}`,
        timestamp: Math.floor(Date.parse(`${NEXT}T23:59:59Z`) / 1000),
      },
    ]);
    const [row] = await rowsFor(a.slug, DATE);
    expect(row).toMatchObject({ quantity: 3, reportStatus: "submitted", customerId: `cus_${a.slug}`, subscriptionId: `sub_${a.slug}` });
    expect(calls[0]![1]).toEqual({ idempotencyKey: `hosted-usage-v1:${row!.id}`, timeout: 30_000, maxNetworkRetries: 0 });
    expect(await cursorOf(a.slug)).toBe(QUIET);

    meterCreate.mockClear();
    const second = await report(NEXT);
    expect(second.reported).not.toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(0);
    expect(await rowsFor(a.slug, DATE)).toHaveLength(1);
  });

  it("submits a proven zero day without a meter event", async () => {
    await setReady(a.slug, QUIET);
    const res = await report(QUIET);
    expect(res.zero).toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(0);
    const [row] = await rowsFor(a.slug, QUIET);
    expect(row).toMatchObject({ quantity: 0, meterEventIdentifier: null, reportStatus: "submitted" });
  });

  it("keeps paid usage pending with no row and no cursor move while the meter is missing", async () => {
    state.meters[`sub_${a.slug}`] = null;
    const res = await report(DATE);
    expect(res.held).toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(0);
    expect(await rowsFor(a.slug, DATE)).toHaveLength(0);
    expect(await cursorOf(a.slug)).toBe(DATE);
  });

  it("retains a pending row after a failed meter call and keeps other businesses going", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await setReady(a.slug, FAIL);
      await setReady(b.slug, FAIL);
      state.failIdentifierPrefix = `${a.slug}:`;
      const res = await report(FAIL);
      expect(res.failed).toContain(a.slug);
      expect(await rowsFor(a.slug, FAIL)).toEqual([
        expect.objectContaining({ quantity: 2, reportStatus: "pending", reportedAt: null }),
      ]);
      expect(await cursorOf(a.slug)).toBe(FAIL);
      expect(res.reported).toContain(b.slug);
      expect((await rowsFor(b.slug, FAIL))[0]).toMatchObject({ quantity: 4, reportStatus: "submitted" });

      state.failIdentifierPrefix = null;
      expect((await report(FAIL)).reported).toContain(a.slug);
      const [first, retry] = callsFor(a.slug);
      expect(retry).toEqual(first);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does nothing in single mode", async () => {
    state.single = true;
    const res = await report(DATE);
    expect(res).toEqual({ reported: [], zero: [], skipped: [], failed: [], held: [] });
    expect(meterCreate).not.toHaveBeenCalled();
    expect(subsRetrieve).not.toHaveBeenCalled();
  });

  it("holds notified legacy metering until the committed switch marker and clamps only that first day", async () => {
    await setReady(a.slug, CUTOVER);
    await publicDb
      .update(schema.tenants)
      .set({
        billingNoticeSentAt: new Date("2031-03-20T12:00:00.000Z"),
        billingSwitchAt: new Date("2031-05-20T12:00:00.000Z"),
        billingSwitchedAt: null,
      })
      .where(eq(schema.tenants.slug, a.slug));
    expect((await report(CUTOVER)).skipped).toContain(a.slug);
    expect(await rowsFor(a.slug, CUTOVER)).toHaveLength(0);

    await publicDb
      .update(schema.tenants)
      .set({ billingSwitchedAt: new Date(`${CUTOVER}T12:00:00.000Z`) })
      .where(eq(schema.tenants.slug, a.slug));
    expect((await report(CUTOVER_NEXT)).reported).toContain(a.slug);
    expect(callsFor(a.slug).map(([params]) => params.payload.value)).toEqual(["1", "1"]);
    expect((await rowsFor(a.slug, CUTOVER))[0]?.quantity).toBe(1);
  });
});
