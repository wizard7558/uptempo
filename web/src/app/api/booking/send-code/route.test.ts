import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getT: vi.fn(),
  createVerificationForTenant: vi.fn(),
  createReviewVerificationForTenant: vi.fn(),
  normalizeBookingIdentifier: vi.fn(),
  normalizeBookingPhone: vi.fn(),
  readReviewOtpConfig: vi.fn(),
  sendEmail: vi.fn(),
  consumeRateLimit: vi.fn(),
  clientIpFrom: vi.fn(),
  getTenantSlugForBusinessId: vi.fn(),
  getSmsProvider: vi.fn(),
  sendSms: vi.fn(),
  isLoopMessageConfigured: vi.fn(),
}));

vi.mock("@/lib/terms/server", () => ({ getT: mocks.getT }));
vi.mock("@/lib/booking/otp", () => ({
  createVerificationForTenant: mocks.createVerificationForTenant,
  createReviewVerificationForTenant: mocks.createReviewVerificationForTenant,
  normalizeBookingIdentifier: mocks.normalizeBookingIdentifier,
  normalizeBookingPhone: mocks.normalizeBookingPhone,
  readReviewOtpConfig: mocks.readReviewOtpConfig,
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/http/client-ip", () => ({ clientIpFrom: mocks.clientIpFrom }));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantSlugForBusinessId: mocks.getTenantSlugForBusinessId,
}));
vi.mock("@/lib/providers/sms", () => ({ getSmsProvider: mocks.getSmsProvider }));
vi.mock("@/lib/sms/loopmessage", () => ({
  isLoopMessageConfigured: mocks.isLoopMessageConfigured,
}));

const TENANT = "synthetic-business-tenant";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000011";
const EMAIL = "new-client@example.test";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/booking/send-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getT.mockReset().mockImplementation(async () => (key: string) => key);
  mocks.createVerificationForTenant.mockReset().mockResolvedValue("123456");
  mocks.createReviewVerificationForTenant.mockReset().mockResolvedValue("654321");
  mocks.normalizeBookingIdentifier.mockReset().mockImplementation((input: string) => {
    const value = input.trim();
    if (value.includes("@")) {
      const identifier = value.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        ? { identifier, type: "email" }
        : null;
    }
    const digits = value.replace(/\D/g, "");
    if (digits.length === 10) return { identifier: `+1${digits}`, type: "phone" };
    if (digits.length === 11 && digits.startsWith("1")) {
      return { identifier: `+${digits}`, type: "phone" };
    }
    return null;
  });
  mocks.normalizeBookingPhone.mockReset().mockImplementation((input: string) => {
    const digits = input.trim().replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
  });
  mocks.readReviewOtpConfig.mockReset().mockReturnValue({ status: "absent" });
  mocks.sendEmail.mockReset().mockResolvedValue(undefined);
  mocks.consumeRateLimit.mockReset().mockResolvedValue({ allowed: true });
  mocks.clientIpFrom.mockReset().mockReturnValue("203.0.113.14");
  mocks.getTenantSlugForBusinessId.mockReset().mockResolvedValue(TENANT);
  mocks.getSmsProvider.mockReset().mockReturnValue({
    id: "none",
    enabled: false,
    send: mocks.sendSms,
  });
  mocks.sendSms.mockReset();
  mocks.isLoopMessageConfigured.mockReset().mockReturnValue(false);
});

describe("POST /api/booking/send-code business ID compatibility", () => {
  it.each([
    { label: "canonical businessId", ids: { businessId: BUSINESS_ID } },
    { label: "legacy salonId", ids: { salonId: BUSINESS_ID } },
    { label: "matching IDs", ids: { businessId: BUSINESS_ID, salonId: BUSINESS_ID } },
  ])("accepts $label and uses its business ID for tenant lookup", async ({ ids }) => {
    const response = await POST(request({ identifier: EMAIL, ...ids }));

    expect(response.status).toBe(200);
    expect(mocks.getTenantSlugForBusinessId).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: TENANT }));
    expect(mocks.createVerificationForTenant).toHaveBeenCalledWith(TENANT, EMAIL, "email");
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "neither ID", ids: { businessId: undefined, salonId: undefined }, error: "Invalid ID" },
    { label: "invalid businessId beside a valid salonId", ids: { businessId: "invalid", salonId: BUSINESS_ID }, error: "Invalid ID" },
    { label: "invalid salonId beside a valid businessId", ids: { businessId: BUSINESS_ID, salonId: "invalid" }, error: "Invalid ID" },
    { label: "array businessId beside a valid salonId", ids: { businessId: [], salonId: BUSINESS_ID }, error: "Invalid ID" },
    { label: "null businessId beside a valid salonId", ids: { businessId: null, salonId: BUSINESS_ID }, error: "Invalid ID" },
    { label: "array salonId beside a valid businessId", ids: { businessId: BUSINESS_ID, salonId: [] }, error: "Invalid ID" },
    { label: "null salonId beside a valid businessId", ids: { businessId: BUSINESS_ID, salonId: null }, error: "Invalid ID" },
    { label: "conflicting valid IDs", ids: { businessId: BUSINESS_ID, salonId: "00000000-0000-4000-8000-000000000012" }, error: "Conflicting business IDs" },
  ])("rejects $label before effects", async ({ ids, error }) => {
    const response = await POST(request({ identifier: EMAIL, ...ids }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getSmsProvider).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.isLoopMessageConfigured).not.toHaveBeenCalled();
  });

  it.each([
    { identifier: [] },
    { phone: null },
  ])("rejects invalid body types before effects (%j)", async (invalidField) => {
    const response = await POST(request({ identifier: EMAIL, businessId: BUSINESS_ID, ...invalidField }));

    expect(response.status).toBe(400);
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    { label: "array body", body: [] },
    { label: "null body", body: null },
  ])("rejects a $label before effects", async ({ body }) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getSmsProvider).not.toHaveBeenCalled();
  });

  it("rejects an unknown business before rate limiting or delivery", async () => {
    mocks.getTenantSlugForBusinessId.mockResolvedValue(null);

    const response = await POST(request({ identifier: EMAIL, businessId: BUSINESS_ID }));

    expect(response.status).toBe(404);
    expect(mocks.getTenantSlugForBusinessId).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getSmsProvider).not.toHaveBeenCalled();
  });
});

