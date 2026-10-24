import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_PLAN_PURPOSE } from "@/lib/billing/hosted-catalog";

type Item = { id: string; created: number; quantity?: number; metadata: Record<string, string>; price: { id: string; lookup_key: string } };
type Settings = { end_behavior: { missing_payment_method: string } } | null;
type Sub = Record<string, unknown> & {
  id: string; customer: string; status: string; created: number; trial_start: number | null; trial_end: number | null;
  trial_settings: Settings; metadata: Record<string, string>; items: Item[];
};
type Params = Record<string, unknown>;
type Options = { idempotencyKey?: string } | undefined;

/**
 * Stateful Stripe double: subscriptions, items, events, and idempotent
 * results. Like API 2026-02-25.clover it rejects a metered item create or
 * update while the trial-end pause setting is retained.
 */
const fake = vi.hoisted(() => {
  const s = {
    seq: 0, pageSize: 100, paymentMethod: false, resumeSticks: true,
    prices: {} as Record<string, string>,
    /** Price id -> lookup key; a replaced catalog price keeps its old id. */
    lookups: {} as Record<string, string>,
    customers: [] as Params[], subs: [] as Sub[], events: [] as Params[],
    keys: new Map<string, { body: string; result: unknown }>(),
    writes: [] as Array<{ method: string; id?: string; params: unknown; key?: string }>,
    failures: [] as Array<{ method: string; when: "before" | "after" }>,
    holds: new Map<string, Promise<void>>(),
  };
  const nowS = () => Math.floor(Date.now() / 1000);
  const clone = <T>(value: T): T => structuredClone(value);
  /** Pause the next call of `method` until the returned release runs. */
  const hold = (method: string) => {
    let release!: () => void;
    s.holds.set(method, new Promise<void>((resolve) => { release = resolve; }));
    return () => release();
  };
  const waitHold = async (method: string) => void (await [s.holds.get(method), s.holds.delete(method)][0]);
  const fail = (code: string, statusCode = 400) =>
    Object.assign(new Error(code), { type: "StripeInvalidRequestError", code, statusCode, requestId: "req_fake" });
  const isMetered = (price: unknown) => s.lookups[String(price)] === "hosted_texts_metered";
  const paused = (settings: Settings) => settings?.end_behavior?.missing_payment_method === "pause";
  const rejectMeter = () => fail("pause_at_trial_end_rejects_metered_item_create_or_update");
  const sub = (id: string) => s.subs.find((row) => row.id === id) ?? (() => { throw fail("resource_missing", 404); })();
  const owner = (itemId: string) => s.subs.find((row) => row.items.some((entry) => entry.id === itemId));
  const item = (price: unknown, params: Params = {}): Item => ({
    id: `si_${++s.seq}`, created: nowS(), ...(params.quantity !== undefined ? { quantity: params.quantity as number } : {}),
    metadata: { ...(params.metadata as Record<string, string>) }, price: { id: String(price), lookup_key: s.lookups[String(price)] ?? "" },
  });
  const page = <T extends { id: string }>(rows: T[], after?: string) => {
    const start = after ? rows.findIndex((row) => row.id === after) + 1 : 0;
    return { object: "list", data: clone(rows.slice(start, start + s.pageSize)), has_more: start + s.pageSize < rows.length };
  };
  const view = (row: Sub) => ({ ...clone(row), items: page(row.items) });
  const emit = (type: string, row: Sub, previous?: Params, created = nowS()) => {
    const object: Params = clone(row);
    delete object.items;
    s.events.push({ id: `evt_${++s.seq}`, object: "event", type, created, data: { object, ...(previous ? { previous_attributes: previous } : {}) } });
  };
  /** Idempotent replay, injected failures, holds, and a record of applied writes. */
  async function call<T>(method: string, id: string | undefined, params: unknown, options: Options, apply: () => T): Promise<T> {
    await waitHold(method);
    const key = options?.idempotencyKey;
    const body = JSON.stringify([id, params]);
    const prior = key ? s.keys.get(key) : undefined;
    if (prior && prior.body !== body) throw fail("idempotency_error");
    if (prior) return clone(prior.result as T);
    const index = s.failures.findIndex((candidate) => candidate.method === method);
    const mode = index >= 0 ? s.failures.splice(index, 1)[0]!.when : null;
    if (mode === "before") throw Object.assign(new Error("fake network failure"), { type: "StripeConnectionError" });
    const result = apply();
    s.writes.push({ method, id, params: clone(params), key });
    if (key) s.keys.set(key, { body, result: clone(result) });
    if (mode === "after") throw Object.assign(new Error("fake lost response"), { type: "StripeConnectionError" });
    return clone(result);
  }
  /** Move the system clock and process trial ends like Stripe does. */
  function advance(seconds: number) {
    vi.setSystemTime(Date.now() + seconds * 1000);
    for (const row of s.subs.filter((candidate) => candidate.status === "trialing" && candidate.trial_end! <= nowS())) {
      row.status = s.paymentMethod || !paused(row.trial_settings) ? "active" : "paused";
      if (row.status === "paused") emit("customer.subscription.paused", row, undefined, row.trial_end!);
      emit("customer.subscription.updated", row, { status: "trialing" }, row.trial_end!);
    }
  }
  const stripe = {
    customers: {
      retrieve: vi.fn(async (id: string) => clone(s.customers.find((customer) => customer.id === id))),
      update: vi.fn(async (id: string, params: Params) => clone(Object.assign(s.customers.find((customer) => customer.id === id)!, params))),
    },
    prices: {
      list: vi.fn(async (params: { lookup_keys: string[] }) => ({
        data: params.lookup_keys.filter((key) => s.prices[key]).map((key) => ({ id: s.prices[key], lookup_key: key })),
      })),
    },
    subscriptions: {
      create: vi.fn(async (params: Params, options?: Options) => call("subscriptions.create", undefined, params, options, () => {
        const items = (params.items as Params[]).map((entry) => item(entry.price, entry));
        const settings = (params.trial_settings as Settings) ?? null;
        if (paused(settings) && items.some((entry) => isMetered(entry.price.id))) throw rejectMeter();
        const days = Number(params.trial_period_days ?? 0);
        const row: Sub = {
          id: `sub_${++s.seq}`, customer: String(params.customer), status: days > 0 ? "trialing" : "active", created: nowS(),
          trial_start: days > 0 ? nowS() : null, trial_end: days > 0 ? nowS() + days * 86_400 : null, trial_settings: settings,
          metadata: params.metadata as Record<string, string>, default_payment_method: null, default_source: null, items,
        };
        s.subs.push(row);
        emit("customer.subscription.created", row);
        return view(row);
      })),
      retrieve: vi.fn(async (id: string) => {
        await waitHold("subscriptions.retrieve");
        return view(sub(id));
      }),
      list: vi.fn(async (params: { customer: string }) => ({ data: s.subs.filter((row) => row.customer === params.customer).map(view), has_more: false })),
      update: vi.fn(async (id: string, params: Params, options?: Options) => call("subscriptions.update", id, params, options, () => {
        const row = sub(id);
        const settings = (params.trial_settings as Settings) ?? row.trial_settings;
        const added = ((params.items as Params[]) ?? []).filter((entry) => !entry.id);
        if (paused(settings) && added.some((entry) => isMetered(entry.price))) throw rejectMeter();
        const { trial_end: trialEnd, ...rest } = params;
        delete rest.items;
        Object.assign(row, rest, { trial_settings: settings });
        row.items.push(...added.map((entry) => item(entry.price, entry)));
        const converts = trialEnd === "now" && row.status === "trialing";
        if (converts) Object.assign(row, { status: "active", trial_end: nowS() });
        emit("customer.subscription.updated", row, converts ? { status: "trialing" } : {});
        return view(row);
      })),
      resume: vi.fn(async (id: string, params: Params) => call("subscriptions.resume", id, params, undefined, () => {
        const row = sub(id);
        if (row.status !== "paused") throw fail("subscription_not_paused");
        // resumeSticks=false: Stripe acknowledges, but the subscription stays paused.
        if (!s.resumeSticks) return { ...view(row), status: "active" };
        row.status = "active";
        emit("customer.subscription.resumed", row);
        emit("customer.subscription.updated", row, { status: "paused" });
        return view(row);
      })),
    },
    subscriptionItems: {
      list: vi.fn(async (params: { subscription: string; starting_after?: string }) => page(sub(params.subscription).items, params.starting_after)),
      create: vi.fn(async (params: Params, options?: Options) => call("subscriptionItems.create", String(params.subscription), params, options, () => {
        const row = sub(String(params.subscription));
        if (paused(row.trial_settings) && isMetered(params.price)) throw rejectMeter();
        const created = item(params.price, params);
        row.items.push(created);
        return created;
      })),
      update: vi.fn(async (id: string, params: Params) => call("subscriptionItems.update", id, params, undefined, () => {
        const row = owner(id)!;
        const target = row.items.find((entry) => entry.id === id)!;
        if (paused(row.trial_settings) && isMetered(target.price.id)) throw rejectMeter();
        return Object.assign(target, params);
      })),
      del: vi.fn(async (id: string, params: Params, options?: Options) => call("subscriptionItems.del", id, params, options, () => {
        const row = owner(id) ?? (() => { throw fail("resource_missing", 404); })();
        row.items = row.items.filter((entry) => entry.id !== id);
        return { id, deleted: true };
      })),
    },
    events: {
      list: vi.fn(async (params: { types: string[]; created?: { gte?: number }; starting_after?: string }) => page(s.events
        .filter((event) => params.types.includes(String(event.type)) && Number(event.created) >= (params.created?.gte ?? 0))
        .sort((a, b) => Number(b.created) - Number(a.created) || String(b.id).localeCompare(String(a.id), "en", { numeric: true })) as Array<{ id: string }>,
      params.starting_after)),
    },
  };
  return { s, stripe, advance, hold, nowS };
});

