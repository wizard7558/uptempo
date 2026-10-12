import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as registry from "@/lib/tenant/registry";
import * as sessionCookie from "@/lib/booking/session-cookie";
import {
  listActiveMembershipPlansPublic,
  startStoredValueSubscriptionPublic,
} from "@/actions/membership";
import {
  isStripeSubscriptionImmediatelyUsable,
  mapMembershipSubscriptionStatus,
} from "@/lib/membership/stripe-subscription-status";

// Server translator without a request scope: hair_salon words, same as the old copy.
vi.mock("@/lib/terms/server", async () => {
  const { createTermsT } = await import("@/lib/terms/translator");
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getT: async (namespace?: string) =>
      createTermsT(VERTICALS.hair_salon.terms, namespace ?? ""),
  };
});

describe("listActiveMembershipPlansPublic", () => {
  beforeEach(() => {
    vi.spyOn(registry, "getTenantBySlug").mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof registry.getTenantBySlug>>,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty when tenant is missing", async () => {
    await expect(listActiveMembershipPlansPublic("unknown")).resolves.toEqual(
      [],
    );
  });
});

describe("startStoredValueSubscriptionPublic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects without booking session", async () => {
    vi.spyOn(sessionCookie, "getBookingSession").mockResolvedValue(null);
    const r = await startStoredValueSubscriptionPublic({
      clientId: "c1",
      planId: "p1",
    });
    expect(r).toEqual({ success: false, error: "Unauthorized" });
  });

  it("rejects when session client does not match", async () => {
    vi.spyOn(sessionCookie, "getBookingSession").mockResolvedValue("other");
    const r = await startStoredValueSubscriptionPublic({
      clientId: "c1",
      planId: "p1",
    });
    expect(r).toEqual({ success: false, error: "Unauthorized" });
  });

  it("rejects when tenant slug cannot be resolved", async () => {
    vi.spyOn(sessionCookie, "getBookingSession").mockResolvedValue("c1");
    vi.spyOn(registry, "getTenantSlugForBookingClient").mockResolvedValue(null);
    const r = await startStoredValueSubscriptionPublic({
      clientId: "c1",
      planId: "p1",
    });
    expect(r).toEqual({
      success: false,
      error: "Could not resolve salon for this client",
    });
  });

  it("rejects when tenant row is missing", async () => {
    vi.spyOn(sessionCookie, "getBookingSession").mockResolvedValue("c1");
    vi.spyOn(registry, "getTenantSlugForBookingClient").mockResolvedValue(
      "slug",
    );
    vi.spyOn(registry, "getTenantBySlug").mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof registry.getTenantBySlug>>,
    );
    const r = await startStoredValueSubscriptionPublic({
      clientId: "c1",
      planId: "p1",
    });
    expect(r).toEqual({ success: false, error: "Tenant not found" });
  });
});

describe("membership subscription status helpers", () => {
  it("maps Stripe statuses into membership record statuses", () => {
    expect(mapMembershipSubscriptionStatus("active")).toBe("active");
    expect(mapMembershipSubscriptionStatus("trialing")).toBe("active");
    expect(mapMembershipSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapMembershipSubscriptionStatus("unpaid")).toBe("past_due");
    expect(mapMembershipSubscriptionStatus("paused")).toBe("paused");
    expect(mapMembershipSubscriptionStatus("canceled")).toBe("cancelled");
    expect(mapMembershipSubscriptionStatus("incomplete")).toBe("past_due");
  });

  it("only treats active or trialing subscriptions as immediately usable", () => {
    expect(isStripeSubscriptionImmediatelyUsable("active")).toBe(true);
    expect(isStripeSubscriptionImmediatelyUsable("trialing")).toBe(true);
    expect(isStripeSubscriptionImmediatelyUsable("past_due")).toBe(false);
    expect(isStripeSubscriptionImmediatelyUsable("incomplete")).toBe(false);
    expect(isStripeSubscriptionImmediatelyUsable("unpaid")).toBe(false);
  });
});
