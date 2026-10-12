// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, localDay } from "@/lib/scheduling/intervals";

const h = vi.hoisted(() => ({
  hasModule: vi.fn(),
  getTenantSlug: vi.fn(),
  getBookingSession: vi.fn(),
  consumeRateLimit: vi.fn(),
  withTenantDb: vi.fn(),
  recordSmsConsent: vi.fn(),
  results: [] as unknown[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: h.hasModule }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: h.getTenantSlug }));
vi.mock("@/lib/booking/session-cookie", () => ({ getBookingSession: h.getBookingSession }));
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeRateLimit: h.consumeRateLimit }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: h.withTenantDb }));
vi.mock("@/lib/sms/consent", () => ({ recordSmsConsent: h.recordSmsConsent }));
vi.mock("@/lib/waitlist/opening", () => ({
  declineOffer: vi.fn(),
  markOfferBooked: vi.fn(),
  processOpening: vi.fn(),
}));

import { joinSlotWaitlist } from "./slot-waitlist-public";

const SERVICE = "11111111-1111-4111-8111-111111111111";
const TZ = "America/New_York";

const base = {
  serviceIds: [SERVICE],
  staffId: "any" as const,
  locationId: null,
  dateFrom: "2026-06-17",
  dateTo: "2026-06-17",
  timeOfDay: "afternoon" as const,
  smsConsent: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.results = [];
  h.hasModule.mockResolvedValue(true);
  h.getTenantSlug.mockResolvedValue("salon");
  h.getBookingSession.mockResolvedValue("c1");
  h.consumeRateLimit.mockResolvedValue({ allowed: true });
  h.withTenantDb.mockImplementation(async () => h.results.shift());
});

describe("joinSlotWaitlist", () => {
  it("asks for a booking session before it writes", async () => {
    h.getBookingSession.mockResolvedValue(null);
    const today = localDay(new Date(), TZ);
    const r = await joinSlotWaitlist({ ...base, dateFrom: today, dateTo: today });
    expect(r).toEqual({ success: false, error: "errors.waitlist.needsSession" });
    expect(h.withTenantDb).not.toHaveBeenCalled();
    expect(h.recordSmsConsent).not.toHaveBeenCalled();
  });

  it("refuses a range longer than 60 days", async () => {
    const today = localDay(new Date(), TZ);
    h.results = [TZ];
    const r = await joinSlotWaitlist({
      ...base,
      dateFrom: today,
      dateTo: addDays(today, 61),
    });
    expect(r).toEqual({ success: false, error: "errors.waitlist.badDates" });
    expect(h.recordSmsConsent).not.toHaveBeenCalled();
  });

  it("refuses to join without a yes to texts", async () => {
    const today = localDay(new Date(), TZ);
    h.results = [TZ, 0, { phone: "+15555550101" }];
    const r = await joinSlotWaitlist({
      ...base,
      dateFrom: today,
      dateTo: addDays(today, 7),
      smsConsent: false,
    });
    expect(r).toEqual({ success: false, error: "errors.waitlist.needsConsent" });
    expect(h.recordSmsConsent).not.toHaveBeenCalled();
  });
});
