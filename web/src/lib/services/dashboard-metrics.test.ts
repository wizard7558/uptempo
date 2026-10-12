import { describe, expect, it } from "vitest";

import {
  avgTicketCents,
  capacityStatusLabel,
  computeBookedOutWeeks,
  estimatedAnnualImpactCents,
  goalProgressRatio,
  initialsFromName,
  makeKpi,
  pickLowRoiService,
  safeRatio,
  topServiceByRevenue,
  type ServiceShareInput,
} from "./dashboard-metrics";

describe("makeKpi", () => {
  it("computes the delta from current and last-month values", () => {
    expect(makeKpi(120, 100)).toEqual({
      value: 120,
      lastMonthValue: 100,
      delta: 20,
    });
    expect(makeKpi(80, 100).delta).toBe(-20);
  });
});

describe("safeRatio", () => {
  it("divides normally and guards a non-positive denominator", () => {
    expect(safeRatio(3, 12)).toBe(0.25);
    expect(safeRatio(5, 0)).toBe(0);
    expect(safeRatio(5, -1)).toBe(0);
  });
});

describe("avgTicketCents", () => {
  it("rounds revenue per completed appointment", () => {
    expect(avgTicketCents(10_000, 3)).toBe(3333);
    expect(avgTicketCents(10_000, 0)).toBe(0);
  });
});

describe("computeBookedOutWeeks", () => {
  it("returns weeks booked to one decimal", () => {
    // 6000 booked minutes over a 2400-minute week = 2.5 weeks.
    expect(computeBookedOutWeeks(6000, 2400)).toBe(2.5);
    // 2500 / 2400 ≈ 1.0417 → 1.0.
    expect(computeBookedOutWeeks(2500, 2400)).toBe(1);
  });

  it("guards zero weekly availability", () => {
    expect(computeBookedOutWeeks(6000, 0)).toBe(0);
  });
});

describe("goalProgressRatio", () => {
  it("returns the ratio when a positive goal is set", () => {
    expect(goalProgressRatio(500_000, 1_000_000)).toBe(0.5);
  });

  it("returns null when there is no goal or the goal is non-positive", () => {
    expect(goalProgressRatio(500_000, null)).toBeNull();
    expect(goalProgressRatio(500_000, 0)).toBeNull();
  });
});

const services: ServiceShareInput[] = [
  { serviceId: "a", serviceName: "Color", revenueCents: 60_000, minutes: 300 },
  { serviceId: "b", serviceName: "Blowout", revenueCents: 10_000, minutes: 400 },
  { serviceId: "c", serviceName: "Cut", revenueCents: 30_000, minutes: 100 },
];

describe("topServiceByRevenue", () => {
  it("returns the highest-revenue service with its revenue share", () => {
    const top = topServiceByRevenue(services);
    expect(top).not.toBeNull();
    expect(top!.serviceId).toBe("a");
    expect(top!.revenueShareRatio).toBeCloseTo(0.6, 5);
  });

  it("returns null with no revenue", () => {
    expect(topServiceByRevenue([])).toBeNull();
    expect(
      topServiceByRevenue([
        { serviceId: "z", serviceName: "Free", revenueCents: 0, minutes: 50 },
      ]),
    ).toBeNull();
  });
});

describe("pickLowRoiService", () => {
  it("picks the service whose time share most exceeds its revenue share", () => {
    // Blowout: revenue share 0.10, time share 0.5 → imbalance 0.4 (largest).
    const low = pickLowRoiService(services);
    expect(low).not.toBeNull();
    expect(low!.serviceId).toBe("b");
    expect(low!.revenueShareRatio).toBeCloseTo(0.1, 5);
    expect(low!.timeShareRatio).toBeCloseTo(0.5, 5);
  });

  it("returns null when time and revenue shares are perfectly aligned", () => {
    const balanced: ServiceShareInput[] = [
      { serviceId: "a", serviceName: "A", revenueCents: 100, minutes: 100 },
      { serviceId: "b", serviceName: "B", revenueCents: 100, minutes: 100 },
    ];
    expect(pickLowRoiService(balanced)).toBeNull();
  });

  it("returns null with insufficient data", () => {
    expect(pickLowRoiService([])).toBeNull();
  });
});

describe("capacityStatusLabel", () => {
  it("labels utilization bands", () => {
    expect(capacityStatusLabel(90)).toBe("At capacity");
    expect(capacityStatusLabel(70)).toBe("Healthy");
    expect(capacityStatusLabel(40)).toBe("Room to grow");
    expect(capacityStatusLabel(10)).toBe("Underbooked");
  });
});

describe("initialsFromName", () => {
  it("takes up to two uppercase initials", () => {
    expect(initialsFromName("Emma Stone")).toBe("ES");
    expect(initialsFromName("Emma")).toBe("E");
    expect(initialsFromName("  emma  van  stone ")).toBe("EV");
  });

  it("falls back to a placeholder for an empty name", () => {
    expect(initialsFromName("")).toBe("?");
    expect(initialsFromName("   ")).toBe("?");
  });
});

describe("estimatedAnnualImpactCents", () => {
  it("annualizes the hourly gap at current weekly hours", () => {
    // ($10/hr gap) * 20h/wk * 52 = $10,400 → 1,040,000 cents.
    expect(estimatedAnnualImpactCents(11_000, 10_000, 20)).toBe(1_040_000);
  });

  it("returns null when already at or above target, or inputs are missing", () => {
    expect(estimatedAnnualImpactCents(10_000, 10_000, 20)).toBeNull();
    expect(estimatedAnnualImpactCents(9_000, 10_000, 20)).toBeNull();
    expect(estimatedAnnualImpactCents(undefined, 10_000, 20)).toBeNull();
    expect(estimatedAnnualImpactCents(11_000, 10_000, 0)).toBeNull();
  });
});
