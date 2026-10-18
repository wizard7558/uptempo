// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: null as Record<string, unknown> | null,
  tenantSlug: "owned-salon",
  singleMode: false,
  requireStaff: vi.fn(),
  startRegistration: vi.fn(),
  resendConfirmation: vi.fn(),
  turnOffRegistrationLine: vi.fn(),
  reactivateRegistrationLine: vi.fn(),
  ensureFee: vi.fn(),
  syncBilling: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: (...args: unknown[]) => h.requireStaff(...args),
}));
vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => h.singleMode }));
vi.mock("@/lib/db/schema", () => ({
  tenants: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => [column, value],
}));
vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (h.tenant ? [structuredClone(h.tenant)] : []),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/billing/text-line-setup-fee", () => ({
  ensureTextLineSetupFee: (...args: unknown[]) => h.ensureFee(...args),
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  syncHostedSubscription: (...args: unknown[]) => h.syncBilling(...args),
}));
vi.mock("@/lib/sms/registration", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/sms/registration")>();
  return {
    ...actual,
    startRegistration: (...args: unknown[]) => h.startRegistration(...args),
    resendConfirmation: (...args: unknown[]) => h.resendConfirmation(...args),
    turnOffRegistrationLine: (...args: unknown[]) =>
      h.turnOffRegistrationLine(...args),
    reactivateRegistrationLine: (...args: unknown[]) =>
      h.reactivateRegistrationLine(...args),
  };
});

import {
  getTextLine,
  resendTextLineConfirmation,
  submitTextLine,
  turnOffTextLine,
} from "./text-line";

const originalProfile = process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
const validInput = {
  legalBusinessName: "Northwind Salon LLC",
  businessType: "LLC",
  ein: "12-3456789",
  businessAddress: {
    street: "123 Main Street",
    city: "Seattle",
    state: "wa",
    postalCode: "98101",
  },
  owner: {
    firstName: "Riley",
    lastName: "Owner",
    title: "Owner",
    email: "owner@example.com",
    mobile: "+12065550123",
  },
};

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    slug: "owned-salon",
    comped: 0,
    smsLineStatus: "off",
    smsBrandId: null,
    smsCampaignId: null,
    smsMessagingServiceSid: null,
    smsPhoneNumber: null,
    smsRegistration: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tenantSlug = "owned-salon";
  h.singleMode = false;
  h.tenant = tenant();
  h.requireStaff.mockResolvedValue({
    userId: "owner-1",
    role: "owner",
    tenantSlug: h.tenantSlug,
  });
  h.startRegistration.mockResolvedValue({ ok: true, status: "pending" });
  h.resendConfirmation.mockResolvedValue({ ok: true, status: "action_needed" });
  h.turnOffRegistrationLine.mockResolvedValue({ ok: true, status: "off" });
  h.reactivateRegistrationLine.mockResolvedValue({
    ok: true,
    status: "active",
  });
  h.ensureFee.mockResolvedValue({ ok: true, status: "added" });
  h.syncBilling.mockResolvedValue({ created: 0, updated: 0, removed: 0 });
  process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU_PRIMARY_PROFILE_TEST";
});

afterAll(() => {
  if (originalProfile === undefined)
    delete process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
  else process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = originalProfile;
});

