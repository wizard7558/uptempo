import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: null as Record<string, unknown> | null,
  committed: [] as Array<Record<string, unknown>>,
  order: [] as string[],
}));
const ensureHostedSubscription = vi.hoisted(() => vi.fn());
const reconcileHostedTextMeter = vi.hoisted(() => vi.fn());
const setWeeklyPayouts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/billing/subscriptions", () => ({ ensureHostedSubscription }));
vi.mock("@/lib/billing/hosted-text-lifecycle", () => ({ reconcileHostedTextMeter }));
vi.mock("@/lib/billing/billable-staff", () => ({ countBillableStaff: async () => 1 }));
vi.mock("@/lib/stripe/connect", () => ({ setWeeklyPayouts }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => ({}) }));
/** Query chains resolve to the locked tenant, one owner, and no tenant-schema rows. */
const query = (rows: () => unknown[]) => {
  const chain: Record<string, unknown> = {
    from: () => chain, innerJoin: () => chain, where: () => chain, limit: () => chain,
    for: async () => (h.tenant ? [h.tenant] : []),
    then: (resolve: (value: unknown) => unknown) => resolve(rows()),
  };
  return chain;
};
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, callback: (db: unknown, tables: unknown) => unknown) =>
    callback({ select: () => query(() => []) }, { businessSettings: {}, clientMemberships: {} }),
}));
vi.mock("@/lib/db", () => ({
  closePublicDb: async () => undefined,
  db: {},
  publicDb: {
    // Writes become visible only when the whole callback commits.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending: Array<Record<string, unknown>> = [];
      const result = await fn({
        select: () => query(() => [{ tenantSlug: "acme", role: "owner", email: "owner@example.com" }]),
        update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => void pending.push(values) }) }),
      });
      h.committed.push(...pending);
      h.order.push("commit");
      return result;
    },
  },
}));

import {
  assertBillingNoticeProviderAllowed,
  classifyTenant,
  billingNoticeRetryDeadline,
  isBillingNoticeRetryWithinProviderWindow,
  isBillingSwitchDue,
  plannedBillingSwitchAt,
  switchTenant,
  textLineIsBillable,
  type BillingNoticeTenant,
} from "./switch";

afterEach(() => {
  vi.unstubAllEnvs();
});

const tenant = (overrides: Partial<BillingNoticeTenant> = {}): BillingNoticeTenant => ({
  comped: 0,
  billingSwitchedAt: null,
  status: "active",
  ownerEmail: "owner@example.com",
  ...overrides,
});

describe("classifyTenant", () => {
  it.each([
    ["comped", tenant({ comped: 1, status: "suspended", ownerEmail: null })],
    ["switched", tenant({ billingSwitchedAt: new Date(), ownerEmail: null })],
    ["inactive", tenant({ status: "suspended", ownerEmail: null })],
    ["needs_attention", tenant({ ownerEmail: null })],
    ["paying", tenant()],
  ] as const)("returns %s with the specified precedence", (expected, input) => {
    expect(classifyTenant(input)).toBe(expected);
  });

  it("does not treat an admin address as an owner address", () => {
    expect(classifyTenant(tenant({ ownerEmail: null }))).toBe("needs_attention");
  });
});

