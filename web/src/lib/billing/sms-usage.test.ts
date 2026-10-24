import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const h = vi.hoisted(() => ({
  /** Tenant texts: sid, status, and send time. */
  texts: [] as Array<{ sid: string | null; status: string; at: Date }>,
  meterCreated: 0,
  subscriptionStatus: "active",
  meterEvents: [] as Array<{ params: Record<string, unknown>; options: Record<string, unknown> }>,
  meterFailures: [] as Array<"before" | "after">,
}));
const meterCreate = vi.hoisted(() => vi.fn());
const retrieveInventory = vi.hoisted(() => vi.fn());
const reconcileMeter = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/hosted-text-lifecycle", () => ({ reconcileHostedTextMeter: reconcileMeter }));

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => false }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => ({ billing: { meterEvents: { create: meterCreate } } }) }));
vi.mock("@/lib/billing/subscriptions", () => ({ retrieveHostedSubscriptionInventory: retrieveInventory }));
// Capture the exact UTC window countBilledTexts asks for.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...conditions: unknown[]) => ({ conditions }),
  gte: (_column: unknown, value: unknown) => ({ gte: value }),
  lt: (_column: unknown, value: unknown) => ({ lt: value }),
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, callback: (db: unknown, tables: unknown) => unknown) => callback({
    select: () => ({ from: () => ({ where: ({ conditions }: { conditions: Array<{ gte?: Date; lt?: Date }> }) => {
      const start = conditions.find((condition) => condition.gte)!.gte!;
      const end = conditions.find((condition) => condition.lt)!.lt!;
      return [{ count: h.texts.filter((text) => text.sid && text.status !== "failed" && text.at >= start && text.at < end).length }];
    } }) }),
  }, { smsMessages: {} }),
}));

import {
  hasMeteredItem,
  meterEventTimestamp,
  reportSmsUsage,
  setUsageReportStoreForTests,
  type UsageCandidate,
  type UsageReportStore,
  type UsageRow,
} from "./sms-usage";

