import { describe, expect, it } from "vitest";

import {
  computeBusinessScore,
  type BusinessScoreInputs,
} from "./business-score";

/** A perfect month: full utilization, all repeat, no cancellations, goal met, retail on target. */
function perfect(overrides: Partial<BusinessScoreInputs> = {}): BusinessScoreInputs {
  return {
    utilizationPercent: 100,
    repeatBookingRate: 1,
    cancellationRate: 0,
    revenueVsGoalRatio: 1,
    retailAttachRate: 0.15,
    ...overrides,
  };
}

const NO_EXCLAMATION_OR_EMOJI = /^[^!\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]*$/u;

describe("computeBusinessScore", () => {
  it("scores a perfect month at 100 with a full-marks message", () => {
    const result = computeBusinessScore(perfect());
    expect(result.score).toBe(100);
    expect(result.coachingMessage).toBe(
      "You're performing beautifully across the board. Hold this standard.",
    );
  });

  it("keeps the score an integer within 0..100", () => {
    const result = computeBusinessScore({
      utilizationPercent: 63.7,
      repeatBookingRate: 0.42,
      cancellationRate: 0.05,
      revenueVsGoalRatio: 0.8,
      retailAttachRate: 0.09,
    });
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("caps utilization and revenue-vs-goal over-performance at full marks", () => {
    const result = computeBusinessScore(
      perfect({ utilizationPercent: 180, revenueVsGoalRatio: 3 }),
    );
    expect(result.score).toBe(100);
    expect(result.components.utilization.fraction).toBe(1);
    expect(result.components.revenueVsGoal.fraction).toBe(1);
  });

  it("scores cancellation inversely: 0% full, 10% half, 20%+ zero", () => {
    const full = computeBusinessScore(perfect({ cancellationRate: 0 }));
    const half = computeBusinessScore(perfect({ cancellationRate: 0.1 }));
    const none = computeBusinessScore(perfect({ cancellationRate: 0.2 }));
    const over = computeBusinessScore(perfect({ cancellationRate: 0.5 }));
    expect(full.components.cancellation.fraction).toBe(1);
    expect(half.components.cancellation.fraction).toBeCloseTo(0.5, 5);
    expect(none.components.cancellation.fraction).toBe(0);
    expect(over.components.cancellation.fraction).toBe(0);
  });

  it("redistributes weight proportionally when revenue-vs-goal is null", () => {
    const result = computeBusinessScore(perfect({ revenueVsGoalRatio: null }));
    // Still a perfect performance on every present signal → 100.
    expect(result.score).toBe(100);
    expect(result.components.revenueVsGoal.included).toBe(false);
    expect(result.components.revenueVsGoal.weight).toBe(0);
    const includedWeight =
      result.components.utilization.weight +
      result.components.repeat.weight +
      result.components.cancellation.weight +
      result.components.retail.weight;
    expect(includedWeight).toBeCloseTo(100, 5);
  });

  it("redistributes weight when both optional signals are null", () => {
    const result = computeBusinessScore(
      perfect({ revenueVsGoalRatio: null, retailAttachRate: null }),
    );
    expect(result.components.revenueVsGoal.included).toBe(false);
    expect(result.components.retail.included).toBe(false);
    const includedWeight =
      result.components.utilization.weight +
      result.components.repeat.weight +
      result.components.cancellation.weight;
    expect(includedWeight).toBeCloseTo(100, 5);
    // Utilization base 30 of 70 → 30/70*100 ≈ 42.857.
    expect(result.components.utilization.weight).toBeCloseTo(42.857, 2);
  });

  it("names the single weakest signal below the praise threshold", () => {
    const result = computeBusinessScore({
      utilizationPercent: 0,
      repeatBookingRate: 1,
      cancellationRate: 0,
      revenueVsGoalRatio: null,
      retailAttachRate: null,
    });
    expect(result.score).toBeLessThan(85);
    expect(result.coachingMessage).toBe(
      "Your biggest opportunity right now is filling your calendar.",
    );
  });

  it("names the two weakest signals below the praise threshold", () => {
    const result = computeBusinessScore({
      utilizationPercent: 0,
      repeatBookingRate: 0,
      cancellationRate: 0,
      revenueVsGoalRatio: null,
      retailAttachRate: null,
    });
    expect(result.score).toBeLessThan(85);
    expect(result.coachingMessage).toBe(
      "Focus on filling your calendar and rebooking to lift your score.",
    );
  });

  it("praises but still points at the weakest signal at/above 85", () => {
    const result = computeBusinessScore(perfect({ revenueVsGoalRatio: 0.9 }));
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.coachingMessage).toBe(
      "You're doing beautifully. Keep focusing on revenue against your goal.",
    );
  });

  it("never uses exclamation marks or emoji in the coaching message", () => {
    const cases: BusinessScoreInputs[] = [
      perfect(),
      perfect({ revenueVsGoalRatio: 0.9 }),
      {
        utilizationPercent: 10,
        repeatBookingRate: 0.1,
        cancellationRate: 0.3,
        revenueVsGoalRatio: 0.2,
        retailAttachRate: 0,
      },
      {
        utilizationPercent: 0,
        repeatBookingRate: 0,
        cancellationRate: 0.5,
        revenueVsGoalRatio: null,
        retailAttachRate: null,
      },
    ];
    for (const input of cases) {
      const { coachingMessage } = computeBusinessScore(input);
      expect(coachingMessage).toMatch(NO_EXCLAMATION_OR_EMOJI);
    }
  });
});