describe("plannedBillingSwitchAt", () => {
  it("uses 14:00 UTC on the first eligible date when 60 days ends before 14:00", () => {
    const planned = plannedBillingSwitchAt(new Date("2026-10-16T13:59:00.000Z"));
    expect(planned.toISOString()).toBe("2026-12-15T14:00:00.000Z");
    expect(planned.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-10-16T13:59:00.000Z").getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  });

  it("moves to the next date when the 60-day threshold is after 14:00 UTC", () => {
    expect(
      plannedBillingSwitchAt(new Date("2026-10-16T14:01:00.000Z")).toISOString(),
    ).toBe("2026-12-16T14:00:00.000Z");
  });

  it("keeps the exact 14:00 boundary and fractional time safely after 60 days", () => {
    expect(
      plannedBillingSwitchAt(new Date("2026-10-16T14:00:00.000Z")).toISOString(),
    ).toBe("2026-12-15T14:00:00.000Z");
    expect(
      plannedBillingSwitchAt(new Date("2026-10-16T14:00:00.001Z")).toISOString(),
    ).toBe("2026-12-16T14:00:00.000Z");
  });

  it("keeps the reserved date safe when a bounded request crosses 14:00 UTC", () => {
    const requestStartedAt = new Date("2026-10-16T13:59:50.000Z");
    const requestBudgetMs = 20_000;
    const providerSuccessAt = new Date(
      requestStartedAt.getTime() + requestBudgetMs,
    );
    const switchAt = plannedBillingSwitchAt(
      new Date(requestStartedAt.getTime() + requestBudgetMs),
    );

    expect(providerSuccessAt.toISOString()).toBe("2026-10-16T14:00:10.000Z");
    expect(switchAt.toISOString()).toBe("2026-12-16T14:00:00.000Z");
    expect(switchAt.getTime()).toBeGreaterThanOrEqual(
      providerSuccessAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
    expect(billingNoticeRetryDeadline(switchAt).toISOString()).toBe(
      "2026-10-17T13:59:20.000Z",
    );
  });

  it("keeps provider retries inside the retained idempotency window", () => {
    const switchAt = new Date("2026-12-16T14:00:00.000Z");
    const deadline = billingNoticeRetryDeadline(switchAt);
    expect(isBillingNoticeRetryWithinProviderWindow(
      switchAt,
      new Date(deadline.getTime() - 1),
    )).toBe(true);
    expect(isBillingNoticeRetryWithinProviderWindow(switchAt, deadline)).toBe(
      false,
    );
  });
});

describe("textLineIsBillable", () => {
  it("bills active own lines and a shared line only when a text setting is on", () => {
    expect(textLineIsBillable("active", false)).toBe(true);
    expect(textLineIsBillable("shared", true)).toBe(true);
    expect(textLineIsBillable("shared", false)).toBe(false);
    expect(textLineIsBillable("off", true)).toBe(false);
  });
});

describe("isBillingSwitchDue", () => {
  const noticeSentAt = new Date("2026-01-01T14:00:00.000Z");
  const switchAt = new Date("2026-03-02T14:00:00.000Z");
  const eligible = {
    comped: 0,
    status: "active",
    billingNoticeSentAt: noticeSentAt,
    billingSwitchAt: switchAt,
    billingSwitchedAt: null,
  };

  it("requires the exact switch date and 60 complete days after notice", () => {
    expect(isBillingSwitchDue(eligible, new Date("2026-03-02T13:59:59.999Z"))).toBe(false);
    expect(isBillingSwitchDue(eligible, switchAt)).toBe(true);
    expect(isBillingSwitchDue({ ...eligible, billingNoticeSentAt: new Date("2026-01-02T14:00:00Z") }, switchAt)).toBe(false);
  });

  it.each([
    ["missing notice", { ...eligible, billingNoticeSentAt: null }],
    ["missing reserved switch date", { ...eligible, billingSwitchAt: null }],
    ["already switched", { ...eligible, billingSwitchedAt: new Date("2026-02-01T00:00:00Z") }],
    ["comped", { ...eligible, comped: 1 }],
    ["inactive", { ...eligible, status: "suspended" }],
  ] as const)("rejects %s", (_label, tenantState) => {
    expect(isBillingSwitchDue(tenantState, new Date("2026-04-01T00:00:00Z"))).toBe(false);
  });
});

describe("assertBillingNoticeProviderAllowed", () => {
  it("allows console only with explicit local permission and a loopback database", () => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@127.0.0.1:55439/isolated");
    expect(() => assertBillingNoticeProviderAllowed()).toThrow(/explicit local permission/);
    expect(() => assertBillingNoticeProviderAllowed(true)).not.toThrow();
  });

  it("refuses console in production, SMTP, and placeholder Resend credentials", () => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@127.0.0.1/isolated");
    expect(() => assertBillingNoticeProviderAllowed(true)).toThrow(/outside production/);

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    expect(() => assertBillingNoticeProviderAllowed()).toThrow(/SMTP is unsupported/);

    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "test");
    expect(() => assertBillingNoticeProviderAllowed()).toThrow(/non-placeholder Resend key/);
  });
});

describe("switchTenant and the hosted text meter", () => {
  const dueAt = new Date("2026-03-02T14:00:00.000Z");
  const due = () => ({
    slug: "acme", status: "active", comped: 0, processingRateBps: 320, smsLineStatus: "shared",
    stripeConnectAccountId: "acct_1", billingNoticeSentAt: new Date("2026-01-01T14:00:00.000Z"),
    billingSwitchAt: dueAt, billingSwitchedAt: null as Date | null,
  });

  beforeEach(() => {
    h.tenant = due();
    h.committed = [];
    h.order = [];
    ensureHostedSubscription.mockReset().mockResolvedValue({ subscriptionId: "sub_1", status: "active" });
    setWeeklyPayouts.mockReset().mockResolvedValue(undefined);
    reconcileHostedTextMeter.mockReset().mockImplementation(async () => {
      h.order.push("meter");
      return { outcome: "ready" };
    });
  });

  it("defers the meter inside the transaction and reconciles it only after the marker commits", async () => {
    await expect(switchTenant("acme", dueAt)).resolves.toEqual({ slug: "acme", outcome: "switched", textMeter: "ready" });
    expect(ensureHostedSubscription).toHaveBeenCalledWith("acme", expect.objectContaining({
      trialDays: 0, billingSwitch: true, ownerEmail: "owner@example.com", textMeter: "defer", db: expect.anything(),
    }));
    expect(h.committed).toContainEqual(expect.objectContaining({ billingSwitchedAt: dueAt }));
    expect(h.order).toEqual(["commit", "meter"]);
    expect(reconcileHostedTextMeter).toHaveBeenCalledWith("acme");
  });

  it("rolls back a failed switch with zero meter calls", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setWeeklyPayouts.mockRejectedValue(new Error("payout provider failure"));
    await expect(switchTenant("acme", dueAt)).rejects.toThrow(/payout provider failure/);
    expect([h.committed, h.order, reconcileHostedTextMeter.mock.calls]).toEqual([[], [], []]);
    errorSpy.mockRestore();
  });

  it("reports a committed switch with a pending meter, then repairs only the meter on retry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    reconcileHostedTextMeter.mockRejectedValueOnce(new Error("synthetic-private-canary"));
    await expect(switchTenant("acme", dueAt)).resolves.toEqual({ slug: "acme", outcome: "switched", textMeter: "pending" });
    expect(JSON.stringify(errorSpy.mock.calls).includes("synthetic-private-canary")).toBe(false);
    expect(h.committed).toContainEqual(expect.objectContaining({ billingSwitchedAt: dueAt }));
    h.tenant = { ...due(), billingSwitchedAt: dueAt };
    await expect(switchTenant("acme", dueAt)).resolves.toEqual({
      slug: "acme", outcome: "skipped", reason: "already_switched", textMeter: "ready",
    });
    expect([ensureHostedSubscription.mock.calls.length, setWeeklyPayouts.mock.calls.length, reconcileHostedTextMeter.mock.calls.length]).toEqual([1, 1, 2]);
    errorSpy.mockRestore();
  });

  it.each([
    ["comped", { comped: 1 }],
    ["not due", { billingSwitchAt: new Date("2026-04-01T14:00:00.000Z") }],
    ["inactive", { status: "suspended" }],
  ])("never reconciles the meter for a %s business", async (_name, patch) => {
    h.tenant = { ...due(), ...patch };
    const result = await switchTenant("acme", dueAt);
    expect(result).toMatchObject({ outcome: "skipped" });
    expect(result).not.toHaveProperty("textMeter");
    expect([reconcileHostedTextMeter.mock.calls.length, ensureHostedSubscription.mock.calls.length]).toEqual([0, 0]);
  });
});