describe("text-line owner actions", () => {
  it("requires owner authorization for every action", async () => {
    const authError = new Error("owner required");
    h.requireStaff.mockRejectedValue(authError);
    await expect(getTextLine()).rejects.toBe(authError);
    await expect(submitTextLine(validInput)).rejects.toBe(authError);
    await expect(resendTextLineConfirmation()).rejects.toBe(authError);
    await expect(turnOffTextLine()).rejects.toBe(authError);
    expect(h.requireStaff).toHaveBeenCalledTimes(4);
    expect(h.requireStaff).toHaveBeenCalledWith("owner");
    expect(h.ensureFee).not.toHaveBeenCalled();
    expect(h.startRegistration).not.toHaveBeenCalled();
  });

  it("uses only the authenticated tenant and keeps a full EIN out of the result", async () => {
    h.tenantSlug = "session-owned-salon";
    h.requireStaff.mockResolvedValue({
      userId: "owner-1",
      role: "owner",
      tenantSlug: h.tenantSlug,
    });
    const result = await submitTextLine({
      ...validInput,
      tenantSlug: "attacker-salon",
    });
    expect(result).toEqual({ ok: true, status: "pending" });
    expect(h.ensureFee).toHaveBeenCalledWith("session-owned-salon");
    expect(h.startRegistration).toHaveBeenCalledWith(
      "session-owned-salon",
      expect.objectContaining({ ein: validInput.ein }),
    );
    expect(JSON.stringify(result)).not.toContain("123456789");
  });

  it("validates input, configuration and sole-proprietor support before charging", async () => {
    await expect(
      submitTextLine({ ...validInput, ein: "not-an-ein" }),
    ).resolves.toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(h.ensureFee).not.toHaveBeenCalled();

    delete process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
    await expect(submitTextLine(validInput)).resolves.toEqual({
      ok: false,
      error: "registration_not_configured",
    });
    expect(h.ensureFee).not.toHaveBeenCalled();

    process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU_PRIMARY_PROFILE_TEST";
    const unsupported = {
      ...validInput,
      ein: undefined,
      businessType: "SOLE_PROPRIETOR",
      owner: { ...validInput.owner, mobile: "+442079460123" },
    };
    await expect(submitTextLine(unsupported)).resolves.toEqual({
      ok: false,
      error: "unsupported_sole_proprietor",
    });
    expect(h.ensureFee).not.toHaveBeenCalled();
    expect(h.startRegistration).not.toHaveBeenCalled();
  });

  it("does not start registration when the setup fee is unavailable", async () => {
    h.ensureFee.mockResolvedValue({
      ok: false,
      error: "setup_fee_unavailable",
    });
    await expect(submitTextLine(validInput)).resolves.toEqual({
      ok: false,
      error: "fee_unavailable",
    });
    expect(h.startRegistration).not.toHaveBeenCalled();
  });

  it("returns safe saved defaults and never returns a persisted EIN", async () => {
    h.tenant = tenant({
      smsRegistration: {
        status: "action_needed",
        brandType: "STANDARD",
        einLast4: "6789",
        input: {
          legalBusinessName: "Northwind Salon LLC",
          businessType: "LLC",
          addressStreet: "123 Main Street",
          addressCity: "Seattle",
          addressState: "WA",
          addressPostalCode: "98101",
          ownerFirstName: "Riley",
          ownerLastName: "Owner",
          ownerTitle: "Owner",
          ownerEmail: "owner@example.com",
          ownerMobile: "+12065550123",
        },
      },
    });
    const result = await getTextLine();
    expect(result).toMatchObject({
      requiresEin: true,
      formDefaults: {
        legalBusinessName: "Northwind Salon LLC",
        businessType: "LLC",
      },
    });
    expect(JSON.stringify(result)).not.toContain("123456789");
    expect(JSON.stringify(result)).not.toContain("6789");
    expect(result).toMatchObject({ requiresEin: true });
  });

  it("reactivates an approved line without a new fee or registration and syncs billing", async () => {
    h.tenant = tenant({
      smsLineStatus: "off",
      smsMessagingServiceSid: "MG_APPROVED",
      smsPhoneNumber: "+12065550100",
      smsRegistration: { status: "active", brandType: "STANDARD" },
    });
    await expect(submitTextLine()).resolves.toEqual({
      ok: true,
      status: "active",
    });
    expect(h.reactivateRegistrationLine).toHaveBeenCalledWith("owned-salon");
    expect(h.ensureFee).not.toHaveBeenCalled();
    expect(h.startRegistration).not.toHaveBeenCalled();
    expect(h.syncBilling).toHaveBeenCalledWith("owned-salon");
  });

  it("turns a line off and syncs hosted subscription state", async () => {
    delete process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
    await expect(turnOffTextLine()).resolves.toEqual({
      ok: true,
      status: "off",
    });
    expect(h.turnOffRegistrationLine).toHaveBeenCalledWith("owned-salon");
    expect(h.syncBilling).toHaveBeenCalledWith("owned-salon");
  });

  it("resends only through the owner-protected registration action", async () => {
    await expect(resendTextLineConfirmation()).resolves.toEqual({
      ok: true,
      status: "action_needed",
    });
    expect(h.resendConfirmation).toHaveBeenCalledWith("owned-salon");
  });

  it("does no hosted work in single mode", async () => {
    h.singleMode = true;
    await expect(getTextLine()).resolves.toBeNull();
    await expect(submitTextLine(validInput)).resolves.toEqual({
      ok: false,
      error: "single_mode",
    });
    await expect(resendTextLineConfirmation()).resolves.toEqual({
      ok: false,
      error: "single_mode",
    });
    await expect(turnOffTextLine()).resolves.toEqual({
      ok: false,
      error: "single_mode",
    });
    expect(h.ensureFee).not.toHaveBeenCalled();
    expect(h.startRegistration).not.toHaveBeenCalled();
    expect(h.syncBilling).not.toHaveBeenCalled();
  });
});
