import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state: {
    tenant: Record<string, unknown> | null;
    existingRows: unknown[];
    fees: number;
    revenue: number;
  } = { tenant: null, existingRows: [], fees: 0, revenue: 0 };

  const paymentIntentsCreate = vi.fn(async () => ({
    id: "pi_test",
    status: "succeeded",
  }));
  const insertValues = vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => {}) }));

  const publicDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => state.existingRows }),
      }),
    }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };

  return { state, paymentIntentsCreate, insertValues, publicDb };
});

vi.mock("@/lib/db", () => ({ publicDb: h.publicDb }));
vi.mock("@/lib/db/schema", () => ({
  tenants: {},
  platformCharges: { tenantSlug: "tenant_slug", periodStart: "period_start" },
}));
vi.mock("@/lib/auth/rbac", () => ({ requireRole: vi.fn(async () => {}) }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: vi.fn(async () => "s") }));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: vi.fn(async () => h.state.tenant),
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(async () => ({
    feesCollectedCents: h.state.fees,
    revenueCents: h.state.revenue,
  })),
}));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({ paymentIntents: { create: h.paymentIntentsCreate } }),
}));

import { billTenantForPeriod } from "@/lib/services/platform-billing";

const PERIOD = {
  start: new Date("2026-06-01T00:00:00Z"),
  end: new Date("2026-07-01T00:00:00Z"),
};

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    slug: "s",
    name: "Salon",
    plan: "pro", // 1%
    platformFeePercent: null,
    billingEnabled: 1,
    platformStripeCustomerId: "cus_1",
    platformPaymentMethodId: "pm_1",
    ...overrides,
  };
}

describe("billTenantForPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.tenant = tenant();
    h.state.existingRows = [];
    h.state.fees = 0;
    h.state.revenue = 0;
    h.paymentIntentsCreate.mockResolvedValue({ id: "pi_test", status: "succeeded" });
  });

  it("does nothing for a tenant that isn't billing-enabled", async () => {
    h.state.tenant = tenant({ billingEnabled: 0 });
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("not_enabled");
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns already_charged when the period succeeded before", async () => {
    h.state.existingRows = [{ status: "succeeded", amountChargedCents: 5000 }];
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("already_charged");
    expect(r.amountChargedCents).toBe(5000);
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("skips (no charge) when fees already met the floor", async () => {
    h.state.fees = 6_000; // > $50 floor at 1%
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("skipped");
    expect(r.amountChargedCents).toBe(0);
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("records no_payment_method when a top-up is due but there's no card", async () => {
    h.state.fees = 1_000;
    h.state.tenant = tenant({ platformPaymentMethodId: null });
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("no_payment_method");
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("charges the floor top-up to the platform card (no Connect transfer)", async () => {
    h.state.fees = 1_000; // top-up = 5000 - 1000 = 4000
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("succeeded");
    expect(r.amountChargedCents).toBe(4_000);

    expect(h.paymentIntentsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = h.paymentIntentsCreate.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(params.amount).toBe(4_000);
    expect(params.off_session).toBe(true);
    expect(params.confirm).toBe(true);
    expect(params.customer).toBe("cus_1");
    expect(params.payment_method).toBe("pm_1");
    expect(params).not.toHaveProperty("transfer_data");
    expect((params.metadata as Record<string, string>).purpose).toBe("platform_fee");
    expect(opts.idempotencyKey).toContain("platform-fee:s:2026-06-01");
  });

  it("records a failure when the charge is declined", async () => {
    h.state.fees = 0;
    h.paymentIntentsCreate.mockRejectedValueOnce(new Error("card_declined"));
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("card_declined");
  });

  it("exempt tenant (0%) is skipped with no charge", async () => {
    h.state.tenant = tenant({ platformFeePercent: 0 });
    h.state.fees = 0;
    const r = await billTenantForPeriod("s", PERIOD);
    expect(r.status).toBe("skipped");
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled();
  });
});
