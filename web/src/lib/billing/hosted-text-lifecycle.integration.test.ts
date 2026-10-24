import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

/**
 * Drizzle stores of the hosted text lifecycle and usage reporter against a
 * disposable local PostgreSQL. Explicit opt-in plus URL, database-name, and
 * pg_database comment markers are required before any DDL; a configured or
 * shared database is refused. Fixtures are the minimal accepted preimage
 * (tenants from the 0038 snapshot, 0034, then 0038), not the full journal.
 */
const enabled = process.env.HOSTED_TEXT_LIFECYCLE_TEST === "1";
const MARKER = "uptempo hosted-text disposable lifecycle application test";

const syncBillableStaff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/billable-staff", () => ({ syncBillableStaff }));

const stub = vi.hoisted(() => ({
  subs: new Map<string, Record<string, unknown>>(),
  events: [] as Array<Record<string, unknown>>,
  keys: new Map<string, unknown>(),
  failMeter: 0,
  onInventory: null as (() => Promise<void>) | null,
  meterEvents: [] as Array<{ params: Record<string, unknown>; key?: string }>,
}));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    prices: { list: async () => ({ data: [{ id: "price_texts", lookup_key: "hosted_texts_metered" }] }) },
    events: { list: async () => ({ data: stub.events, has_more: false }) },
    subscriptions: {
      retrieve: async (id: string) => { await stub.onInventory?.(); return structuredClone(stub.subs.get(id)); },
      update: async (id: string, params: { items: Array<{ price: string; metadata: Record<string, string> }> }, options: { idempotencyKey: string }) => {
        if (!stub.keys.has(options.idempotencyKey)) {
          const sub = stub.subs.get(id)! as { items: { data: unknown[] } };
          sub.items.data.push({ id: `si_${options.idempotencyKey.slice(-8)}`, created: 1, metadata: params.items[0]!.metadata,
            price: { id: params.items[0]!.price, lookup_key: "hosted_texts_metered" } });
          stub.keys.set(options.idempotencyKey, true);
        }
        return structuredClone(stub.subs.get(id));
      },
    },
    billing: { meterEvents: { create: async (params: Record<string, unknown>, options: { idempotencyKey?: string }) => {
      if (stub.failMeter-- > 0) throw new Error("synthetic transport failure");
      stub.meterEvents.push({ params, key: options.idempotencyKey });
      return {};
    } } },
  }),
}));
vi.mock("@/lib/db/tenant", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { getTenantSchema } = await import("@/lib/db/tenant-schema");
  let db: ReturnType<typeof drizzle> | undefined;
  return {
    withTenantDb: async (slug: string, callback: (db: unknown, tables: unknown) => unknown) => {
      db ??= drizzle(postgres(process.env.DATABASE_URL!, { max: 1 }));
      return callback(db, getTenantSchema(slug));
    },
  };
});