const db = vi.hoisted(() => ({ tenant: null as Record<string, unknown> | null, single: false }));

vi.mock("@/lib/stripe/server", () => ({ getStripe: () => fake.stripe }));
vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => db.single }));
vi.mock("@/lib/db", () => ({ publicDb: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => (db.tenant ? [db.tenant] : []) }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => void Object.assign(db.tenant ?? {}, values) }) }),
} }));

import { publicDb } from "@/lib/db";
import { parseMeterOperation, reconcileHostedTextMeter, serializeMeterOperation, setHostedTextStoreForTests } from "@/lib/billing/hosted-text-lifecycle";
import type { HostedTextState, HostedTextStore, HostedTextTenant } from "@/lib/billing/hosted-text-lifecycle";
import { ensureHostedSubscription, resetHostedPriceCacheForTests, syncHostedSubscription } from "@/lib/billing/subscriptions";

const [METER, DAY] = ["hosted_texts_metered", 86_400];
const keysOf = (row: Sub | undefined) => (row?.items ?? []).map((entry) => entry.price.lookup_key).sort();

// In-memory DB surface: serialized transactions emulate the tenant/state row locks.
const states = new Map<string, HostedTextState>();
/** failAt/crashAt: absolute lock number that throws before/after applying its decision. */
const faults = { failAt: 0, crashAt: 0 };
let lockCount = 0;
let lockChain: Promise<unknown> = Promise.resolve();
const tenantView = () => db.tenant && ({ ...db.tenant, customerId: db.tenant.platformStripeCustomerId, subscriptionId: db.tenant.stripeSubscriptionId }) as HostedTextTenant;
const memoryStore: HostedTextStore = {
  readTenant: async () => structuredClone(tenantView()),
  readState: async (slug) => structuredClone(states.get(slug) ?? null),
  locked(slug, decide) {
    const run = lockChain.then(() => {
      if (++lockCount === faults.failAt) throw new Error("fake DB failure");
      const tenant = tenantView();
      const current = states.get(slug) ?? null;
      const { insert, patch, result } = decide(structuredClone(tenant), structuredClone(current));
      const base: HostedTextState | null = insert && !current && tenant ? { tenantSlug: slug, customerId: tenant.customerId!, subscriptionId: tenant.subscriptionId!,
        billableFrom: null, boundaryKind: null, boundaryEventId: null, meterItemId: null, meterOperationId: null, nextUsageDate: null, lifecycleState: "unresolved" } : current;
      const next = base && (insert || patch) ? { ...base, ...patch } : null;
      if (next?.lifecycleState === "ready" && (!next.billableFrom || !next.meterItemId)) throw new Error("hosted_text_ready_check");
      if (next) states.set(slug, next);
      if (lockCount === faults.crashAt) throw new Error("fake crash after commit");
      return result;
    });
    lockChain = run.catch(() => undefined);
    return run;
  },
};