describe("POST /api/booking/send-code App Review and normalization", () => {
  const REVIEW_EMAIL = "reviewer@example.test";

  it("normalizes the identifier and optional phone before budgets, storage, and delivery", async () => {
    const response = await POST(
      request({
        identifier: "  Client@Example.TEST ",
        phone: "1 (555) 123-4567",
        businessId: BUSINESS_ID,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ scope: "identifier", key: "client@example.test" }),
    );
    expect(mocks.createVerificationForTenant).toHaveBeenCalledWith(
      TENANT,
      "client@example.test",
      "email",
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.test" }),
    );
  });

  it("stores a review challenge without email, SMS, code logging, or code in the response", async () => {
    mocks.readReviewOtpConfig.mockReturnValue({
      status: "valid",
      email: REVIEW_EMAIL,
      tenantSlug: TENANT,
      code: "654321",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      request({
        identifier: ` ${REVIEW_EMAIL.toUpperCase()} `,
        businessId: BUSINESS_ID,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, type: "email" });
    expect(mocks.createReviewVerificationForTenant).toHaveBeenCalledWith(TENANT, REVIEW_EMAIL);
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getSmsProvider).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    { label: "partial configuration", config: { status: "invalid", email: REVIEW_EMAIL } },
    {
      label: "wrong tenant configuration",
      config: {
        status: "valid",
        email: REVIEW_EMAIL,
        tenantSlug: "another-tenant",
        code: "654321",
        expiresAt: new Date(Date.now() + 60_000),
      },
    },
  ])("fails closed for $label without normal OTP delivery", async ({ config }) => {
    mocks.readReviewOtpConfig.mockReturnValue(config);
    const response = await POST(
      request({ identifier: REVIEW_EMAIL, businessId: BUSINESS_ID }),
    );

    expect(response.status).toBe(403);
    expect(mocks.createReviewVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getSmsProvider).not.toHaveBeenCalled();
  });

  it("fails closed when no seeded review client can create a challenge", async () => {
    mocks.readReviewOtpConfig.mockReturnValue({
      status: "valid",
      email: REVIEW_EMAIL,
      tenantSlug: TENANT,
      code: "654321",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.createReviewVerificationForTenant.mockResolvedValue(null);

    const response = await POST(
      request({ identifier: REVIEW_EMAIL, businessId: BUSINESS_ID }),
    );

    expect(response.status).toBe(403);
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getSmsProvider).not.toHaveBeenCalled();
  });

  it("returns 429 before challenge creation or delivery when either send budget is exhausted", async () => {
    mocks.readReviewOtpConfig.mockReturnValue({
      status: "valid",
      email: REVIEW_EMAIL,
      tenantSlug: TENANT,
      code: "654321",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false });

    const identifierLimited = await POST(
      request({ identifier: REVIEW_EMAIL, businessId: BUSINESS_ID }),
    );
    expect(identifierLimited.status).toBe(429);
    expect(mocks.createReviewVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();

    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const ipLimited = await POST(
      request({ identifier: REVIEW_EMAIL, businessId: BUSINESS_ID }),
    );
    expect(ipLimited.status).toBe(429);
    expect(mocks.createReviewVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers before tenant lookup or rate limiting", async () => {
    const response = await POST(request({ identifier: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createVerificationForTenant).not.toHaveBeenCalled();
    expect(mocks.createReviewVerificationForTenant).not.toHaveBeenCalled();
  });
});