describe.skipIf(!enabled)("hosted text lifecycle stores (disposable local PostgreSQL)", () => {
  let client: postgres.Sql;
  let marked = false;
  let lifecycle: typeof import("./hosted-text-lifecycle");
  let usage: typeof import("./sms-usage");

  const tenantsDdl = () => {
    const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/0038_snapshot.json"), "utf8"));
    const columns = Object.values(snapshot.tables["public.tenants"].columns as Record<string, {
      name: string; type: string; notNull: boolean; primaryKey: boolean; default?: unknown;
    }>).map((c) => `"${c.name}" ${c.type}${c.primaryKey ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${c.default !== undefined ? ` DEFAULT ${c.default}` : ""}`);
    return `CREATE TABLE public.tenants (${columns.join(", ")}, CONSTRAINT tenants_slug_unique UNIQUE (slug))`;
  };
  const clear = async () => {
    const schemas = await client.unsafe("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_htl%'");
    for (const { nspname } of schemas) await client.unsafe(`DROP SCHEMA "${nspname}" CASCADE`);
    await client.unsafe("DROP TABLE IF EXISTS public.hosted_text_billing_state, public.sms_usage_reports, public.tenants");
    await client.unsafe("DROP FUNCTION IF EXISTS public.hosted_text_preserve_report_facts()");
  };
  const addTenant = async (slug: string, values: Record<string, unknown> = {}) => {
    await client`INSERT INTO public.tenants ${client({ name: slug, slug, platform_stripe_customer_id: `cus_${slug}`,
      stripe_subscription_id: `sub_${slug}`, sms_line_status: "active", ...values })}`;
    await client.unsafe(`CREATE SCHEMA "tenant_${slug}"; CREATE TABLE "tenant_${slug}".sms_messages
      (id serial PRIMARY KEY, message_sid text, status text NOT NULL, created_at timestamptz NOT NULL)`);
  };
  /** A subscription whose trial converted naturally at `trialEnd`, with its evidence event. */
  const convertedSub = (slug: string, trialEnd: number) => {
    const sub = { id: `sub_${slug}`, customer: `cus_${slug}`, status: "active", created: trialEnd - 14 * 86_400,
      trial_start: trialEnd - 14 * 86_400, trial_end: trialEnd, metadata: { tenantSlug: slug, purpose: "uptempo_hosted_plan" },
      items: { data: [] as unknown[], has_more: false } };
    stub.subs.set(sub.id, sub);
    stub.events.push({ id: `evt_${slug}`, type: "customer.subscription.updated", created: trialEnd,
      data: { object: { ...sub, items: undefined }, previous_attributes: { status: "trialing" } } });
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || Number(url.port) <= 1024
      || url.port === "5432" || !/^\/hosted_text_lifecycle_app_test_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) {
      throw new Error("Requires a dedicated local non-5432 hosted_text_lifecycle_app_test_* database");
    }
    client = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const [database] = await client.unsafe(`SELECT shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()`);
    if (database?.marker !== MARKER) throw new Error("Disposable database marker missing");
    marked = true;
    lifecycle = await import("./hosted-text-lifecycle");
    usage = await import("./sms-usage");
  });

  beforeEach(async () => {
    await clear();
    await client.unsafe(tenantsDdl());
    await client.unsafe(readFileSync(resolve(process.cwd(), "drizzle/0034_sms_usage_reports.sql"), "utf8"));
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0038_hosted_text_billing_lifecycle.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) await client.unsafe(statement);
    Object.assign(stub, { events: [], meterEvents: [], failMeter: 0, onInventory: null });
    stub.subs.clear();
    stub.keys.clear();
    syncBillableStaff.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (marked) await clear();
    if (client) await client.end();
    const { closePublicDb } = await import("@/lib/db");
    await closePublicDb();
  });

  it("serializes concurrent workers on the tenant lock and commits one durable intent and receipt", async () => {
    await addTenant("htla");
    convertedSub("htla", Math.floor(Date.now() / 1000) - 3600);
    const results = await Promise.all([lifecycle.reconcileHostedTextMeter("htla"), lifecycle.reconcileHostedTextMeter("htla")]);
    expect(results).toEqual([{ outcome: "ready" }, { outcome: "ready" }]);
    const [row] = await client`SELECT * FROM public.hosted_text_billing_state WHERE tenant_slug = 'htla'`;
    expect(row).toMatchObject({ lifecycle_state: "ready", boundary_kind: "trial_end", boundary_event_id: "evt_htla" });
    expect(lifecycle.parseMeterOperation(row!.meter_operation_id, { customerId: "cus_htla", subscriptionId: "sub_htla" }))
      .toMatchObject({ v: 1, kind: "attach", priceId: "price_texts" });
    expect(stub.keys.size).toBe(1);
    expect((stub.subs.get("sub_htla") as { items: { data: unknown[] } }).items.data).toHaveLength(1);
  });

  it("refuses another tenant reusing a bound customer before any provider write", async () => {
    await addTenant("htla");
    await addTenant("htlb", { platform_stripe_customer_id: "cus_htla" });
    convertedSub("htla", Math.floor(Date.now() / 1000) - 3600);
    expect(await lifecycle.reconcileHostedTextMeter("htla")).toEqual({ outcome: "ready" });
    stub.subs.set("sub_htlb", { ...structuredClone(stub.subs.get("sub_htla")), id: "sub_htlb", metadata: { tenantSlug: "htlb", purpose: "uptempo_hosted_plan" }, items: { data: [], has_more: false } });
    stub.events.push({ id: "evt_htlb", type: "customer.subscription.updated", created: stub.subs.get("sub_htlb")!.trial_end,
      data: { object: { ...stub.subs.get("sub_htlb"), items: undefined }, previous_attributes: { status: "trialing" } } });
    await expect(lifecycle.reconcileHostedTextMeter("htlb")).rejects.toThrow();
    expect(await client`SELECT tenant_slug FROM public.hosted_text_billing_state ORDER BY tenant_slug`).toEqual([{ tenant_slug: "htla" }]);
    expect(stub.keys.size).toBe(1);
  });

  it("freezes winning report facts, settles by compare-and-set, and advances the cursor only over submitted days", async () => {
    await addTenant("htla");
    await client`INSERT INTO public.hosted_text_billing_state ${client({ tenant_slug: "htla", customer_id: "cus_htla",
      subscription_id: "sub_htla", billable_from: new Date("2031-05-10T00:00:00Z"), boundary_kind: "created", next_usage_date: "2031-05-10", lifecycle_state: "ready", meter_item_id: "si_ledger" })}`;
    const store = usage.drizzleUsageReportStore;
    const facts = { tenantSlug: "htla", usageDate: "2031-05-10", meterEventIdentifier: "htla:2031-05-10", reportStatus: "pending" as const,
      reportedAt: null, customerId: "cus_htla", subscriptionId: "sub_htla", meterEventTimestamp: 1, firstAttemptAt: new Date() };
    const winner = await store.insert({ ...facts, quantity: 3 });
    expect(await store.insert({ ...facts, quantity: 9 })).toEqual(winner);
    await expect(client`UPDATE public.sms_usage_reports SET quantity = 9 WHERE id = ${winner.id}`).rejects.toMatchObject({ code: "23514" });
    expect(await store.markUncertain(winner.id)).toBe(true);
    expect(await store.markSubmitted(winner.id, new Date())).toBe(true);
    expect(await store.markSubmitted(winner.id, new Date())).toBe(false);
    expect(await store.markUncertain(winner.id)).toBe(false);
    await store.insert({ tenantSlug: "htla", usageDate: "2031-05-11", quantity: 0, meterEventIdentifier: null, reportStatus: "submitted", reportedAt: new Date() });
    await store.insert({ ...facts, usageDate: "2031-05-12", quantity: 1 });
    await client`UPDATE public.hosted_text_billing_state SET lifecycle_state = 'unresolved'`;
    await store.advanceCursor("htla", "2031-05-13");
    expect((await client`SELECT next_usage_date::text AS d FROM public.hosted_text_billing_state`)[0]?.d).toBe("2031-05-10");
    await client`UPDATE public.hosted_text_billing_state SET lifecycle_state = 'ready'`;
    await store.advanceCursor("htla", "2031-05-13");
    const [cursor] = await client`SELECT next_usage_date::text AS d FROM public.hosted_text_billing_state WHERE tenant_slug = 'htla'`;
    expect(cursor?.d).toBe("2031-05-12");
  });

  it("reports activation-day paid texts end to end and ignores nine comped demos even with lifecycle rows", async () => {
    await addTenant("htla");
    for (let demo = 1; demo <= 9; demo++) {
      await addTenant(`htldemo${demo}`, { comped: 1 });
      await client`INSERT INTO public.hosted_text_billing_state ${client({ tenant_slug: `htldemo${demo}`, customer_id: `cus_htldemo${demo}`,
        subscription_id: `sub_htldemo${demo}`, billable_from: new Date("2031-05-10T00:00:00Z"), boundary_kind: "created",
        next_usage_date: "2031-05-10", meter_item_id: `si_demo${demo}`, lifecycle_state: "ready" })}`;
    }
    await client`INSERT INTO public.hosted_text_billing_state ${client({ tenant_slug: "htla", customer_id: "cus_htla", subscription_id: "sub_htla",
      billable_from: new Date("2031-05-10T20:00:00Z"), boundary_kind: "trial_end", next_usage_date: "2031-05-10", meter_item_id: "si_a", lifecycle_state: "ready" })}`;
    stub.subs.set("sub_htla", { id: "sub_htla", customer: "cus_htla", status: "active", metadata: { tenantSlug: "htla", purpose: "uptempo_hosted_plan" },
      items: { data: [{ id: "si_a", created: Date.parse("2031-05-10T20:00:05Z") / 1000, price: { lookup_key: "hosted_texts_metered" } }], has_more: false } });
    await client.unsafe(`INSERT INTO "tenant_htla".sms_messages (message_sid, status, created_at) VALUES
      ('SM1', 'delivered', '2031-05-10T19:59:59.999Z'), ('SM2', 'delivered', '2031-05-10T20:00:00Z'), (NULL, 'queued', '2031-05-10T21:00:00Z'),
      ('SM3', 'failed', '2031-05-10T21:00:00Z'), ('SM4', 'sent', '2031-05-10T23:59:59Z')`);
    const result = await usage.reportSmsUsage("2031-05-10", { now: new Date("2031-05-11T02:00:00Z") });
    expect(result).toMatchObject({ reported: ["htla"], failed: [], held: [] });
    expect(stub.meterEvents.map((event) => event.params.payload)).toEqual([{ stripe_customer_id: "cus_htla", value: "2" }]);
    const [row] = await client`SELECT id, report_status, quantity FROM public.sms_usage_reports WHERE tenant_slug = 'htla'`;
    expect(row).toMatchObject({ report_status: "submitted", quantity: 2 });
    expect(stub.meterEvents[0]!.key).toBe(`hosted-usage-v1:${row!.id}`);
    expect(await client`SELECT count(*)::int AS n FROM public.sms_usage_reports WHERE tenant_slug LIKE 'htldemo%'`).toEqual([{ n: 0 }]);
  });

  const reportNow = new Date("2031-05-11T02:00:00Z");
  const seedReady = async () => {
    await addTenant("htla", { billing_switched_at: new Date("2031-05-01T00:00:00Z") });
    await client`INSERT INTO public.hosted_text_billing_state ${client({ tenant_slug: "htla", customer_id: "cus_htla", subscription_id: "sub_htla",
      billable_from: new Date("2031-05-10T20:00:00Z"), boundary_kind: "created", next_usage_date: "2031-05-10", meter_item_id: "si_a", lifecycle_state: "ready" })}`;
    stub.subs.set("sub_htla", { id: "sub_htla", customer: "cus_htla", status: "active", created: Date.parse("2031-05-10T20:00:00Z") / 1000,
      trial_start: null, trial_end: null, metadata: { tenantSlug: "htla", purpose: "uptempo_hosted_plan" },
      items: { data: [{ id: "si_a", created: 1, metadata: {}, price: { id: "price_texts", lookup_key: "hosted_texts_metered" } }], has_more: false } });
    await client.unsafe(`INSERT INTO tenant_htla.sms_messages (message_sid, status, created_at) VALUES ('SMpaid', 'sent', '2031-05-10T22:00:00Z')`);
  };
  const readState = async () => (await client`SELECT * FROM public.hosted_text_billing_state WHERE tenant_slug = 'htla'`)[0]!;
  const readReport = async () => (await client`SELECT * FROM public.sms_usage_reports WHERE tenant_slug = 'htla'`)[0]!;
  const runReport = () => usage.reportSmsUsage("2031-05-10", { now: reportNow });

  it("quarantines paid pause/resume durably, preserves facts after history expires, and reports no interval", async () => {
    await seedReady();
    const old = await readState(); const sub = stub.subs.get("sub_htla")!;
    sub.status = "paused";
    expect(await lifecycle.reconcileHostedTextMeter("htla", { now: () => reportNow })).toMatchObject({ outcome: "unsupported" });
    sub.status = "active";
    expect(await lifecycle.reconcileHostedTextMeter("htla", { now: () => new Date("2031-07-01T00:00:00Z") })).toMatchObject({ outcome: "unresolved" });
    expect(await runReport()).toMatchObject({ held: ["htla"], reported: [] });
    expect(await readState()).toEqual({ ...old, lifecycle_state: "unresolved" });
    expect([stub.meterEvents.length, await readReport()]).toEqual([0, undefined]);
  });

  it.each(["paused", "trialing"])("recovers a missed later %s event from history with a persisted boundary", async (status) => {
    await seedReady(); const sub = stub.subs.get("sub_htla")!;
    stub.events.push({ id: "evt_later", type: `customer.subscription.${status === "paused" ? "paused" : "updated"}`,
      created: Date.parse("2031-05-10T21:00:00Z") / 1000, data: { object: { ...sub, status } } });
    expect(await lifecycle.reconcileHostedTextMeter("htla", { now: () => reportNow })).toMatchObject({ outcome: "unsupported" });
    expect((await readState()).lifecycle_state).toBe("unresolved");
    await runReport(); expect(stub.meterEvents).toHaveLength(0);
  });

  it.each(["quarantine", "paused", "comped", "customer", "subscription", "meter", "off", "uncommitted"])("holds a pending immutable winner after %s changes", async (change) => {
    await seedReady(); stub.failMeter = 1;
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runReport()).toMatchObject({ failed: ["htla"] });
      const old = await readReport();
      if (change === "quarantine") await client`UPDATE public.hosted_text_billing_state SET lifecycle_state = 'unresolved'`;
      if (change === "paused") stub.subs.get("sub_htla")!.status = "paused";
      if (change === "comped") await client`UPDATE public.tenants SET comped = 1`;
      if (change === "customer") await client`UPDATE public.tenants SET platform_stripe_customer_id = 'cus_other'`;
      if (change === "subscription") await client`UPDATE public.tenants SET stripe_subscription_id = 'sub_other'`;
      if (change === "meter") await client`UPDATE public.hosted_text_billing_state SET meter_item_id = 'si_other'`;
      if (change === "off") await client`UPDATE public.tenants SET sms_line_status = 'off'`;
      if (change === "uncommitted") await client`UPDATE public.tenants SET billing_switched_at = NULL`;
      await runReport();
      expect([await readReport(), (await readState()).next_usage_date, stub.meterEvents.length]).toEqual([old, old.usage_date, 0]);
    } finally { logger.mockRestore(); }
  });

  it("rechecks a hold recorded during provider inventory and never freezes even a zero day", async () => {
    await seedReady(); await client.unsafe("DELETE FROM tenant_htla.sms_messages");
    stub.onInventory = async () => { await client`UPDATE public.hosted_text_billing_state SET lifecycle_state = 'unresolved'`; };
    expect(await runReport()).toMatchObject({ held: ["htla"] });
    expect([await readReport(), stub.meterEvents.length, (await readState()).next_usage_date]).toEqual([undefined, 0, new Date("2031-05-10T00:00:00Z")]);
  });

  it("retries the same frozen winner despite source changes and cannot downgrade submitted success", async () => {
    await seedReady(); stub.failMeter = 1;
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await runReport(); } finally { logger.mockRestore(); }
    const old = await readReport();
    await client.unsafe(`INSERT INTO tenant_htla.sms_messages (message_sid, status, created_at) VALUES ('SMlate', 'sent', '2031-05-10T23:00:00Z')`);
    await Promise.all([runReport(), runReport()]);
    const submitted = await readReport();
    expect(submitted).toMatchObject({ ...old, report_status: "submitted", reported_at: reportNow });
    expect(new Set(stub.meterEvents.map((e) => JSON.stringify(e))).size).toBe(1);
    expect(stub.meterEvents[0]!.params.payload).toEqual({ stripe_customer_id: "cus_htla", value: "1" });
    expect(await usage.drizzleUsageReportStore.markUncertain(old.id)).toBe(false);
  });


  const missedPauseResume = () => {
    const sub = stub.subs.get("sub_htla")!;
    for (const [type, status, time] of [["paused", "paused", "2031-05-10T21:00:00Z"], ["resumed", "active", "2031-05-10T23:00:00Z"]]) {
      stub.events.push({ id: `evt_missed_${type}`, type: `customer.subscription.${type}`, created: Date.parse(time!) / 1000,
        data: { object: { ...sub, status } } });
    }
  };

  it.each(["staff", "licensed_price"])("independently validates missed pause/resume after %s sync fails first", async (failure) => {
    await seedReady(); missedPauseResume();
    await client`UPDATE public.tenants SET status = 'active', onboarding_steps = '{"launched":true}'::jsonb`;
    const old = await readState();
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      if (failure === "staff") syncBillableStaff.mockRejectedValueOnce(new Error("synthetic staff sync failure"));
      // The provider double offers no licensed catalog prices, so that real sync path fails before lifecycle.
      const { reconcileHostedBilling } = await import("./reconcile");
      expect(await reconcileHostedBilling()).toMatchObject({ failed: ["htla"], textMeterAttention: [] });
      expect(await readState()).toEqual(old);
      expect(await runReport()).toMatchObject({ held: ["htla"], reported: [] });
      expect(await readState()).toEqual({ ...old, lifecycle_state: "unresolved" });
      expect([stub.meterEvents.length, await readReport()]).toEqual([0, undefined]);
    } finally { logger.mockRestore(); }
  });

  it("independently validates each reporting tenant after a global cron reconcile crash", async () => {
    await seedReady(); missedPauseResume(); const old = await readState();
    const reconcile = await import("./reconcile");
    const crash = vi.spyOn(reconcile, "reconcileHostedBilling").mockRejectedValueOnce(new Error("synthetic global reconcile failure"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(reportNow); vi.stubEnv("CRON_SECRET", "synthetic-cron-test-value");
    try {
      const { GET } = await import("@/app/api/cron/report-sms-usage/route");
      const response = await GET(new Request("http://localhost/api/cron/report-sms-usage", { headers: { authorization: "Bearer synthetic-cron-test-value" } }));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ reconcileError: "hosted_reconcile_failed", usage: { held: ["htla"], reported: [] } });
      expect(await readState()).toEqual({ ...old, lifecycle_state: "unresolved" });
      expect([stub.meterEvents.length, await readReport()]).toEqual([0, undefined]);
    } finally { crash.mockRestore(); logger.mockRestore(); vi.useRealTimers(); vi.unstubAllEnvs(); }
  });


  it.each(["comped", "switch", "customer", "subscription", "off", "newer_operation"])("locks fresh tenant/intent after provider-await %s drift without dispatch", async (change) => {
    await seedReady();
    const operation = { v: 1 as const, id: "4f0e2b7c-1d2a-4b3c-8d4e-5f6a7b8c9d0e", kind: "attach" as const,
      preparedAtMs: reportNow.getTime(), customerId: "cus_htla", subscriptionId: "sub_htla", priceId: "price_texts" };
    await client`UPDATE public.hosted_text_billing_state SET lifecycle_state = 'activating', meter_item_id = NULL,
      meter_operation_id = ${lifecycle.serializeMeterOperation(operation)}`;
    (stub.subs.get("sub_htla")!.items as { data: unknown[] }).data = [];
    let current: Record<string, unknown>;
    stub.onInventory = async () => {
      if (change === "comped") await client`UPDATE public.tenants SET comped = 1`;
      if (change === "switch") await client`UPDATE public.tenants SET billing_switched_at = NULL`;
      if (change === "customer") await client`UPDATE public.tenants SET platform_stripe_customer_id = 'cus_changed'`;
      if (change === "subscription") await client`UPDATE public.tenants SET stripe_subscription_id = 'sub_changed'`;
      if (change === "off") await client`UPDATE public.tenants SET sms_line_status = 'off'`;
      if (change === "newer_operation") await client`UPDATE public.hosted_text_billing_state SET meter_operation_id = ${lifecycle.serializeMeterOperation({ ...operation, id: "5f0e2b7c-1d2a-4b3c-8d4e-5f6a7b8c9d0e" })}`;
      current = await readState(); stub.onInventory = null;
    };
    expect(await lifecycle.reconcileHostedTextMeter("htla", { now: () => reportNow })).toMatchObject({ outcome: "pending" });
    expect([stub.keys.size, await readState()]).toEqual([0, current!]);
    expect((stub.subs.get("sub_htla")!.items as { data: unknown[] }).data).toHaveLength(0);
  });

});
