import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getT: vi.fn(),
  verifyCodeForTenant: vi.fn(),
  readReviewOtpConfig: vi.fn(),
  normalizeBookingIdentifier: vi.fn(),
  normalizeBookingPhone: vi.fn(),
  consumeRateLimit: vi.fn(),
  clientIpFrom: vi.fn(),
  setBookingSession: vi.fn(),
  findClientByEmailForTenant: vi.fn(),
  findClientByPhoneForTenant: vi.fn(),
  createClientForTenant: vi.fn(),
  getTenantSlugForBusinessId: vi.fn(),
  withTenantDb: vi.fn(),
  normalizePhone: vi.fn(),
  cookies: vi.fn(),
  cookieStoreSet: vi.fn(),
  updateSet: vi.fn(),
  eq: vi.fn(),
  audience: "both" as "both" | "existing_only" | "new_only",
}));

vi.mock("@/lib/terms/server", () => ({ getT: mocks.getT }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/booking/otp", () => ({
  verifyCodeForTenant: mocks.verifyCodeForTenant,
  readReviewOtpConfig: mocks.readReviewOtpConfig,
  normalizeBookingIdentifier: mocks.normalizeBookingIdentifier,
  normalizeBookingPhone: mocks.normalizeBookingPhone,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/http/client-ip", () => ({ clientIpFrom: mocks.clientIpFrom }));
vi.mock("@/lib/booking/session-cookie", () => ({
  setBookingSession: mocks.setBookingSession,
}));
vi.mock("@/lib/clients/for-tenant", () => ({
  findClientByEmailForTenant: mocks.findClientByEmailForTenant,
  findClientByPhoneForTenant: mocks.findClientByPhoneForTenant,
  createClientForTenant: mocks.createClientForTenant,
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantSlugForBusinessId: mocks.getTenantSlugForBusinessId,
}));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: mocks.withTenantDb }));
vi.mock("@/lib/phone", () => ({ normalizePhone: mocks.normalizePhone }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq }));

const TENANT = "synthetic-business-tenant";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000011";
const EMAIL = "new-client@example.test";
const REVIEW_EMAIL = "reviewer@example.test";
const PHONE = "+15550101010";
const CREATED_ID = "client-created-0001";
const EMAIL_CLIENT_ID = "client-email-0002";
const PHONE_CLIENT_ID = "client-phone-0003";

function request(
  overrides: Record<string, unknown> = {},
) {
  return requestBody({
    identifier: EMAIL,
    code: "123456",
    salonId: BUSINESS_ID,
    ...overrides,
  });
}