// In-memory report store with the 0038 trigger rules: frozen dispatch facts
// and immutable submitted rows.
const rows = new Map<string, UsageRow>();
let candidate: UsageCandidate;
const faults = { failSubmit: 0 };
const FACTS = ["id", "tenantSlug", "usageDate", "quantity", "meterEventIdentifier", "customerId", "subscriptionId", "meterEventTimestamp", "firstAttemptAt"] as const;
function transition(id: string, from: string[], patch: Partial<UsageRow>): boolean {
  const row = [...rows.values()].find((candidateRow) => candidateRow.id === id);
  if (!row || !from.includes(row.reportStatus)) return false;
  const next = { ...row, ...patch };
  if (row.reportStatus === "submitted" || FACTS.some((key) => String(next[key]) !== String(row[key]))) throw new Error("23514 immutable");
  rows.set(`${row.tenantSlug}|${row.usageDate}`, next);
  return true;
}
const memoryStore: UsageReportStore = {
  current: async () => structuredClone(candidate),
  candidates: async (through) => (candidate.nextUsageDate <= through ? [structuredClone(candidate)] : []),
  read: async (slug, date) => structuredClone(rows.get(`${slug}|${date}`) ?? null),
  insert: async (values) => {
    const key = `${values.tenantSlug}|${values.usageDate}`;
    if (!rows.has(key)) {
      if (values.reportStatus !== "submitted" && FACTS.some((fact) => fact !== "id" && values[fact] == null)) throw new Error("dispatch facts check");
      rows.set(key, { id: crypto.randomUUID(), reportedAt: null, customerId: null, subscriptionId: null, meterEventTimestamp: null,
        firstAttemptAt: null, meterEventIdentifier: null, reportStatus: "submitted", ...values } as UsageRow);
    }
    return structuredClone(rows.get(key)!);
  },
  markSubmitted: async (id, at) => {
    if (faults.failSubmit-- > 0) throw new Error("fake DB failure after provider success");
    return transition(id, ["pending", "uncertain"], { reportStatus: "submitted", reportedAt: at });
  },
  markUncertain: async (id) => transition(id, ["pending"], { reportStatus: "uncertain" }),
  advanceCursor: async (slug, through) => {
    if (candidate.lifecycleState !== "ready") return;
    let cursor = candidate.nextUsageDate;
    while (cursor <= through && rows.get(`${slug}|${cursor}`)?.reportStatus === "submitted") {
      cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    candidate.nextUsageDate = cursor;
  },
};

const D = "2027-01-18";
const NEXT = "2027-01-19";
const at = (iso: string) => new Date(iso);
const text = (iso: string, sid: string | null = "SM", status = "delivered") => h.texts.push({ sid, status, at: at(iso) });
const row = (date: string) => rows.get(`acme|${date}`);
const report = (date: string, now = "2027-01-20T02:00:00Z") => reportSmsUsage(date, { now: at(now) });

beforeEach(() => {
  rows.clear();
  memoryStore.current = async () => structuredClone(candidate);
  Object.assign(h, { texts: [], meterCreated: Date.parse("2027-01-18T23:59:10Z") / 1000, subscriptionStatus: "active", meterEvents: [], meterFailures: [] });
  faults.failSubmit = 0;
  reconcileMeter.mockReset().mockResolvedValue({ outcome: "ready" });
  candidate = {
    slug: "acme", customerId: "cus_1", subscriptionId: "sub_1", tenantCustomerId: "cus_1", tenantSubscriptionId: "sub_1",
    billableFrom: at("2027-01-18T23:59:00Z"), nextUsageDate: D, lifecycleState: "ready", meterItemId: "si_meter",
    billingNoticeSentAt: null, billingSwitchedAt: at("2026-10-01T00:00:00Z"),
  };
  meterCreate.mockReset().mockImplementation(async (params: Record<string, unknown>, options: Record<string, unknown>) => {
    const failure = h.meterFailures.shift();
    if (failure === "before") throw new Error("fake meter network failure");
    h.meterEvents.push({ params, options });
    if (failure === "after") throw new Error("fake meter lost response");
    return { identifier: params.identifier };
  });
  retrieveInventory.mockReset().mockImplementation(async () => ({
    status: h.subscriptionStatus,
    items: { data: [{ id: "si_meter", created: h.meterCreated, price: { lookup_key: "hosted_texts_metered" } }], has_more: false },
  }));
  setUsageReportStoreForTests(memoryStore);
});
afterEach(() => setUsageReportStoreForTests());

describe("hasMeteredItem", () => {
  const sub = (...lookupKeys: Array<string | null>) =>
    ({ items: { data: lookupKeys.map((k) => ({ price: { lookup_key: k } })) } }) as unknown as Stripe.Subscription;
  it("is true only with the metered texts price", () => {
    expect(hasMeteredItem(sub("hosted_base_monthly", "hosted_texts_metered"))).toBe(true);
    expect(hasMeteredItem(sub("hosted_base_monthly", null))).toBe(false);
    expect(hasMeteredItem(sub())).toBe(false);
  });
});

describe("reportSmsUsage date validation", () => {
  it.each(["2030-1-5", "2030-02-30", "yesterday", "", "2030-13-01", "2030-01-01T00:00:00Z"])("rejects %j", async (bad) => {
    await expect(reportSmsUsage(bad)).rejects.toThrow(/Invalid usage date/);
  });
  it("rejects today and later", async () => {
    await expect(report("2027-01-20")).rejects.toThrow(/before today/);
  });
});

describe("reportSmsUsage", () => {
  it("bills texts exactly from the persisted boundary, keeping activation-day paid texts and trial texts free", async () => {
    text("2027-01-18T23:58:59.999Z");
    text("2027-01-18T23:59:00.000Z");
    text("2027-01-18T23:59:59.999Z");
    text("2027-01-18T23:59:30Z", null, "queued");
    text("2027-01-18T23:59:40Z", "SM", "failed");
    text("2027-01-19T00:00:00.000Z");
    expect(await report(NEXT)).toMatchObject({ reported: ["acme"], held: [], failed: [] });
    expect(h.meterEvents.map((event) => event.params)).toEqual([
      { event_name: "uptempo_texts", payload: { stripe_customer_id: "cus_1", value: "2" }, identifier: `acme:${D}`, timestamp: meterEventTimestamp(D) },
      { event_name: "uptempo_texts", payload: { stripe_customer_id: "cus_1", value: "1" }, identifier: `acme:${NEXT}`, timestamp: meterEventTimestamp(NEXT) },
    ]);
    expect(h.meterEvents[0]!.options).toEqual({ idempotencyKey: `hosted-usage-v1:${row(D)!.id}`, timeout: 30_000, maxNetworkRetries: 0 });
    expect(meterEventTimestamp(D)).toBe(Date.parse("2027-01-18T23:59:59Z") / 1000);
    expect([row(D)!.reportStatus, row(NEXT)!.reportStatus, candidate.nextUsageDate]).toEqual(["submitted", "submitted", "2027-01-20"]);
  });

  it("keeps paid usage pending with no row while the meter is missing, and never shifts a later-attached day", async () => {
    text("2027-01-18T23:59:30Z");
    text("2027-01-19T12:00:00Z");
    candidate.lifecycleState = "activating";
    expect(await report(NEXT)).toMatchObject({ held: ["acme"], reported: [] });
    expect([rows.size, candidate.nextUsageDate, meterCreate.mock.calls.length]).toEqual([0, D, 0]);
    candidate.lifecycleState = "ready";
    h.meterCreated = Date.parse("2027-01-19T00:00:30Z") / 1000;
    expect(await report(NEXT)).toMatchObject({ held: ["acme"] });
    expect([row(D), row(NEXT)?.reportStatus, candidate.nextUsageDate]).toEqual([undefined, "submitted", D]);
    expect(h.meterEvents.map((event) => event.params.timestamp)).toEqual([meterEventTimestamp(NEXT)]);
  });

  it("catches up every pending date through the requested day and submits proven zero days without the provider", async () => {
    candidate.billableFrom = at("2027-01-15T08:00:00Z");
    candidate.nextUsageDate = "2027-01-15";
    h.meterCreated = Date.parse("2027-01-15T08:00:05Z") / 1000;
    text("2027-01-17T10:00:00Z");
    expect(await report(NEXT)).toMatchObject({ reported: ["acme"] });
    expect(["2027-01-15", "2027-01-16", "2027-01-17", D, NEXT].map((date) => [row(date)?.reportStatus, row(date)?.quantity])).toEqual([
      ["submitted", 0], ["submitted", 0], ["submitted", 1], ["submitted", 0], ["submitted", 0],
    ]);
    expect([meterCreate.mock.calls.length, row(D)!.meterEventIdentifier, candidate.nextUsageDate]).toEqual([1, null, "2027-01-20"]);
  });

  it("holds a cursor older than the 30-day window instead of advancing over it", async () => {
    candidate.nextUsageDate = "2026-12-01";
    expect(await report(NEXT)).toMatchObject({ held: ["acme"] });
    expect([row("2026-12-01"), row("2026-12-21")?.reportStatus, candidate.nextUsageDate]).toEqual([undefined, "submitted", "2026-12-01"]);
  });

  it("posts the winning row's frozen count, never this worker's recount", async () => {
    text("2027-01-18T23:59:30Z");
    await memoryStore.insert({ tenantSlug: "acme", usageDate: D, quantity: 7, meterEventIdentifier: `acme:${D}`, reportStatus: "pending",
      reportedAt: null, customerId: "cus_1", subscriptionId: "sub_1", meterEventTimestamp: meterEventTimestamp(D), firstAttemptAt: at("2027-01-20T01:00:00Z") });
    await report(D);
    expect(h.meterEvents.map((event) => event.params.payload)).toEqual([{ stripe_customer_id: "cus_1", value: "7" }]);
    expect(row(D)).toMatchObject({ quantity: 7, reportStatus: "submitted" });
  });

  it("replays the identical request after provider success and a DB failure within 23 hours", async () => {
    text("2027-01-18T23:59:30Z");
    faults.failSubmit = 1;
    expect(await report(D)).toMatchObject({ failed: ["acme"] });
    const pending = structuredClone(row(D)!);
    expect([pending.reportStatus, pending.reportedAt, candidate.nextUsageDate]).toEqual(["pending", null, D]);
    text("2027-01-18T23:59:50Z");
    expect(await report(D, "2027-01-20T22:59:59Z")).toMatchObject({ reported: ["acme"] });
    const [first, second] = h.meterEvents;
    expect(second).toEqual(first);
    expect(row(D)).toMatchObject({ ...pending, reportStatus: "submitted", reportedAt: at("2027-01-20T22:59:59Z") });
  });

  it("marks an unconfirmed row uncertain after 23 hours and never replays or resets it", async () => {
    text("2027-01-18T23:59:30Z");
    h.meterFailures.push("before");
    expect(await report(D)).toMatchObject({ failed: ["acme"] });
    expect(await report(D, "2027-01-21T01:00:00Z")).toMatchObject({ held: ["acme"] });
    expect(await report(D, "2027-01-21T02:00:00Z")).toMatchObject({ held: ["acme"] });
    expect([row(D)!.reportStatus, row(D)!.quantity, meterCreate.mock.calls.length, candidate.nextUsageDate]).toEqual(["uncertain", 1, 1, D]);
  });

  it("settles concurrent workers on one frozen row without letting a failure downgrade success", async () => {
    text("2027-01-18T23:59:30Z");
    h.meterFailures.push("before");
    const results = await Promise.all([report(D), report(D)]);
    expect(results.map((result) => (result.failed.length ? "failed" : result.reported.length ? "reported" : "other")).sort()).toEqual(["failed", "reported"]);
    expect(new Set(meterCreate.mock.calls.map((call) => JSON.stringify(call))).size).toBe(1);
    expect(row(D)).toMatchObject({ reportStatus: "submitted", quantity: 1 });
    const submitted = structuredClone(row(D));
    expect(await report(D)).toMatchObject({ reported: [], failed: [] });
    expect([row(D), meterCreate.mock.calls.length]).toEqual([submitted, 2]);
  });

  it("intersects with the legacy switch boundary and waits for a committed switch marker", async () => {
    candidate.billableFrom = at("2027-01-18T00:00:00Z");
    candidate.billingNoticeSentAt = at("2026-11-01T14:00:00Z");
    candidate.billingSwitchedAt = at("2027-01-18T12:00:00Z");
    h.meterCreated = Date.parse("2027-01-18T12:00:05Z") / 1000;
    text("2027-01-18T11:59:59Z");
    text("2027-01-18T12:00:00Z");
    expect(await report(D)).toMatchObject({ reported: ["acme"] });
    expect(row(D)!.quantity).toBe(1);
    rows.clear();
    candidate.nextUsageDate = D;
    candidate.billingSwitchedAt = null;
    expect(await report(D)).toMatchObject({ skipped: ["acme"] });
    expect(rows.size).toBe(0);
  });

  it.each([
    ["a binding that no longer matches the tenant", (): void => void (candidate.tenantSubscriptionId = "sub_other"), "failed"],
    ["a paused subscription", (): void => void (h.subscriptionStatus = "paused"), "held"],
  ] as const)("fails closed on %s without posting", async (_name, setup, bucket) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    text("2027-01-18T23:59:30Z");
    setup();
    expect((await report(D))[bucket]).toEqual(["acme"]);
    expect([meterCreate.mock.calls.length, row(D)]).toEqual([0, undefined]);
    errorSpy.mockRestore();
  });
});


