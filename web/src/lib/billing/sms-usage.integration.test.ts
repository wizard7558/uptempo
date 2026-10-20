import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

/**
 * DB-backed: needs DATABASE_URL. Uses throwaway scratch tenants and a mocked
 * Stripe, so it runs in CI's test-db job; skipped without a DB.
 */

const state = vi.hoisted(() => ({
  single: false,
  /** subscription id -> price lookup keys on it */
  subs: {} as Record<string, string[]>,
  failIdentifierPrefix: null as string | null,
}));

const meterCreate = vi.hoisted(() => vi.fn());
const subsRetrieve = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: subsRetrieve },
    billing: { meterEvents: { create: meterCreate } },
  }),
}));

const DATE = "2031-05-10";
const NEXT = "2031-05-11";
const QUIET = "2031-05-12";
const NOMETER = "2031-05-13";
const FAIL = "2031-05-14";
const SINGLE = "2031-05-15";
const CUTOVER = "2031-05-20";
const CUTOVER_NEXT = "2031-05-21";
const NEWBORN = "2031-05-22";

describe.skipIf(!process.env.DATABASE_URL)("reportSmsUsage (db)", () => {
  let publicDb: typeof import("@/lib/db").publicDb;
  let tenants: typeof import("@/lib/db/schema").tenants;
  let smsUsageReports: typeof import("@/lib/db/schema").smsUsageReports;
  let reportSmsUsage: typeof import("./sms-usage").reportSmsUsage;
  let a: import("@/lib/scheduling/db-fixtures").ScratchTenant;
  let b: import("@/lib/scheduling/db-fixtures").ScratchTenant;

  const callsFor = (slug: string) =>
    meterCreate.mock.calls.filter(([p]) => String(p.identifier).startsWith(`${slug}:`));

  async function rowsFor(slug: string, date?: string) {
    const rows = await publicDb
      .select()
      .from(smsUsageReports)
      .where(eq(smsUsageReports.tenantSlug, slug));
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

  async function setBilling(slug: string, sub: string, cus: string) {
    await publicDb
      .update(tenants)
      .set({ comped: 0, stripeSubscriptionId: sub, platformStripeCustomerId: cus })
      .where(eq(tenants.slug, slug));
  }

  async function setSwitchMarkers(
    slug: string,
    notice: Date | null,
    switched: Date | null,
  ) {
    await publicDb
      .update(tenants)
      .set({
        billingNoticeSentAt: notice,
        billingSwitchAt: notice ? new Date("2031-07-19T00:00:00.000Z") : null,
        billingSwitchedAt: switched,
      })
      .where(eq(tenants.slug, slug));
  }

  beforeAll(async () => {
    ({ publicDb } = await import("@/lib/db"));
    ({ tenants, smsUsageReports } = await import("@/lib/db/schema"));
    ({ reportSmsUsage } = await import("./sms-usage"));
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    a = await scratchTenant("smsusagea");
    b = await scratchTenant("smsusageb");

    await setBilling(a.slug, `sub_${a.slug}`, `cus_${a.slug}`);
    await setBilling(b.slug, `sub_${b.slug}`, `cus_${b.slug}`);
    state.subs[`sub_${a.slug}`] = ["hosted_base_monthly", "hosted_texts_metered"];
    state.subs[`sub_${b.slug}`] = ["hosted_base_monthly", "hosted_texts_metered"];

    // Tenant A on DATE: 3 sent, 1 failed, 1 without a sid; plus 1 sent the next day.
    await addSms(a, 2, "SMa", "delivered", `${DATE}T08:00:00Z`);
    await addSms(a, 1, "SMa", "sent", `${DATE}T23:59:59Z`);
    await addSms(a, 1, "SMa", "failed", `${DATE}T10:00:00Z`);
    await addSms(a, 1, null, "queued", `${DATE}T11:00:00Z`);
    await addSms(a, 1, "SMa", "sent", `${NEXT}T00:00:00Z`);
    // Tenant B has texts on FAIL day only.
    await addSms(a, 2, "SMa", "sent", `${FAIL}T09:00:00Z`);
    await addSms(b, 4, "SMb", "sent", `${FAIL}T09:00:00Z`);
    await addSms(a, 1, "SMcutover", "sent", `${CUTOVER}T11:59:59Z`);
    await addSms(a, 1, "SMcutover", "sent", `${CUTOVER}T12:00:00Z`);
    await addSms(a, 1, "SMcutover-next", "sent", `${CUTOVER_NEXT}T08:00:00Z`);
    await addSms(b, 1, "SMnewborn", "sent", `${NEWBORN}T08:00:00Z`);
    await addSms(b, 1, "SMnewborn", "sent", `${NEWBORN}T16:00:00Z`);
  }, 120_000);

  beforeEach(() => {
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
    subsRetrieve.mockImplementation(async (id: string) => ({
      id,
      items: { data: (state.subs[id] ?? []).map((k) => ({ price: { lookup_key: k } })) },
    }));
  });

  afterAll(async () => {
    const slugs = [a?.slug, b?.slug].filter(Boolean) as string[];
    try {
      if (slugs.length > 0) {
        await publicDb.delete(smsUsageReports).where(inArray(smsUsageReports.tenantSlug, slugs));
      }
    } finally {
      await a?.drop();
      await b?.drop();
    }
  });

  it("reports the day's billed texts once, then skips on rerun", async () => {
    const first = await reportSmsUsage(DATE);
    expect(first.reported).toContain(a.slug);
    const calls = callsFor(a.slug);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({
      event_name: "uptempo_texts",
      payload: { stripe_customer_id: `cus_${a.slug}`, value: "3" },
      identifier: `${a.slug}:${DATE}`,
      timestamp: Math.floor(Date.parse(`${DATE}T23:59:59Z`) / 1000),
    });
    const rows = await rowsFor(a.slug, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
    expect(rows[0].meterEventIdentifier).toBe(`${a.slug}:${DATE}`);

    meterCreate.mockClear();
    const second = await reportSmsUsage(DATE);
    expect(second.skipped).toContain(a.slug);
    expect(second.reported).not.toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(0);
    expect(await rowsFor(a.slug, DATE)).toHaveLength(1);
  });

  it("records a zero row without a meter event when nothing was sent", async () => {
    const res = await reportSmsUsage(QUIET);
    expect(res.zero).toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(0);
    const rows = await rowsFor(a.slug, QUIET);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(0);
    expect(rows[0].meterEventIdentifier).toBeNull();
  });

  it("skips a subscription without the metered item and writes nothing", async () => {
    state.subs[`sub_${a.slug}`] = ["hosted_base_monthly"];
    try {
      const res = await reportSmsUsage(NOMETER);
      expect(res.skipped).toContain(a.slug);
      expect(callsFor(a.slug)).toHaveLength(0);
      expect(await rowsFor(a.slug, NOMETER)).toHaveLength(0);
    } finally {
      state.subs[`sub_${a.slug}`] = ["hosted_base_monthly", "hosted_texts_metered"];
    }
  });

  it("marks a failed meter call and keeps other businesses going", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      state.failIdentifierPrefix = `${a.slug}:`;
      const res = await reportSmsUsage(FAIL);
      expect(res.failed).toContain(a.slug);
      expect(await rowsFor(a.slug, FAIL)).toHaveLength(0);
      expect(res.reported).toContain(b.slug);
      const rows = await rowsFor(b.slug, FAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(4);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does nothing in single mode", async () => {
    state.single = true;
    const res = await reportSmsUsage(SINGLE);
    expect(res).toEqual({ reported: [], zero: [], skipped: [], failed: [] });
    expect(meterCreate).not.toHaveBeenCalled();
    expect(subsRetrieve).not.toHaveBeenCalled();
    expect(await rowsFor(a.slug, SINGLE)).toHaveLength(0);
  });

  it("holds notified legacy metering until the final switch marker and clamps only that first day", async () => {
    await setSwitchMarkers(
      a.slug,
      new Date("2031-03-20T12:00:00.000Z"),
      null,
    );
    const held = await reportSmsUsage(CUTOVER);
    expect(held.skipped).toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(0);
    expect(await rowsFor(a.slug, CUTOVER)).toHaveLength(0);

    await setSwitchMarkers(
      a.slug,
      new Date("2031-03-20T12:00:00.000Z"),
      new Date(`${CUTOVER}T12:00:00.000Z`),
    );
    const switched = await reportSmsUsage(CUTOVER);
    expect(switched.reported).toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(1);
    expect(callsFor(a.slug)[0][0].payload.value).toBe("1");
    expect((await rowsFor(a.slug, CUTOVER))[0]?.quantity).toBe(1);

    const nextDay = await reportSmsUsage(CUTOVER_NEXT);
    expect(nextDay.reported).toContain(a.slug);
    expect(callsFor(a.slug)).toHaveLength(2);
    expect(callsFor(a.slug)[1][0].payload.value).toBe("1");

    await setSwitchMarkers(b.slug, null, new Date(`${NEWBORN}T12:00:00.000Z`));
    const newborn = await reportSmsUsage(NEWBORN);
    expect(newborn.reported).toContain(b.slug);
    expect(callsFor(b.slug)).toHaveLength(1);
    expect(callsFor(b.slug)[0][0].payload.value).toBe("2");
  });
});
