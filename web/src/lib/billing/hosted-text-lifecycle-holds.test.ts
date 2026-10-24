import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const h = vi.hoisted(() => ({ inventory: vi.fn(), update: vi.fn(), del: vi.fn(), events: vi.fn() }));
vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => false }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => ({ subscriptions: { update: h.update }, subscriptionItems: { del: h.del }, events: { list: h.events } }) }));
vi.mock("@/lib/billing/subscriptions", () => ({ retrieveHostedSubscriptionInventory: h.inventory, resolvePriceIds: async () => new Map([["hosted_texts_metered", "price_meter"]]) }));
import { reconcileHostedTextMeter, serializeMeterOperation, setHostedTextStoreForTests, type HostedTextState, type HostedTextTenant } from "./hosted-text-lifecycle";
let state: HostedTextState;
let tenant: HostedTextTenant;
let sub: Stripe.Subscription;
let history: Stripe.Event[];
const boundary = new Date("2031-05-10T10:00:00Z");
const initialNow = new Date("2031-05-11T02:00:00Z");
let now: Date;
const operation = (kind: "attach" | "detach") => serializeMeterOperation({ v: 1, id: "4f0e2b7c-1d2a-4b3c-8d4e-5f6a7b8c9d0e", kind,
  preparedAtMs: initialNow.getTime(), customerId: "cus_a", subscriptionId: "sub_a", priceId: "price_meter", ...(kind === "detach" ? { meterItemId: "si_meter" } : {}) });
const event = (type: string, status: string, seconds = 60) => ({ id: `evt_${status}`, type, created: boundary.getTime() / 1000 + seconds,
  data: { object: { ...sub, status } } }) as Stripe.Event;
