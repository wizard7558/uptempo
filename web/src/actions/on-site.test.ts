// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERTICALS } from "@/lib/verticals";
import { createTermsT } from "@/lib/terms/translator";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertModule: vi.fn(),
  getActorStaffId: vi.fn(),
  loadOnMyWayTarget: vi.fn(),
  claimOnMyWay: vi.fn(),
  releaseOnMyWay: vi.fn(),
  sendSms: vi.fn(),
  getTenantBySlug: vi.fn(),
  getTenantSlug: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: mocks.requireRole,
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "home-co" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/auth/actor-staff", () => ({ getActorStaffId: mocks.getActorStaffId }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: mocks.getTenantSlug }));
vi.mock("@/lib/tenant/registry", () => ({ getTenantBySlug: mocks.getTenantBySlug }));
vi.mock("@/lib/tenant/modules", () => ({
  assertModule: mocks.assertModule,
  hasModule: vi.fn(),
  ModuleDisabledError: class extends Error {},
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) => key,
}));
// Real copy and real term merging, with the tenant lookup swapped for a fixed pack.
vi.mock("@/lib/terms/email", () => ({
  getEmailT: async (_slug: string, ns: string) => createTermsT(VERTICALS.home_services.terms, ns),
}));
vi.mock("@/lib/policies/salon-policy", () => ({ getBusinessSettingsForTenant: vi.fn() }));
vi.mock("@/lib/geo/postal", () => ({
  lookupPostalCentroid: vi.fn(),
  nearestPostal: vi.fn(),
  normalizePostal: (z: string) => z,
}));
vi.mock("@/lib/on-site/areas", () => ({ loadActiveAreas: vi.fn() }));
vi.mock("@/lib/sms/send", () => ({ sendSms: mocks.sendSms }));
vi.mock("@/lib/on-site/on-my-way", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/on-site/on-my-way")>();
  return {
    ...actual,
    loadOnMyWayTarget: mocks.loadOnMyWayTarget,
    claimOnMyWay: mocks.claimOnMyWay,
    releaseOnMyWay: mocks.releaseOnMyWay,
  };
});

import { sendOnMyWay } from "./on-site";

const APPT_ID = "11111111-1111-4111-8111-111111111111";

function target(over: Record<string, unknown> = {}) {
  return {
    id: APPT_ID,
    staffId: "staff-1",
    staffName: "Sam Tech",
    status: "confirmed",
    start: new Date(),
    serviceAddressId: "addr-1",
    onMyWaySentAt: null,
    clientId: "client-1",
    clientName: "Home Customer",
    clientPhone: "+15555550101",
    timezone: "UTC",
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "home-co" });
  mocks.assertModule.mockResolvedValue(undefined);
  mocks.getTenantSlug.mockResolvedValue("home-co");
  mocks.getTenantBySlug.mockResolvedValue({ name: "Bright \u201CHome\u201D Caf\u00E9 \uD83D\uDE90" });
  mocks.loadOnMyWayTarget.mockResolvedValue(target());
  mocks.claimOnMyWay.mockResolvedValue({ previous: null });
  mocks.sendSms.mockResolvedValue({ success: true, messageSid: "SM1" });
});

describe("sendOnMyWay", () => {
  it("sends a plain ASCII text of type on_my_way, filled in through the SMS template", async () => {
    const res = await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 15 });
    expect(res).toEqual({ success: true });
    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
    const arg = mocks.sendSms.mock.calls[0][0];
    expect(arg).toMatchObject({
      to: "+15555550101",
      tenantSlug: "home-co",
      clientId: "client-1",
      appointmentId: APPT_ID,
      messageType: "on_my_way",
    });
    // First name only, business name cleaned up, no placeholder left behind.
    expect(arg.body).toBe('Sam from Bright "Home" Cafe is on the way. Arriving in about 15 minutes.');
    expect(arg.body).toMatch(/^[\x20-\x7E]+$/);
    expect(arg.body).not.toContain("{");
  });

  it("a second tap within 30 minutes says it was already sent and texts once", async () => {
    mocks.claimOnMyWay.mockResolvedValueOnce({ previous: null }).mockResolvedValueOnce("taken");
    const first = await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 10 });
    const second = await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 10 });
    expect(first).toEqual({ success: true });
    expect(second).toEqual({ success: true, alreadySent: true });
    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
  });

  it("a provider cannot text for another staff member's job", async () => {
    mocks.requireRole.mockResolvedValue({ userId: "u2", role: "provider", tenantSlug: "home-co" });
    mocks.getActorStaffId.mockResolvedValue("someone-else");
    const res = await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 15 });
    expect(res).toEqual({ success: false, error: "onSite.notYours" });
    expect(mocks.claimOnMyWay).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });

  it("a provider can text for their own job", async () => {
    mocks.requireRole.mockResolvedValue({ userId: "u2", role: "provider", tenantSlug: "home-co" });
    mocks.getActorStaffId.mockResolvedValue("staff-1");
    expect(await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 20 })).toEqual({ success: true });
  });

  it("refuses jobs that are not today, unconfirmed, without an address, or without a phone", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const cases: [Record<string, unknown>, string][] = [
      [{ start: new Date(Date.now() + 3 * dayMs) }, "onSite.notToday"],
      [{ status: "cancelled" }, "onSite.notConfirmed"],
      [{ serviceAddressId: null }, "onSite.noAddress"],
      [{ clientPhone: null }, "onSite.noPhone"],
    ];
    for (const [over, error] of cases) {
      mocks.loadOnMyWayTarget.mockResolvedValue(target(over));
      expect(await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 15 })).toEqual({ success: false, error });
    }
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });

  it("puts the stamp back and explains when the client has not agreed to texts", async () => {
    mocks.sendSms.mockResolvedValue({ success: false, error: "no_consent" });
    const res = await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 15 });
    expect(res).toEqual({ success: false, error: "onSite.noPhone" });
    expect(mocks.releaseOnMyWay).toHaveBeenCalledWith("home-co", APPT_ID, null);
  });

  it("rejects an arrival time that is not one of the choices", async () => {
    const res = await sendOnMyWay({ appointmentId: APPT_ID, etaMinutes: 7 });
    expect(res).toEqual({ success: false, error: "onSite.invalidEta" });
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });
});