describe("fresh pending dispatch readiness", () => {
  it.each(["quarantine", "paused", "comped", "customer", "subscription", "meter", "boundary"])("retains the frozen pending row after %s changes", async (change) => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    text("2027-01-18T23:59:30Z"); h.meterFailures.push("before");
    await report(D);
    const frozen = structuredClone(row(D));
    const posts = meterCreate.mock.calls.length;
    if (change === "quarantine") candidate.lifecycleState = "unresolved";
    if (change === "paused") h.subscriptionStatus = "paused";
    if (change === "comped") memoryStore.current = async () => null;
    if (change === "customer") candidate.tenantCustomerId = "cus_changed";
    if (change === "subscription") candidate.tenantSubscriptionId = "sub_changed";
    if (change === "meter") candidate.meterItemId = "si_changed";
    if (change === "boundary") retrieveInventory.mockImplementationOnce(async () => { candidate.billableFrom = at("2027-01-18T23:59:20Z"); return { status: "active", items: { data: [{ id: "si_meter", created: h.meterCreated, price: { lookup_key: "hosted_texts_metered" } }] } }; });
    await report(D);
    expect([meterCreate.mock.calls.length, row(D), candidate.nextUsageDate]).toEqual([posts, frozen, D]);
    logger.mockRestore();
  });
  it("rechecks a quarantine recorded during the awaited provider read", async () => {
    text("2027-01-18T23:59:30Z");
    retrieveInventory.mockImplementation(async () => {
      candidate.lifecycleState = "unresolved";
      return { status: "active", items: { data: [{ id: "si_meter", created: h.meterCreated, price: { lookup_key: "hosted_texts_metered" } }] } };
    });
    expect(await report(D)).toMatchObject({ held: ["acme"] });
    expect([rows.size, meterCreate.mock.calls.length, candidate.nextUsageDate]).toEqual([0, 0, D]);
  });
  it("cannot freeze a zero row or advance over quarantined usage", async () => {
    candidate.lifecycleState = "unresolved";
    expect(await report(D)).toMatchObject({ held: ["acme"] });
    expect([rows.size, candidate.nextUsageDate]).toEqual([0, D]);
  });
  it("rejects the winning row's customer and subscription mismatch", async () => {
    await memoryStore.insert({ tenantSlug: "acme", usageDate: D, quantity: 7, meterEventIdentifier: `acme:${D}`, reportStatus: "pending",
      customerId: "cus_other", subscriptionId: "sub_other", meterEventTimestamp: meterEventTimestamp(D), firstAttemptAt: at("2027-01-20T01:00:00Z") });
    await report(D);
    expect([meterCreate.mock.calls.length, row(D)!.reportStatus, candidate.nextUsageDate]).toEqual([0, "pending", D]);
  });
  it("uses fixed error logging classifications for propagated provider errors", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    text("2027-01-18T23:59:30Z");
    retrieveInventory.mockRejectedValue(new Error("synthetic-private-canary"));
    await report(D);
    const logs = logger.mock.calls.flat().map((v) => v instanceof Error ? v.message : String(v)).join(" "); logger.mockRestore();
    expect(logs.includes("synthetic-private-canary")).toBe(false);
  });
});

it("holds the cursor over existing submitted rows when the lifecycle is quarantined", async () => {
  await memoryStore.insert({ tenantSlug: "acme", usageDate: D, quantity: 0, meterEventIdentifier: null, reportStatus: "submitted", reportedAt: at("2027-01-20T00:00:00Z") });
  candidate.lifecycleState = "unresolved";
  expect(await report(D)).toMatchObject({ held: ["acme"] });
  expect(candidate.nextUsageDate).toBe(D);
});


it.each(["unresolved", "unsupported", "pending", "uncertain", "free", "stopped", "skipped", "throws"])("independently rejects canonical lifecycle result %s before reporting", async (outcome) => {
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  text("2027-01-18T23:59:30Z");
  if (outcome === "throws") reconcileMeter.mockRejectedValue(new Error("synthetic-private-canary"));
  else reconcileMeter.mockResolvedValue({ outcome });
  const result = await report(D);
  logger.mockRestore();
  expect(reconcileMeter).toHaveBeenCalledWith("acme", expect.objectContaining({ now: expect.any(Function) }));
  expect(result.reported).toEqual([]);
  expect([rows.size, meterCreate.mock.calls.length, candidate.nextUsageDate]).toEqual([0, 0, D]);
});