const reconcile = (e?: Stripe.Event) => reconcileHostedTextMeter("acme", { now: () => now, event: e });
beforeEach(() => {
  now = initialNow;
  tenant = { slug: "acme", comped: 0, billingSwitchedAt: boundary, smsLineStatus: "active", customerId: "cus_a", subscriptionId: "sub_a" };
  state = { tenantSlug: "acme", customerId: "cus_a", subscriptionId: "sub_a", billableFrom: boundary, boundaryKind: "created", boundaryEventId: null,
    meterItemId: "si_meter", meterOperationId: null, nextUsageDate: "2031-05-10", lifecycleState: "ready" };
  sub = { id: "sub_a", customer: "cus_a", status: "active", created: boundary.getTime() / 1000, trial_start: null, trial_end: null,
    metadata: { tenantSlug: "acme", purpose: "uptempo_hosted_plan" }, items: { data: [{ id: "si_meter", created: boundary.getTime() / 1000,
      price: { id: "price_meter", lookup_key: "hosted_texts_metered" }, metadata: {} }], has_more: false } } as unknown as Stripe.Subscription;
  history = [];
  h.inventory.mockReset().mockImplementation(async () => structuredClone(sub));
  h.events.mockReset().mockImplementation(async () => ({ data: history, has_more: false }));
  h.update.mockReset().mockRejectedValue(new Error("synthetic transport failure"));
  h.del.mockReset().mockRejectedValue(new Error("synthetic transport failure"));
  setHostedTextStoreForTests({ readTenant: async () => structuredClone(tenant), readState: async () => structuredClone(state),
    locked: async (_slug, decide) => { const d = decide(structuredClone(tenant), structuredClone(state)); if (d.patch) Object.assign(state, d.patch); return d.result; } });
});
afterEach(() => setHostedTextStoreForTests());
it("quarantines a later pause/resume durably without erasing paid or operation facts", async () => {
  const old = structuredClone(state);
  sub.status = "paused";
  expect(await reconcile(event("customer.subscription.paused", "paused"))).toMatchObject({ outcome: "unsupported" });
  expect(state).toEqual({ ...old, lifecycleState: "unresolved" });
  sub.status = "active";
  history = [event("customer.subscription.paused", "paused"), event("customer.subscription.resumed", "active", 120)];
  expect(await reconcile()).toMatchObject({ outcome: "unresolved" });
  now = new Date("2031-07-01T00:00:00Z"); history = [];
  expect(await reconcile()).toMatchObject({ outcome: "unresolved" });
  expect(state).toEqual({ ...old, lifecycleState: "unresolved" });
});
it.each(["paused", "trialing"])("recovers a missed later %s transition despite a persisted boundary", async (status) => {
  history = [event(status === "paused" ? "customer.subscription.paused" : "customer.subscription.updated", status)];
  expect(await reconcile()).toMatchObject({ outcome: "unsupported" });
  expect(state.lifecycleState).toBe("unresolved");
  expect(h.events).toHaveBeenCalled();
});
it("queries retained recent events for old boundaries and holds incomplete history", async () => {
  now = new Date("2031-07-01T00:00:00Z");
  h.events.mockResolvedValue({ data: [], has_more: true });
  expect(await reconcile()).toMatchObject({ outcome: "unresolved" });
  expect(state.lifecycleState).toBe("unresolved");
  expect(h.events.mock.calls[0]![0].created.gte).toBeGreaterThan(boundary.getTime() / 1000);
});
it("evaluates unsupported transitions before proving a pending attach complete", async () => {
  state.lifecycleState = "activating"; state.meterItemId = null; state.meterOperationId = operation("attach");
  sub.items.data[0]!.metadata = { hostedMeterOperationId: JSON.parse(state.meterOperationId).id };
  const old = structuredClone(state);
  sub.status = "paused";
  expect(await reconcile()).toMatchObject({ outcome: "unsupported" });
  expect(state).toEqual({ ...old, lifecycleState: "unresolved" });
  expect(h.update).not.toHaveBeenCalled();
});
it.each([null, "hosted_base_monthly"])("never proves a pending detach absent through lookup drift %s", async (lookup) => {
  state.lifecycleState = "activating"; state.meterOperationId = operation("detach"); tenant.smsLineStatus = "off";
  sub.items.data[0]!.price.lookup_key = lookup;
  const receipt = state.meterOperationId;
  await expect(reconcile()).rejects.toThrow(/transport/);
  expect(state).toMatchObject({ lifecycleState: "activating", meterItemId: "si_meter", meterOperationId: receipt });
  tenant.smsLineStatus = "active";
  now = new Date(initialNow.getTime() + 24 * 3600_000);
  expect(await reconcile()).toMatchObject({ outcome: "uncertain" });
  expect(state.meterOperationId).toBe(receipt);
  expect(h.update).not.toHaveBeenCalled();
});
it("holds an attach marker whose frozen price now has a different lookup key", async () => {
  state.lifecycleState = "activating"; state.meterItemId = null; state.meterOperationId = operation("attach");
  sub.items.data[0]!.metadata = { hostedMeterOperationId: JSON.parse(state.meterOperationId).id };
  sub.items.data[0]!.price.lookup_key = "hosted_base_monthly";
  expect(await reconcile()).toMatchObject({ outcome: "unsupported" });
  expect(state.lifecycleState).toBe("unresolved");
  expect(h.update).not.toHaveBeenCalled();
});

it("recovers an ordinary known-boundary wait when the subscription becomes active", async () => {
  state.lifecycleState = "stopped"; state.meterItemId = null; sub.items.data = []; sub.status = "past_due";
  expect(await reconcile()).toMatchObject({ outcome: "pending" });
  expect(state.lifecycleState).toBe("stopped");
  sub.status = "active";
  h.update.mockImplementation(async (_id, params) => { sub.items.data.push({ id: "si_new", created: 1, metadata: params.items[0].metadata,
    price: { id: "price_meter", lookup_key: "hosted_texts_metered" } } as never); return sub; });
  expect(await reconcile()).toEqual({ outcome: "ready" });
  expect(state).toMatchObject({ billableFrom: boundary, meterItemId: "si_new" });
});
it("preserves a durable hold on a transiently unreadable ready lifecycle history", async () => {
  h.events.mockRejectedValue(new Error("synthetic-private-canary"));
  await expect(reconcile()).rejects.toThrow();
  expect(state.lifecycleState).toBe("unresolved");
});