function requestBody(body: unknown) {
  return new NextRequest("http://localhost/api/booking/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function client(
  id: string,
  name: string,
  email: string | null,
  phone: string | null = null,
) {
  return { id, name, email, phone };
}

beforeEach(() => {
  mocks.audience = "both";
  mocks.getT.mockReset().mockImplementation(async () => (key: string) => key);
  mocks.verifyCodeForTenant.mockReset().mockResolvedValue({ valid: true });
  mocks.readReviewOtpConfig.mockReset().mockReturnValue({ status: "absent" });
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
  mocks.consumeRateLimit.mockReset().mockResolvedValue({ allowed: true });
  mocks.clientIpFrom.mockReset().mockReturnValue("203.0.113.14");
  mocks.setBookingSession.mockReset();
  mocks.findClientByEmailForTenant.mockReset().mockResolvedValue(null);
  mocks.findClientByPhoneForTenant.mockReset().mockResolvedValue(null);
  mocks.createClientForTenant.mockReset().mockResolvedValue({
    success: false,
    duplicate: "phone",
    error: {
      formErrors: [],
      fieldErrors: { phone: ["already used"] },
      message: "phone collision",
    },
  });
  mocks.getTenantSlugForBusinessId
    .mockReset()
    .mockResolvedValue(TENANT);
  mocks.withTenantDb.mockReset().mockImplementation(async (_tenantSlug, callback) => {
    const audienceQuery = {
      from: vi.fn(),
      limit: vi.fn(async () => [{ value: mocks.audience }]),
    };
    audienceQuery.from.mockReturnValue(audienceQuery);
    const updateQuery = {
      set: mocks.updateSet,
      where: vi.fn(async () => undefined),
    };
    mocks.updateSet.mockReturnValue(updateQuery);
    const db = {
      select: vi.fn(() => audienceQuery),
      update: vi.fn(() => updateQuery),
    };
    return callback(db, {
      businessSettings: { onlineBookingAudience: "onlineBookingAudience" },
      clients: { id: "clients.id" },
    });
  });
  mocks.normalizePhone
    .mockReset()
    .mockImplementation((phone: string | undefined) =>
      phone ? "+15550101010-normalized" : null,
    );
  mocks.cookies.mockReset().mockResolvedValue({ set: mocks.cookieStoreSet });
  mocks.cookieStoreSet.mockReset();
  mocks.updateSet.mockReset();
  mocks.eq.mockReset().mockImplementation((...args: unknown[]) => args);
});

describe("POST /api/booking/verify-code business ID compatibility", () => {
  it.each([
    { label: "canonical businessId", ids: { businessId: BUSINESS_ID, salonId: undefined } },
    { label: "legacy salonId", ids: { salonId: BUSINESS_ID } },
    { label: "matching IDs", ids: { businessId: BUSINESS_ID, salonId: BUSINESS_ID } },
  ])("accepts $label and uses its business ID for tenant lookup", async ({ ids }) => {
    mocks.createClientForTenant.mockResolvedValue({ success: true, id: CREATED_ID });

    const response = await POST(request(ids));

    expect(response.status).toBe(200);
    expect(mocks.getTenantSlugForBusinessId).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.verifyCodeForTenant).toHaveBeenCalledWith(TENANT, EMAIL, "123456");
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
    const response = await POST(request(ids));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it.each([
    { identifier: [] },
    { code: null },
    { name: [] },
    { phone: null },
  ])("rejects invalid body types before effects (%j)", async (invalidField) => {
    const response = await POST(request(invalidField));

    expect(response.status).toBe(400);
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
  });

  it.each([
    { label: "array body", body: [] },
    { label: "null body", body: null },
  ])("rejects a $label before effects", async ({ body }) => {
    const response = await POST(requestBody(body));

    expect(response.status).toBe(400);
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("rejects an unknown business before OTP, database, or account effects", async () => {
    mocks.getTenantSlugForBusinessId.mockResolvedValue(null);

    const response = await POST(request({ businessId: BUSINESS_ID, salonId: undefined }));

    expect(response.status).toBe(404);
    expect(mocks.getTenantSlugForBusinessId).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });
});

describe("POST /api/booking/verify-code identity selection", () => {
  it.each([
    {
      name: "a phone collision whose record has another email in both mode",
      audience: "both" as const,
      phoneClient: client(PHONE_CLIENT_ID, "Phone Client", "other@example.test", PHONE),
    },
    {
      name: "a phone collision whose record has no email in new-only mode",
      audience: "new_only" as const,
      phoneClient: client(PHONE_CLIENT_ID, "Phone Client", null, PHONE),
    },
    {
      name: "a phone collision with no matching record",
      audience: "both" as const,
      phoneClient: null,
    },
  ])("returns a generic failure without adopting $name", async ({ audience, phoneClient }) => {
    mocks.audience = audience;
    mocks.findClientByPhoneForTenant.mockResolvedValue(phoneClient);

    const response = await POST(request({ phone: PHONE }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to create client" });
    expect(mocks.createClientForTenant).toHaveBeenCalledWith(TENANT, {
      name: "Guest",
      email: EMAIL,
      phone: PHONE,
    });
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("does not use a phone match after an unrelated generic create failure", async () => {
    mocks.findClientByPhoneForTenant.mockResolvedValue(
      client(PHONE_CLIENT_ID, "Phone Client", "other@example.test", PHONE),
    );
    mocks.createClientForTenant.mockResolvedValue({
      success: false,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "database unavailable",
      },
    });

    const response = await POST(request({ phone: PHONE }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to create client" });
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("keeps the same generic failure when creation fails without a phone", async () => {
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to create client" });
    expect(mocks.createClientForTenant).toHaveBeenCalledWith(TENANT, {
      name: "Guest",
      email: EMAIL,
      phone: null,
    });
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("uses the new ID returned by a successful email client creation", async () => {
    mocks.createClientForTenant.mockResolvedValue({
      success: true,
      id: CREATED_ID,
    });

    const response = await POST(request({ name: "New Client", phone: PHONE }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientId: CREATED_ID,
      name: "New Client",
      isReturning: false,
    });
    expect(mocks.getTenantSlugForBusinessId).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.verifyCodeForTenant).toHaveBeenCalledWith(
      TENANT,
      EMAIL,
      "123456",
    );
    expect(mocks.createClientForTenant).toHaveBeenCalledWith(TENANT, {
      name: "New Client",
      email: EMAIL,
      phone: PHONE,
    });
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).toHaveBeenCalledWith(CREATED_ID);
    const rememberedBusinessCookieOptions = {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    };
    expect(mocks.cookieStoreSet).toHaveBeenCalledTimes(2);
    expect(mocks.cookieStoreSet).toHaveBeenNthCalledWith(
      1,
      "uptempo_last_business",
      TENANT,
      rememberedBusinessCookieOptions,
    );
    expect(mocks.cookieStoreSet).toHaveBeenNthCalledWith(
      2,
      "uptempo_last_salon",
      TENANT,
      rememberedBusinessCookieOptions,
    );
  });

  it("keeps an existing verified-email account and its optional phone update", async () => {
    mocks.findClientByEmailForTenant.mockResolvedValue(
      client(EMAIL_CLIENT_ID, "Email Client", EMAIL, null),
    );

    const response = await POST(request({ phone: PHONE }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientId: EMAIL_CLIENT_ID,
      name: "Email Client",
      isReturning: true,
    });
    expect(mocks.findClientByEmailForTenant).toHaveBeenCalledWith(TENANT, EMAIL);
    expect(mocks.updateSet).toHaveBeenCalledWith({
      phone: "+15550101010-normalized",
      updatedAt: expect.any(Date),
    });
    expect(mocks.setBookingSession).toHaveBeenCalledWith(EMAIL_CLIENT_ID);
  });

  it("keeps an existing verified-phone account", async () => {
    mocks.findClientByPhoneForTenant.mockResolvedValue(
      client(PHONE_CLIENT_ID, "Phone Client", null, PHONE),
    );

    const response = await POST(
      request({ identifier: PHONE, phone: undefined }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientId: PHONE_CLIENT_ID,
      name: "Phone Client",
      isReturning: true,
    });
    expect(mocks.getTenantSlugForBusinessId).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.verifyCodeForTenant).toHaveBeenCalledWith(
      TENANT,
      PHONE,
      "123456",
    );
    expect(mocks.findClientByPhoneForTenant).toHaveBeenCalledWith(TENANT, PHONE);
    expect(mocks.setBookingSession).toHaveBeenCalledWith(PHONE_CLIENT_ID);
  });

  it("does not create, mutate, or sign in for an invalid OTP", async () => {
    mocks.verifyCodeForTenant.mockResolvedValue({ valid: false });

    const response = await POST(request({ phone: PHONE }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid or expired code" });
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("keeps existing-only denial for an unrecognized email", async () => {
    mocks.audience = "existing_only";

    const response = await POST(request({ phone: PHONE }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "bookingApi.existingOnly" });
    expect(mocks.findClientByEmailForTenant).toHaveBeenCalledWith(TENANT, EMAIL);
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("keeps new-only denial for a recognized email", async () => {
    mocks.audience = "new_only";
    mocks.findClientByEmailForTenant.mockResolvedValue(
      client(EMAIL_CLIENT_ID, "Email Client", EMAIL),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "bookingApi.newOnly" });
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });
});

describe("POST /api/booking/verify-code App Review and verification budgets", () => {
  function liveReviewConfig(overrides: Record<string, unknown> = {}) {
    return {
      status: "valid",
      email: REVIEW_EMAIL,
      tenantSlug: TENANT,
      code: "654321",
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  it("validates numeric codes and normalized identifiers before lookup or budgets", async () => {
    const invalidCode = await POST(request({ code: "12x456" }));
    const invalidEmail = await POST(request({ identifier: "bad@example" }));

    expect(invalidCode.status).toBe(400);
    expect(invalidEmail.status).toBe(400);
    expect(mocks.getTenantSlugForBusinessId).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
  });

  it("applies verify-only identifier and IP budgets before challenge or client effects", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false });
    const identifierLimited = await POST(
      request({ identifier: " Client@Example.TEST " }),
    );
    expect(identifierLimited.status).toBe(429);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.consumeRateLimit.mock.calls[0][0]).toMatchObject({
      tenantSlug: TENANT,
      scope: "identifier",
      key: "verify:client@example.test",
      limit: 3,
      windowMs: 600_000,
    });
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();

    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const ipLimited = await POST(request());
    expect(ipLimited.status).toBe(429);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(3);
    expect(mocks.consumeRateLimit.mock.calls[2][0]).toMatchObject({
      tenantSlug: TENANT,
      scope: "ip",
      key: "verify:203.0.113.14",
      limit: 5,
      windowMs: 600_000,
    });
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
  });

  it.each([
    { label: "partial configuration", config: { status: "invalid", email: REVIEW_EMAIL } },
    { label: "wrong tenant", config: liveReviewConfig({ tenantSlug: "other-tenant" }) },
    { label: "expired configuration", config: { ...liveReviewConfig(), status: "invalid" } },
  ])("fails closed for $label before verification or identity side effects", async ({ config }) => {
    mocks.readReviewOtpConfig.mockReturnValue(config);

    const response = await POST(request({ identifier: REVIEW_EMAIL, code: "654321", phone: "1 (555) 987-6543" }));

    expect(response.status).toBe(400);
    expect(mocks.verifyCodeForTenant).not.toHaveBeenCalled();
    expect(mocks.findClientByEmailForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("uses only the seeded reviewer account and ignores a submitted phone", async () => {
    mocks.readReviewOtpConfig.mockReturnValue(liveReviewConfig());
    mocks.findClientByEmailForTenant.mockResolvedValue(
      client(EMAIL_CLIENT_ID, "Review Client", REVIEW_EMAIL),
    );

    const response = await POST(
      request({ identifier: ` ${REVIEW_EMAIL.toUpperCase()} `, code: "654321", phone: "1 (555) 987-6543" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientId: EMAIL_CLIENT_ID,
      name: "Review Client",
      isReturning: true,
    });
    expect(mocks.verifyCodeForTenant).toHaveBeenCalledWith(TENANT, REVIEW_EMAIL, "654321");
    expect(mocks.findClientByEmailForTenant).toHaveBeenCalledTimes(1);
    expect(mocks.findClientByEmailForTenant).toHaveBeenCalledWith(TENANT, REVIEW_EMAIL);
    expect(mocks.findClientByPhoneForTenant).not.toHaveBeenCalled();
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).toHaveBeenCalledWith(EMAIL_CLIENT_ID);
    expect(mocks.cookieStoreSet).toHaveBeenCalledTimes(2);
    expect(mocks.cookieStoreSet).toHaveBeenNthCalledWith(
      1,
      "uptempo_last_business",
      TENANT,
      expect.objectContaining({ maxAge: 365 * 24 * 60 * 60 }),
    );
    expect(mocks.cookieStoreSet).toHaveBeenNthCalledWith(
      2,
      "uptempo_last_salon",
      TENANT,
      expect.objectContaining({ maxAge: 365 * 24 * 60 * 60 }),
    );
  });

  it("does not create a reviewer, mutate a phone, or create a session when the seeded client is missing", async () => {
    mocks.readReviewOtpConfig.mockReturnValue(liveReviewConfig());

    const response = await POST(
      request({ identifier: REVIEW_EMAIL, code: "654321", phone: "1 (555) 987-6543" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.findClientByEmailForTenant).toHaveBeenCalledWith(TENANT, REVIEW_EMAIL);
    expect(mocks.createClientForTenant).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.cookieStoreSet).not.toHaveBeenCalled();
  });

  it("normalizes ordinary email and phone identifiers before budgets and verification", async () => {
    mocks.findClientByEmailForTenant.mockResolvedValue(
      client(EMAIL_CLIENT_ID, "Email Client", EMAIL),
    );
    const emailResponse = await POST(
      request({ identifier: " Client@Example.TEST ", phone: "1 (555) 987-6543" }),
    );
    expect(emailResponse.status).toBe(200);
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: "identifier",
        key: "verify:client@example.test",
      }),
    );
    expect(mocks.verifyCodeForTenant).toHaveBeenCalledWith(
      TENANT,
      "client@example.test",
      "123456",
    );

    vi.clearAllMocks();
    mocks.getTenantSlugForBusinessId.mockResolvedValue(TENANT);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
    mocks.verifyCodeForTenant.mockResolvedValue({ valid: true, type: "phone" });
    mocks.findClientByPhoneForTenant.mockResolvedValue(
      client(PHONE_CLIENT_ID, "Phone Client", null, PHONE),
    );
    mocks.withTenantDb.mockImplementation(async (_tenantSlug, callback) => {
      const audienceQuery = {
        from: vi.fn(),
        limit: vi.fn(async () => [{ value: "both" }]),
      };
      audienceQuery.from.mockReturnValue(audienceQuery);
      return callback({ select: vi.fn(() => audienceQuery) }, { businessSettings: { onlineBookingAudience: "onlineBookingAudience" } });
    });

    const phoneResponse = await POST(
      request({ identifier: "1 (555) 010-1010", phone: undefined }),
    );
    expect(phoneResponse.status).toBe(200);
    expect(mocks.verifyCodeForTenant).toHaveBeenCalledWith(TENANT, PHONE, "123456");
    expect(mocks.findClientByPhoneForTenant).toHaveBeenCalledWith(TENANT, PHONE);
  });
});
