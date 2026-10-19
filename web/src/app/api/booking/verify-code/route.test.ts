import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getT: vi.fn(),
  verifyCodeForTenant: vi.fn(),
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
}));
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
const PHONE = "+15550101010";
const CREATED_ID = "client-created-0001";
const EMAIL_CLIENT_ID = "client-email-0002";
const PHONE_CLIENT_ID = "client-phone-0003";

function request(
  overrides: Partial<{
    identifier: string;
    code: string;
    salonId: string;
    name: string;
    phone: string;
  }> = {},
) {
  return new NextRequest("http://localhost/api/booking/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: EMAIL,
      code: "123456",
      salonId: BUSINESS_ID,
      ...overrides,
    }),
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
    expect(mocks.cookieStoreSet).toHaveBeenCalledWith(
      "uptempo_last_salon",
      TENANT,
      expect.objectContaining({ path: "/", httpOnly: false }),
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
