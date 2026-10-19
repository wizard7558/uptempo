import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getT: vi.fn(),
  createVerificationForTenant: vi.fn(),
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
