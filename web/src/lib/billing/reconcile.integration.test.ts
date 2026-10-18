import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * DB-backed: checks the real tenant filter (not comped, active, launched) with
 * scratch tenants and mocked billing calls. Skipped without DATABASE_URL.
 */

const syncBillableStaff = vi.hoisted(() => vi.fn());
const ensureHostedSubscription = vi.hoisted(() => vi.fn());
const syncHostedSubscription = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => false }));
vi.mock("@/lib/billing/billable-staff", () => ({ syncBillableStaff }));
vi.mock("@/lib/billing/subscriptions", () => ({
  ensureHostedSubscription,
  syncHostedSubscription,
}));

describe.skipIf(!process.env.DATABASE_URL)("reconcileHostedBilling (db)", () => {
  let tenantsTable: typeof import("@/lib/db/schema").tenants;
  let publicDb: typeof import("@/lib/db").publicDb;
  let reconcileHostedBilling: typeof import("./reconcile").reconcileHostedBilling;
  let scratch: import("@/lib/scheduling/db-fixtures").ScratchTenant;

  // One scratch tenant (provisioning is heavy), moved through each state.
  async function setState(set: {
    onboardingSteps: Record<string, boolean>;
    comped: number;
    stripeSubscriptionId: string | null;
    billingSwitchedAt: Date | null;
  }) {
    await publicDb
      .update(tenantsTable)
      .set(set)
      .where(eq(tenantsTable.slug, scratch.slug));
  }

  beforeAll(async () => {
    ({ publicDb } = await import("@/lib/db"));
    ({ tenants: tenantsTable } = await import("@/lib/db/schema"));
    ({ reconcileHostedBilling } = await import("./reconcile"));
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    scratch = await scratchTenant("reconcile");
  }, 120_000);

  beforeEach(() => {
    syncBillableStaff.mockReset().mockResolvedValue(undefined);
    ensureHostedSubscription.mockReset().mockResolvedValue({ subscriptionId: "sub_x", status: "trialing" });
    syncHostedSubscription.mockReset().mockResolvedValue({ created: 0, updated: 0, removed: 0 });
  });

  afterAll(async () => {
    await scratch?.drop();
  });

  it("creates a subscription for a launched business without one", async () => {
    await setState({ onboardingSteps: { launched: true }, comped: 0, stripeSubscriptionId: null, billingSwitchedAt: new Date() });
    const res = await reconcileHostedBilling();
    expect(res.created).toContain(scratch.slug);
    expect(ensureHostedSubscription).toHaveBeenCalledWith(scratch.slug, { trialDays: 14 });
    expect(syncHostedSubscription).not.toHaveBeenCalledWith(scratch.slug);
  });

  it("syncs a launched business that has a subscription", async () => {
    await setState({
      onboardingSteps: { launched: true },
      comped: 0,
      stripeSubscriptionId: `sub_rec_${Date.now()}`,
      billingSwitchedAt: null,
    });
    const res = await reconcileHostedBilling();
    expect(res.synced).toContain(scratch.slug);
    expect(syncHostedSubscription).toHaveBeenCalledWith(scratch.slug);
    expect(ensureHostedSubscription).not.toHaveBeenCalledWith(scratch.slug, expect.anything());
  });

  it("skips a comped business", async () => {
    await setState({ onboardingSteps: { launched: true }, comped: 1, stripeSubscriptionId: null, billingSwitchedAt: null });
    const res = await reconcileHostedBilling();
    expect(res.created).not.toContain(scratch.slug);
    expect(syncBillableStaff).not.toHaveBeenCalledWith(scratch.slug);
  });

  it("skips a business that has not launched", async () => {
    await setState({ onboardingSteps: {}, comped: 0, stripeSubscriptionId: null, billingSwitchedAt: null });
    const res = await reconcileHostedBilling();
    expect(res.created).not.toContain(scratch.slug);
    expect(syncBillableStaff).not.toHaveBeenCalledWith(scratch.slug);
  });

  it("does not create a trial for a legacy launched business before notice switch", async () => {
    await setState({
      onboardingSteps: { launched: true },
      comped: 0,
      stripeSubscriptionId: null,
      billingSwitchedAt: null,
    });
    const res = await reconcileHostedBilling();
    expect(res.created).not.toContain(scratch.slug);
    expect(ensureHostedSubscription).not.toHaveBeenCalledWith(
      scratch.slug,
      expect.anything(),
    );
  });
});
