import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBillingNoticeProviderAllowed,
  classifyTenant,
  billingNoticeRetryDeadline,
  isBillingNoticeRetryWithinProviderWindow,
  isBillingSwitchDue,
  plannedBillingSwitchAt,
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
