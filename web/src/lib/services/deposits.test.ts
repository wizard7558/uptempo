import { describe, it, expect } from "vitest";
import {
  resolveServiceDepositCents,
  resolveBookingDeposit,
  type DepositPolicy,
  type DepositServiceInput,
} from "./deposits";

const noGlobalRule: DepositPolicy = {
  depositEnabled: false,
  depositDefaultType: "percent",
  depositDefaultAmount: 0,
  depositDurationThresholdMinutes: null,
};

const svc = (over: Partial<DepositServiceInput> = {}): DepositServiceInput => ({
  serviceId: "s1",
  serviceName: "Service",
  priceCents: 20000,
  durationMinutes: 120,
  depositType: null,
  depositAmount: null,
  ...over,
});

describe("resolveServiceDepositCents — per-service override", () => {
  it("percent override = percent of price (rounded)", () => {
    expect(
      resolveServiceDepositCents(svc({ depositType: "percent", depositAmount: 25 }), noGlobalRule),
    ).toBe(5000);
    expect(
      resolveServiceDepositCents(
        svc({ priceCents: 12345, depositType: "percent", depositAmount: 30 }),
        noGlobalRule,
      ),
    ).toBe(3704); // round(12345 * 0.30)
  });

  it("fixed override = flat cents", () => {
    expect(
      resolveServiceDepositCents(svc({ depositType: "fixed", depositAmount: 7500 }), noGlobalRule),
    ).toBe(7500);
  });

  it("'none' override forces no deposit even when a global rule would apply", () => {
    const policy: DepositPolicy = {
      depositEnabled: true,
      depositDefaultType: "percent",
      depositDefaultAmount: 50,
      depositDurationThresholdMinutes: null,
    };
    expect(resolveServiceDepositCents(svc({ depositType: "none" }), policy)).toBe(0);
  });

  it("percent override never exceeds the service price", () => {
    expect(
      resolveServiceDepositCents(
        svc({ priceCents: 1000, depositType: "percent", depositAmount: 100 }),
        noGlobalRule,
      ),
    ).toBe(1000);
  });
});

describe("resolveServiceDepositCents — global rule (inherited)", () => {
  const globalPercent: DepositPolicy = {
    depositEnabled: true,
    depositDefaultType: "percent",
    depositDefaultAmount: 20,
    depositDurationThresholdMinutes: 240,
  };

  it("does nothing when the global rule is disabled", () => {
    expect(resolveServiceDepositCents(svc(), noGlobalRule)).toBe(0);
  });

  it("applies the percent rule only at/above the duration threshold", () => {
    // 120 min < 240 threshold → no deposit
    expect(resolveServiceDepositCents(svc({ durationMinutes: 120 }), globalPercent)).toBe(0);
    // 300 min >= 240 threshold → 20% of 20000 = 4000
    expect(resolveServiceDepositCents(svc({ durationMinutes: 300 }), globalPercent)).toBe(4000);
  });

  it("applies a flat global rule with no threshold to every inheriting service", () => {
    const flatAlways: DepositPolicy = {
      depositEnabled: true,
      depositDefaultType: "fixed",
      depositDefaultAmount: 2500,
      depositDurationThresholdMinutes: null,
    };
    expect(resolveServiceDepositCents(svc({ durationMinutes: 30 }), flatAlways)).toBe(2500);
  });
});

describe("resolveBookingDeposit — sum across services", () => {
  it("sums per-service deposits and returns line items", () => {
    const policy: DepositPolicy = {
      depositEnabled: true,
      depositDefaultType: "percent",
      depositDefaultAmount: 10,
      depositDurationThresholdMinutes: 240,
    };
    const services = [
      // override: fixed $50
      svc({ serviceId: "color", serviceName: "Color", depositType: "fixed", depositAmount: 5000 }),
      // inherits global rule, long enough → 10% of 30000 = 3000
      svc({ serviceId: "ext", serviceName: "Extensions", priceCents: 30000, durationMinutes: 300 }),
      // inherits, too short → 0
      svc({ serviceId: "trim", serviceName: "Trim", priceCents: 4000, durationMinutes: 30 }),
    ];
    const result = resolveBookingDeposit(services, policy);
    expect(result.totalCents).toBe(8000);
    expect(result.lines).toEqual([
      { serviceId: "color", serviceName: "Color", depositCents: 5000 },
      { serviceId: "ext", serviceName: "Extensions", depositCents: 3000 },
      { serviceId: "trim", serviceName: "Trim", depositCents: 0 },
    ]);
  });

  it("is zero when nothing requires a deposit", () => {
    const result = resolveBookingDeposit([svc(), svc({ serviceId: "s2" })], noGlobalRule);
    expect(result.totalCents).toBe(0);
  });
});
