import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * DB-backed: needs DATABASE_URL. Runs against a throwaway scratch tenant so it
 * works in CI's test-db job (and `npm run test:db`); skipped without a DB.
 */

const syncHostedSubscription = vi.fn();
const isSingleMode = vi.fn(() => false);

vi.mock("@/lib/billing/subscriptions", () => ({
  syncHostedSubscription: (...args: unknown[]) => syncHostedSubscription(...args),
}));
vi.mock("@/lib/config/mode", () => ({
  isSingleMode: () => isSingleMode(),
}));

let SLUG = "";

describe.skipIf(!process.env.DATABASE_URL)("syncBillableStaff (db)", () => {
  let publicDb: typeof import("@/lib/db").publicDb;
  let tenants: typeof import("@/lib/db/schema").tenants;
  let withTenantDb: typeof import("@/lib/db/tenant").withTenantDb;
  let syncBillableStaff: typeof import("./billable-staff").syncBillableStaff;
  let scratch: import("@/lib/scheduling/db-fixtures").ScratchTenant;

  async function storedCount(): Promise<number> {
    const [row] = await publicDb
      .select({ n: tenants.billableStaff })
      .from(tenants)
      .where(eq(tenants.slug, SLUG));
    return row.n;
  }

  async function addStaff(role: "provider" | "assistant"): Promise<string> {
    const id = await withTenantDb(SLUG, async (db, { staff }) => {
      const [row] = await db
        .insert(staff)
        .values({ displayName: `billable-test-${role}`, role })
        .returning({ id: staff.id });
      return row.id;
    });
    return id;
  }

  beforeAll(async () => {
    ({ publicDb } = await import("@/lib/db"));
    ({ tenants } = await import("@/lib/db/schema"));
    ({ withTenantDb } = await import("@/lib/db/tenant"));
    ({ syncBillableStaff } = await import("./billable-staff"));
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    scratch = await scratchTenant("billablestaff");
    SLUG = scratch.slug;
    // Start from a synced baseline so the cases only see their own changes.
    await syncBillableStaff(SLUG);
  });

  beforeEach(() => {
    syncHostedSubscription.mockReset();
    isSingleMode.mockReset();
    isSingleMode.mockReturnValue(false);
  });

  afterAll(async () => {
    if (scratch) await scratch.drop();
  });

  it("walks provider and assistant changes through the sync", async () => {
    const base = await storedCount();

    const providerId = await addStaff("provider");
    await syncBillableStaff(SLUG);
    expect(await storedCount()).toBe(base + 1);
    expect(syncHostedSubscription).toHaveBeenCalledTimes(1);
    expect(syncHostedSubscription).toHaveBeenCalledWith(SLUG);

    syncHostedSubscription.mockClear();
    await addStaff("assistant");
    await syncBillableStaff(SLUG);
    expect(await storedCount()).toBe(base + 1);
    expect(syncHostedSubscription).not.toHaveBeenCalled();

    await withTenantDb(SLUG, async (db, { staff }) => {
      await db.update(staff).set({ isActive: 0 }).where(eq(staff.id, providerId));
    });
    await syncBillableStaff(SLUG);
    expect(await storedCount()).toBe(base);
    expect(syncHostedSubscription).toHaveBeenCalledTimes(1);

    syncHostedSubscription.mockClear();
    await syncBillableStaff(SLUG);
    expect(syncHostedSubscription).not.toHaveBeenCalled();
  });

  it("does nothing in single mode", async () => {
    const base = await storedCount();
    await addStaff("provider");
    isSingleMode.mockReturnValue(true);
    await syncBillableStaff(SLUG);
    expect(await storedCount()).toBe(base);
    expect(syncHostedSubscription).not.toHaveBeenCalled();
  });

  it("swallows Stripe failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      syncHostedSubscription.mockRejectedValue(new Error("stripe down"));
      await addStaff("provider");
      await expect(syncBillableStaff(SLUG)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