const state = () => states.get("acme")!;
const sub = () => fake.s.subs[0]!;
const reconcile = (event?: unknown) => reconcileHostedTextMeter("acme", event ? { event: event as never } : {});
const writes = (method: string) => fake.s.writes.filter((entry) => entry.method === method);
const meterItemsOf = () => sub().items.filter((entry) => entry.price.lookup_key === METER);
const opOf = () => JSON.parse(state().meterOperationId!) as Record<string, unknown>;
const meter = (id: string, marker?: string): Item =>
  ({ id, created: fake.nowS(), metadata: marker ? { hostedMeterOperationId: marker } : {}, price: { id: "price_texts", lookup_key: METER } });
async function failAttachOnce() {
  fake.s.failures.push({ method: "subscriptions.update", when: "before" });
  await expect(reconcile()).rejects.toThrow(/fake network failure/);
}
async function paidTrial({ card = true, texts = "active" } = {}) {
  db.tenant!.smsLineStatus = texts;
  await ensureHostedSubscription("acme", { trialDays: 14 });
  fake.s.paymentMethod = card;
  fake.advance(14 * DAY + 60);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-04T10:00:00Z"));
  vi.clearAllMocks();
  const prices = { hosted_base_monthly: "price_base", hosted_extra_staff_monthly: "price_extra", hosted_text_line_monthly: "price_line", [METER]: "price_texts" };
  Object.assign(fake.s, {
    seq: 0, pageSize: 100, paymentMethod: false, resumeSticks: true, prices, subs: [], events: [], writes: [], failures: [],
    lookups: Object.fromEntries(Object.entries(prices).map(([key, id]) => [id, key])), keys: new Map(), holds: new Map(),
    customers: [{ id: "cus_1", email: null, metadata: { tenantSlug: "acme", purpose: HOSTED_PLAN_PURPOSE }, invoice_settings: { default_payment_method: null }, default_source: null }],
  });
  resetHostedPriceCacheForTests();
  states.clear();
  Object.assign(faults, { failAt: 0, crashAt: 0 });
  lockCount = 0;
  setHostedTextStoreForTests(memoryStore);
  db.single = false;
  db.tenant = {
    slug: "acme", name: "Acme", status: "active", comped: 0, billableStaff: 2, smsLineStatus: "active",
    billingSwitchedAt: new Date("2026-10-01T00:00:00Z"), billingNoticeSentAt: null,
    platformStripeCustomerId: "cus_1", stripeSubscriptionId: null, subscriptionStatus: null,
  };
});
afterEach(() => {
  vi.useRealTimers();
  setHostedTextStoreForTests();
});

