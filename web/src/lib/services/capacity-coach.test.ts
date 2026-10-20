import { describe, expect, it, vi } from "vitest";
import { withTenantDb } from "@/lib/db/tenant";

import {
  CAPACITY_WINDOW_DAYS,
  capacityDedupeKey,
  computeCapacityInsight,
  evaluateCapacityForTenant,
  type StaffGoalActuals,
} from "./capacity-coach";

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(),
}));

/** A baseline: $100/hr goal, 30h/wk goal, 4-week window. */
function base(overrides: Partial<StaffGoalActuals> = {}): StaffGoalActuals {
  return {
    staffId: "staff-1",
    staffName: "Emma",
    targetHoursPerWeek: 30,
    targetHourlyEarningsCents: 10_000,
    bookedMinutes: 0,
    earningsCents: 0,
    windowDays: CAPACITY_WINDOW_DAYS,
    services: [],
    ...overrides,
  };
}

describe("computeCapacityInsight", () => {
  it("returns null when goals are unset", () => {
    expect(
      computeCapacityInsight(
        base({ targetHoursPerWeek: 0, bookedMinutes: 6000, earningsCents: 1 }),
      ),
    ).toBeNull();
    expect(
      computeCapacityInsight(
        base({
          targetHourlyEarningsCents: 0,
          bookedMinutes: 6000,
          earningsCents: 1,
        }),
      ),
    ).toBeNull();
  });

  it("returns null when there is no booked time", () => {
    expect(
      computeCapacityInsight(base({ bookedMinutes: 0, earningsCents: 0 })),
    ).toBeNull();
  });

  it("returns null when the staff member is at/above their target rate", () => {
    // 100h over 4 weeks at exactly $100/hr (100h × $100 = $10,000 = 1,000,000¢).
    const insight = computeCapacityInsight(
      base({ bookedMinutes: 6000, earningsCents: 1_000_000 }),
    );
    expect(insight).toBeNull();
  });

  it("returns null inside the tolerance band (just under target)", () => {
    // $96/hr vs $100 goal → within the 5% grace band.
    const insight = computeCapacityInsight(
      base({ bookedMinutes: 6000, earningsCents: 960_000 }),
    );
    expect(insight).toBeNull();
  });

  it("flags an underpaid, not-overworked staff member as info", () => {
    // 35h/wk (140h/4wk) — under the 40h goal — at $70/hr.
    const insight = computeCapacityInsight(
      base({
        targetHoursPerWeek: 40,
        bookedMinutes: 8400,
        earningsCents: 980_000,
      }),
    );
    expect(insight).not.toBeNull();
    expect(insight!.severity).toBe("info");
    expect(insight!.overworked).toBe(false);
    expect(insight!.weeklyHours).toBe(35);
    expect(insight!.hourlyEarningsCents).toBe(7000);
    expect(insight!.title).toMatch(/under your hourly goal/i);
    expect(insight!.dedupeKey).toBe("capacity_coach:staff-1");
  });

  it("flags an overworked + underpaid staff member as a warning and caps the increase", () => {
    // 35h/wk over the 30h goal, at $70/hr vs $100 goal.
    const insight = computeCapacityInsight(
      base({
        targetHoursPerWeek: 30,
        bookedMinutes: 8400,
        earningsCents: 980_000,
        services: [
          {
            serviceId: "mens-cut",
            serviceName: "Men's Cut",
            revenueCents: 20_000,
            minutes: 600,
          },
          {
            serviceId: "extensions",
            serviceName: "Extensions",
            revenueCents: 600_000,
            minutes: 1200,
          },
        ],
      }),
    );
    expect(insight).not.toBeNull();
    expect(insight!.severity).toBe("warning");
    expect(insight!.overworked).toBe(true);
    // raw ≈ 42.8% → capped at 40.
    expect(insight!.suggestedIncreasePct).toBe(40);
    expect(insight!.worstService?.serviceId).toBe("mens-cut");
    expect(insight!.worstService?.revenuePerMinuteCents).toBeCloseTo(33.33, 1);
    expect(insight!.body).toMatch(/Men's Cut/);
    expect(insight!.body).toMatch(/above your 30h\/week target/);
  });

  it("excludes services already at/above the target rate from worstService", () => {
    // Both services priced above $100/hr ($166.7/min target) → no worst service.
    const insight = computeCapacityInsight(
      base({
        bookedMinutes: 8400,
        earningsCents: 700_000, // ~$50/hr → underpaid overall
        services: [
          {
            serviceId: "a",
            serviceName: "A",
            revenueCents: 100_000,
            minutes: 300,
          }, // ~333c/min
          {
            serviceId: "b",
            serviceName: "B",
            revenueCents: 200_000,
            minutes: 600,
          }, // ~333c/min
        ],
      }),
    );
    expect(insight).not.toBeNull();
    expect(insight!.worstService).toBeNull();
    expect(insight!.body).toMatch(/close the gap/);
  });

  it("computes a sensible non-capped increase suggestion", () => {
    // $80/hr vs $100 goal → ~25% increase.
    const insight = computeCapacityInsight(
      base({
        targetHoursPerWeek: 40,
        bookedMinutes: 6000,
        earningsCents: 800_000,
      }),
    );
    expect(insight!.suggestedIncreasePct).toBe(25);
  });
});

describe("capacityDedupeKey", () => {
  it("namespaces by staff member", () => {
    expect(capacityDedupeKey("abc")).toBe("capacity_coach:abc");
  });
});

describe("evaluateCapacityForTenant", () => {
  it("evaluates every tenant with no plan gate", async () => {
    vi.mocked(withTenantDb).mockResolvedValueOnce({
      slug: "business-a",
      skipped: false,
      staffWithGoals: 0,
      alertsUpserted: 0,
      alertsCleared: 0,
    });
    const result = await evaluateCapacityForTenant("business-a", new Date());
    expect(withTenantDb).toHaveBeenCalledWith("business-a", expect.any(Function));
    expect(result.skipped).toBe(false);
  });
});