it("records an ownership conflict hold even when a concurrent report advances the cursor", async () => {
  h.events.mockImplementation(async () => {
    state.nextUsageDate = "2031-05-11";
    const conflicting = event("customer.subscription.updated", "active");
    (conflicting.data.object as Stripe.Subscription).metadata.tenantSlug = "another_tenant";
    return { data: [conflicting], has_more: false };
  });
  expect(await reconcile()).toMatchObject({ outcome: "unsupported" });
  expect(state).toMatchObject({ lifecycleState: "unresolved", nextUsageDate: "2031-05-11", billableFrom: boundary });
});
it("detects a later pause carried only by a subscription.updated event", async () => {
  history = [event("customer.subscription.updated", "paused")];
  expect(await reconcile()).toMatchObject({ outcome: "unsupported" });
  expect(state.lifecycleState).toBe("unresolved");
});

it("cannot attach over a conflicting unmarked meter while an attach is pending", async () => {
  state.lifecycleState = "activating"; state.meterItemId = null; state.meterOperationId = operation("attach");
  expect(await reconcile()).toMatchObject({ outcome: "unsupported" });
  expect(state.lifecycleState).toBe("unresolved");
  expect(h.update).not.toHaveBeenCalled();
});
it("proves a drifted detach after an ambiguous response before starting a new attach", async () => {
  state.lifecycleState = "activating"; state.meterOperationId = operation("detach"); tenant.smsLineStatus = "off";
  sub.items.data[0]!.price.lookup_key = null;
  h.del.mockImplementation(async (id) => { sub.items.data = sub.items.data.filter((item) => item.id !== id); throw new Error("synthetic lost response"); });
  expect(await reconcile()).toEqual({ outcome: "stopped" });
  expect(h.del).toHaveBeenCalledTimes(1);
  expect([sub.items.data.length, state.meterItemId]).toEqual([0, null]);
  tenant.smsLineStatus = "active";
  h.update.mockImplementation(async (_id, params) => { sub.items.data.push({ id: "si_new", created: 1, metadata: params.items[0].metadata,
    price: { id: "price_meter", lookup_key: "hosted_texts_metered" } } as never); return sub; });
  expect(await reconcile()).toEqual({ outcome: "ready" });
  expect([sub.items.data.length, state.meterItemId, h.update.mock.calls.length]).toEqual([1, "si_new", 1]);
});


it.each(["comped", "switch", "customer", "subscription", "off", "state_binding", "newer_operation"])("rechecks %s drift under the tenant/state lock before pending mutation", async (change) => {
  state.lifecycleState = "activating"; state.meterItemId = null; state.meterOperationId = operation("attach"); sub.items.data = [];
  let afterDrift: HostedTextState;
  h.inventory.mockImplementation(async () => {
    if (change === "comped") tenant.comped = 1;
    if (change === "switch") tenant.billingSwitchedAt = null;
    if (change === "customer") tenant.customerId = "cus_changed";
    if (change === "subscription") tenant.subscriptionId = "sub_changed";
    if (change === "off") tenant.smsLineStatus = "off";
    if (change === "state_binding") state.customerId = "cus_changed";
    if (change === "newer_operation") state.meterOperationId = operation("detach");
    afterDrift = structuredClone(state);
    return structuredClone(sub);
  });
  await reconcile().catch(() => null);
  expect([h.update.mock.calls.length, h.del.mock.calls.length]).toEqual([0, 0]);
  expect(state).toEqual(afterDrift!);
});


it("finishes the immutable pending detach when texts turn on before dispatch, then proves a new attach", async () => {
  state.lifecycleState = "activating"; state.meterOperationId = operation("detach"); tenant.smsLineStatus = "off";
  const detach = state.meterOperationId;
  h.inventory.mockImplementation(async () => { tenant.smsLineStatus = "active"; return structuredClone(sub); });
  h.del.mockImplementation(async (id) => { sub.items.data = sub.items.data.filter((item) => item.id !== id); return {}; });
  h.update.mockImplementation(async (_id, params) => { sub.items.data.push({ id: "si_new", created: 1, metadata: params.items[0].metadata,
    price: { id: "price_meter", lookup_key: "hosted_texts_metered" } } as never); return sub; });
  expect(await reconcile()).toEqual({ outcome: "ready" });
  expect(h.del).toHaveBeenCalledWith("si_meter", { proration_behavior: "none" }, expect.objectContaining({ idempotencyKey: `hosted-meter-v1:${JSON.parse(detach).id}` }));
  expect([sub.items.data.map((item) => item.id), h.update.mock.calls.length]).toEqual([["si_new"], 1]);
  expect(state.meterOperationId).not.toBe(detach);
});