describe("stateful Stripe double", () => {
  it("rejects a meter create or update while the trial-end pause is retained, and accepts it when the same update clears it", async () => {
    const pause = { end_behavior: { missing_payment_method: "pause" } };
    const rejected = { statusCode: 400, code: "pause_at_trial_end_rejects_metered_item_create_or_update" };
    await expect(fake.stripe.subscriptions.create({ customer: "cus_1", items: [{ price: "price_texts" }], trial_period_days: 14, trial_settings: pause, metadata: {} })).rejects.toMatchObject(rejected);
    const { id } = await fake.stripe.subscriptions.create({ customer: "cus_1", items: [{ price: "price_base" }], trial_period_days: 14, trial_settings: pause, metadata: {} });
    await expect(fake.stripe.subscriptionItems.create({ subscription: id, price: "price_texts" })).rejects.toMatchObject(rejected);
    await expect(fake.stripe.subscriptions.update(id, { items: [{ price: "price_texts" }] })).rejects.toMatchObject(rejected);
    const cleared = await fake.stripe.subscriptions.update(id, { trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } }, items: [{ price: "price_texts" }] });
    expect(cleared.items.data.map((entry: Item) => entry.price.lookup_key)).toContain(METER);
  });
});

describe("hosted trial creation regression (req_LZuzADg7BBQDGj)", () => {
  it("creates a 14-day text-on trial with base, extra staff, and text line only, keeping the missing-card pause", async () => {
    expect(await ensureHostedSubscription("acme", { trialDays: 14 })).toMatchObject({ status: "trialing", textMeter: { outcome: "free" } });
    expect(keysOf(sub())).toEqual(["hosted_base_monthly", "hosted_extra_staff_monthly", "hosted_text_line_monthly"]);
    expect(sub()).toMatchObject({ trial_settings: { end_behavior: { missing_payment_method: "pause" } }, metadata: { purpose: HOSTED_PLAN_PURPOSE, tenantSlug: "acme" } });
    expect(state()).toMatchObject({ lifecycleState: "free", billableFrom: null, meterOperationId: null });
  });

  it("syncs licensed items on a trialing subscription without adding the meter or ending the pause", async () => {
    db.tenant!.smsLineStatus = "off";
    await ensureHostedSubscription("acme", { trialDays: 14 });
    Object.assign(db.tenant!, { smsLineStatus: "active", billableStaff: 3 });
    expect(await syncHostedSubscription("acme")).toMatchObject({ created: 1, updated: 1, textMeter: { outcome: "free" } });
    expect(keysOf(sub())).toEqual(["hosted_base_monthly", "hosted_extra_staff_monthly", "hosted_text_line_monthly"]);
    expect(sub()).toMatchObject({ status: "trialing", trial_settings: { end_behavior: { missing_payment_method: "pause" } } });
    expect(writes("subscriptions.update")).toHaveLength(0);
  });

  it("creates a deferred zero-trial switch subscription without meter or pause, then attaches after commit", async () => {
    await ensureHostedSubscription("acme", { trialDays: 0, db: publicDb, textMeter: "defer" });
    expect([keysOf(sub()).includes(METER), sub().trial_settings, states.size]).toEqual([false, null, 0]);
    expect(await reconcile()).toEqual({ outcome: "ready" });
    expect(state()).toMatchObject({ boundaryKind: "created", billableFrom: new Date(sub().created * 1000) });
    await expect(ensureHostedSubscription("acme", { trialDays: 0, db: publicDb } as never)).rejects.toThrow(/textMeter: 'defer'/);
  });

  it("adopts an existing unmarked meter on a reconcile-mode no-trial subscription without another write", async () => {
    expect(await ensureHostedSubscription("acme", { trialDays: 0 })).toMatchObject({ status: "active", textMeter: { outcome: "ready" } });
    expect(sub().trial_settings).toBeNull();
    expect(state()).toMatchObject({ meterItemId: meterItemsOf()[0]!.id, boundaryKind: "created", meterOperationId: null });
    expect(writes("subscriptions.update")).toHaveLength(0);
  });
});

