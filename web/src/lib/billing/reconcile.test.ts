import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  single: false,
  rows: [] as Array<{
    slug: string;
    subscriptionId: string | null;
    billingSwitchedAt: Date | null;
  }>,
}));
const syncBillableStaff = vi.hoisted(() => vi.fn());
const ensureHostedSubscription = vi.hoisted(() => vi.fn());
const syncHostedSubscription = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/billing/billable-staff", () => ({ syncBillableStaff }));
vi.mock("@/lib/billing/subscriptions", () => ({
  ensureHostedSubscription,
  syncHostedSubscription,
}));
// The query's WHERE clause (not comped, active, launched) is exercised by the
// integration test; here the db hands back already-filtered rows.
vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({ from: () => ({ where: async () => state.rows }) }),
  },
}));

import { reconcileHostedBilling } from "./reconcile";

beforeEach(() => {
  state.single = false;
  state.rows = [];
  syncBillableStaff.mockReset().mockResolvedValue(undefined);
  ensureHostedSubscription.mockReset().mockResolvedValue({ subscriptionId: "sub_new", status: "trialing" });
  syncHostedSubscription.mockReset().mockResolvedValue({ created: 0, updated: 0, removed: 0 });
});

describe("reconcileHostedBilling", () => {
  it("does nothing in single mode", async () => {
    state.single = true;
    state.rows = [{ slug: "a", subscriptionId: null, billingSwitchedAt: new Date() }];
    expect(await reconcileHostedBilling()).toEqual({ checked: 0, created: [], synced: [], failed: [] });
    expect(syncBillableStaff).not.toHaveBeenCalled();
  });

  it("creates a missing subscription with the full trial", async () => {
    state.rows = [{ slug: "a", subscriptionId: null, billingSwitchedAt: new Date() }];
    const res = await reconcileHostedBilling();
    expect(res).toEqual({ checked: 1, created: ["a"], synced: [], failed: [] });
    expect(syncBillableStaff).toHaveBeenCalledWith("a");
    expect(ensureHostedSubscription).toHaveBeenCalledWith("a", { trialDays: 14 });
    expect(syncHostedSubscription).not.toHaveBeenCalled();
  });

  it("syncs an existing subscription", async () => {
    state.rows = [{ slug: "b", subscriptionId: "sub_1", billingSwitchedAt: null }];
    const res = await reconcileHostedBilling();
    expect(res).toEqual({ checked: 1, created: [], synced: ["b"], failed: [] });
    expect(syncHostedSubscription).toHaveBeenCalledWith("b");
    expect(ensureHostedSubscription).not.toHaveBeenCalled();
  });

  it("does not count a skipped create as created", async () => {
    state.rows = [{ slug: "a", subscriptionId: null, billingSwitchedAt: new Date() }];
    ensureHostedSubscription.mockResolvedValue({ skipped: "exists" });
    expect((await reconcileHostedBilling()).created).toEqual([]);
  });

  it("does not trial-create a legacy tenant before the switch", async () => {
    state.rows = [{ slug: "legacy", subscriptionId: null, billingSwitchedAt: null }];
    const res = await reconcileHostedBilling();
    expect(res).toEqual({ checked: 1, created: [], synced: [], failed: [] });
    expect(ensureHostedSubscription).not.toHaveBeenCalled();
    expect(syncHostedSubscription).not.toHaveBeenCalled();
  });

  it("keeps going after one business throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.rows = [
      { slug: "bad", subscriptionId: "sub_bad", billingSwitchedAt: null },
      { slug: "good", subscriptionId: "sub_good", billingSwitchedAt: null },
    ];
    syncHostedSubscription.mockImplementation(async (slug: string) => {
      if (slug === "bad") throw new Error("stripe down");
      return { created: 0, updated: 0, removed: 0 };
    });
    const res = await reconcileHostedBilling();
    expect(res).toEqual({ checked: 2, created: [], synced: ["good"], failed: ["bad"] });
    errorSpy.mockRestore();
  });
});