describe("durable meter operation envelope", () => {
  it("round-trips the canonical v1 envelope and fails closed on any drift", () => {
    const binding = { customerId: "cus_1", subscriptionId: "sub_1" };
    const op = { v: 1 as const, id: "4f0e2b7c-1d2a-4b3c-8d4e-5f6a7b8c9d0e", preparedAtMs: 1, kind: "attach" as const, ...binding, priceId: "price_texts" };
    const text = serializeMeterOperation(op);
    expect(parseMeterOperation(text, binding)).toEqual(op);
    const json = JSON.parse(text);
    for (const bad of [JSON.stringify({ ...json, v: 2 }), JSON.stringify({ ...json, extra: 1 }), JSON.stringify({ kind: "attach", ...json }),
      JSON.stringify({ ...json, id: "not-a-uuid" }), JSON.stringify({ ...json, meterItemId: "si_1" }), serializeMeterOperation({ ...op, kind: "detach" }), "{", null]) {
      expect(() => parseMeterOperation(bad, binding)).toThrow();
    }
    expect(() => parseMeterOperation(text, { ...binding, subscriptionId: "sub_2" })).toThrow();
  });
});

describe("hosted text lifecycle with the stateful double", () => {
  it("attaches once after a conversion just before midnight, keeping the trial_end boundary and frozen payload", async () => {
    vi.setSystemTime(new Date("2027-01-04T23:59:00Z"));
    await paidTrial();
    vi.setSystemTime(new Date("2027-01-19T00:01:00Z"));
    expect(await reconcile(fake.s.events.at(-1))).toEqual({ outcome: "ready" });
    const op = opOf();
    expect(writes("subscriptions.update")).toEqual([{ method: "subscriptions.update", id: sub().id, key: `hosted-meter-v1:${op.id}`, params: {
      trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } },
      items: [{ price: "price_texts", metadata: { hostedMeterOperationId: op.id } }], proration_behavior: "none" } }]);
    expect(fake.stripe.subscriptions.update.mock.calls[0]![2]).toEqual({ idempotencyKey: `hosted-meter-v1:${op.id}`, timeout: 30_000, maxNetworkRetries: 0 });
    expect(op).toMatchObject({ v: 1, kind: "attach", customerId: "cus_1", subscriptionId: sub().id, priceId: "price_texts" });
    expect(state()).toMatchObject({ lifecycleState: "ready", boundaryKind: "trial_end", billableFrom: new Date("2027-01-18T23:59:00Z"),
      nextUsageDate: "2027-01-18", meterItemId: meterItemsOf()[0]!.id });
    expect(await reconcile()).toEqual({ outcome: "ready" });
    expect(writes("subscriptions.update")).toHaveLength(1);
  });

  it("keeps a missing-card pause free through card collection, bills from the resume event, and converges on replayed events", async () => {
    await paidTrial({ card: false });
    expect([sub().status, await reconcile()]).toEqual(["paused", { outcome: "free" }]);
    fake.s.paymentMethod = true;
    fake.advance(3600);
    expect(await reconcile()).toEqual({ outcome: "free" });
    expect(fake.s.writes.map((entry) => entry.method)).toEqual(["subscriptions.create"]);
    await fake.stripe.subscriptions.resume(sub().id, {});
    const byType = (type: string) => fake.s.events.find((event) => event.type === `customer.subscription.${type}`)!;
    for (const event of [byType("resumed"), byType("resumed"), byType("paused"), byType("created")]) {
      expect(await reconcile(event)).toEqual({ outcome: "ready" });
    }
    expect(state()).toMatchObject({ boundaryKind: "resumed", boundaryEventId: byType("resumed").id, billableFrom: new Date(Number(byType("resumed").created) * 1000) });
    expect(state().billableFrom!.getTime()).toBeGreaterThan(sub().trial_end! * 1000);
    expect(writes("subscriptions.update")).toHaveLength(1);
  });

  it("keeps a switch resume that Stripe acknowledges but leaves paused free, recording the fresh status", async () => {
    await paidTrial({ card: false });
    fake.s.resumeSticks = false;
    const result = await ensureHostedSubscription("acme", { trialDays: 0, billingSwitch: true, ownerEmail: "owner@example.com", db: publicDb, textMeter: "defer" });
    expect([result, db.tenant!.subscriptionStatus, await reconcile(), meterItemsOf()]).toMatchObject([{ status: "paused" }, "paused", { outcome: "free" }, []]);
  });

  it.each([
    ["a lost attach response", () => fake.s.failures.push({ method: "subscriptions.update", when: "after" }), false, 1],
    ["a network failure before the POST", () => fake.s.failures.push({ method: "subscriptions.update", when: "before" }), true, 2],
    ["a crash after the intent commit", () => (faults.crashAt = lockCount + 1), true, 1],
    ["provider success followed by a settle DB failure", () => (faults.failAt = lockCount + 2), true, 1],
  ] as const)("recovers %s with one identical frozen request", async (_name, inject, firstThrows, calls) => {
    await paidTrial();
    inject();
    await (firstThrows ? expect(reconcile()).rejects.toThrow() : expect(reconcile()).resolves.toEqual({ outcome: "ready" }));
    expect(await reconcile()).toEqual({ outcome: "ready" });
    const requests = fake.stripe.subscriptions.update.mock.calls.map((call) => JSON.stringify(call));
    expect([requests.length, new Set(requests).size, meterItemsOf().length]).toEqual([calls, 1, 1]);
    expect(state().meterItemId).toBe(meterItemsOf()[0]!.id);
  });

  it("retries inside 23 hours, then turns read-only uncertain and never replaces from absence", async () => {
    await paidTrial();
    await failAttachOnce();
    const opText = state().meterOperationId;
    fake.advance(23 * 3600 - 2);
    await failAttachOnce();
    fake.advance(2);
    expect(await reconcile()).toEqual({ outcome: "uncertain", reason: "retry_window_expired" });
    expect(await reconcile()).toMatchObject({ outcome: "uncertain" });
    expect(fake.stripe.subscriptions.update).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ lifecycleState: "uncertain", meterOperationId: opText });
    sub().items.push(meter("si_late", String(opOf().id)));
    expect([await reconcile(), state().meterItemId]).toEqual([{ outcome: "ready" }, "si_late"]);
  });

  it("sends one identical request from concurrent workers and converges on one item", async () => {
    await paidTrial();
    const release = fake.hold("subscriptions.update");
    const workers = [reconcile(), reconcile()];
    await vi.waitFor(() => expect(fake.stripe.subscriptions.update).toHaveBeenCalledTimes(2));
    release();
    expect(await Promise.all(workers)).toEqual([{ outcome: "ready" }, { outcome: "ready" }]);
    const [first, second] = fake.stripe.subscriptions.update.mock.calls;
    expect([JSON.stringify(first) === JSON.stringify(second), meterItemsOf().length]).toEqual([true, 1]);
  });

  it("retries with the frozen price after a catalog lookup change", async () => {
    await paidTrial();
    await failAttachOnce();
    Object.assign(fake.s.prices, { [METER]: "price_texts_v2" });
    fake.s.lookups.price_texts_v2 = METER;
    resetHostedPriceCacheForTests();
    expect(await reconcile()).toEqual({ outcome: "ready" });
    expect(fake.stripe.subscriptions.update.mock.calls.map(([, params]) => (params as { items: Array<{ price: string }> }).items[0]!.price))
      .toEqual(["price_texts", "price_texts"]);
  });

  it("reads complete paginated history and inventory, and fails closed on cross-tenant evidence", async () => {
    await paidTrial();
    fake.s.pageSize = 1;
    for (let i = 0; i < 3; i++) await fake.stripe.subscriptions.update(sub().id, { metadata: sub().metadata });
    const conversion = fake.s.events.find((event) => (event.data as { previous_attributes?: { status?: string } }).previous_attributes?.status === "trialing")!;
    const object = (conversion.data as { object: Sub }).object;
    object.metadata = { tenantSlug: "other-tenant", purpose: HOSTED_PLAN_PURPOSE };
    expect(await reconcile()).toEqual({ outcome: "unsupported", reason: "evidence_conflict" });
    object.metadata = { tenantSlug: "acme", purpose: HOSTED_PLAN_PURPOSE };
    expect(await reconcile()).toEqual({ outcome: "ready" });
    expect(fake.stripe.events.list.mock.calls.filter(([params]) => params.starting_after).length).toBeGreaterThan(3);
    expect(fake.stripe.subscriptionItems.list).toHaveBeenCalled();
  });

  it.each([
    ["a pause after the paid boundary", async () => { await reconcile(); sub().status = "paused"; }, { outcome: "unsupported", reason: "trial_or_pause_after_paid_boundary" }],
    ["expired trial-end history", async () => fake.advance(31 * DAY), { outcome: "unresolved", reason: "history_incomplete" }],
    ["a paid but not active subscription", async () => void (sub().status = "past_due"), { outcome: "pending", reason: "subscription_not_active" }],
    ["a meter marked by an unknown operation", async () => void sub().items.push(meter("si_x", "4f0e2b7c-1d2a-4b3c-8d4e-5f6a7b8c9d0e")), { outcome: "unsupported", reason: "foreign_meter_operation" }],
    ["duplicate meter items", async () => void sub().items.push(meter("si_a"), meter("si_b")), { outcome: "unsupported", reason: "duplicate_meter_items" }],
    ["an invalid stored operation", async () => { await failAttachOnce(); state().meterOperationId = state().meterOperationId!.replace('"v":1', '"v":2'); }, { outcome: "unsupported", reason: "invalid_operation" }],
  ])("fails closed on %s without provider writes", async (_name, setup, expected) => {
    await paidTrial();
    await setup();
    const before = fake.s.writes.length;
    expect(await reconcile()).toEqual(expected);
    expect(fake.s.writes).toHaveLength(before);
  });

  it("turns texts off and on with new durable operations, keeping each receipt", async () => {
    await paidTrial();
    await reconcile();
    const [attach, firstItem] = [opOf(), state().meterItemId];
    db.tenant!.smsLineStatus = "off";
    expect(await reconcile()).toEqual({ outcome: "stopped" });
    const detach = opOf();
    expect(detach).toMatchObject({ kind: "detach", meterItemId: firstItem, priceId: "price_texts" });
    expect(writes("subscriptionItems.del")).toEqual([{ method: "subscriptionItems.del", id: firstItem, params: { proration_behavior: "none" }, key: `hosted-meter-v1:${detach.id}` }]);
    expect(state()).toMatchObject({ lifecycleState: "stopped", meterItemId: null });
    db.tenant!.smsLineStatus = "active";
    expect(await reconcile()).toEqual({ outcome: "ready" });
    expect([opOf().kind, new Set([attach.id, detach.id, opOf().id]).size, meterItemsOf().length]).toEqual(["attach", 3, 1]);
  });

  it("settles a pending attach that lands while texts are off as not ready, then detaches it", async () => {
    await paidTrial();
    await failAttachOnce();
    sub().items.push(meter("si_late", String(opOf().id)));
    db.tenant!.smsLineStatus = "off";
    expect(await reconcile()).toEqual({ outcome: "stopped" });
    expect(writes("subscriptionItems.del").map((entry) => entry.id)).toEqual(["si_late"]);
    expect(state()).toMatchObject({ lifecycleState: "stopped", meterItemId: null });
    expect(opOf()).toMatchObject({ kind: "detach", meterItemId: "si_late" });
  });

  it("does not let a stale worker settle over a newer intent", async () => {
    await paidTrial();
    const release = fake.hold("subscriptions.update");
    const stale = reconcile();
    await vi.waitFor(() => expect(fake.stripe.subscriptions.update).toHaveBeenCalledTimes(1));
    const staleOp = state().meterOperationId;
    expect(await reconcile()).toEqual({ outcome: "ready" });
    db.tenant!.smsLineStatus = "off";
    expect(await reconcile()).toEqual({ outcome: "stopped" });
    const newer = structuredClone(state());
    release();
    await expect(stale).rejects.toThrow(/not confirmed/);
    expect([state(), newer.meterOperationId !== staleOp]).toEqual([newer, true]);
  });

  it("ignores comped tenants, including nine synthetic demos, and single mode with no provider calls", async () => {
    Object.assign(db.tenant!, { comped: 1, platformStripeCustomerId: "cus_demo", stripeSubscriptionId: "sub_demo" });
    for (let demo = 1; demo <= 9; demo++) expect(await reconcileHostedTextMeter(`demo-${demo}`)).toEqual({ outcome: "skipped", reason: "comped" });
    db.single = true;
    expect(await reconcile()).toEqual({ outcome: "skipped", reason: "single_mode" });
    expect([fake.stripe.subscriptions.retrieve.mock.calls.length, fake.stripe.events.list.mock.calls.length, states.size]).toEqual([0, 0, 0]);
  });
});
