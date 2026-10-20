/**
 * Business Score
 * --------------
 * A single 0–100 read on how the business is performing this month, blended from
 * five signals the dashboard already computes. Pure and deterministic so it can
 * be unit tested exhaustively and rendered without a DB round-trip.
 *
 * Weights (before redistribution):
 *   utilization      30
 *   repeat bookings  25
 *   revenue vs goal  20   (redistributed proportionally when no goal is set)
 *   cancellation     15   (inverse: fewer cancellations scores higher)
 *   retail attach    10   (redistributed proportionally when not applicable)
 *
 * When an optional input is null its weight is spread across the remaining
 * components in proportion to their base weights, so the score always sums to
 * a full 100 of available weight.
 */

import { getVertical, type VerticalTerms } from "@/lib/verticals";
import { createTermsT } from "@/lib/terms/translator";

export interface BusinessScoreInputs {
  /** Tenant terminology for the coaching message; defaults to the general pack. */
  terms?: VerticalTerms;
  /** Booked minutes ÷ available minutes, as a percent (0–100+). */
  utilizationPercent: number;
  /** Share of bookings from returning clients (0–1). */
  repeatBookingRate: number;
  /** Share of bookings cancelled (0–1). */
  cancellationRate: number;
  /** Month revenue ÷ monthly goal; null when no goal is set. */
  revenueVsGoalRatio: number | null;
  /** Retail revenue ÷ service revenue; null when retail is not applicable. */
  retailAttachRate: number | null;
}

export interface BusinessScoreComponent {
  /** False when the input was null and its weight was redistributed away. */
  included: boolean;
  /** Performance on this signal, 0–1. */
  fraction: number;
  /** Effective weight after redistribution (0 when excluded). */
  weight: number;
  /** Points earned toward the score (fraction × weight). */
  points: number;
}

export type BusinessScoreComponentKey =
  | "utilization"
  | "repeat"
  | "revenueVsGoal"
  | "cancellation"
  | "retail";

export interface BusinessScore {
  /** Blended score, integer 0–100. */
  score: number;
  /** One to two sentences, quiet-luxury tone (no exclamation marks, no emoji). */
  coachingMessage: string;
  components: Record<BusinessScoreComponentKey, BusinessScoreComponent>;
}

const BASE_WEIGHTS: Record<BusinessScoreComponentKey, number> = {
  utilization: 30,
  repeat: 25,
  revenueVsGoal: 20,
  cancellation: 15,
  retail: 10,
};

/** Cancellation rate at or above this scores zero on the cancellation signal. */
const CANCELLATION_ZERO_AT = 0.2;

/** Retail attach rate that earns full retail credit. */
const RETAIL_TARGET = 0.15;

/** Score at or above this reads as "doing beautifully". */
const PRAISE_THRESHOLD = 85;

const LABELS: Record<BusinessScoreComponentKey, string> = {
  utilization: "filling your calendar",
  repeat: "rebooking",
  revenueVsGoal: "revenue against your goal",
  cancellation: "reducing cancellations",
  retail: "retail sales",
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Per-signal performance as a 0–1 fraction, or null when the input is absent. */
function fractions(
  inputs: BusinessScoreInputs,
): Record<BusinessScoreComponentKey, number | null> {
  return {
    utilization: clamp01(inputs.utilizationPercent / 100),
    repeat: clamp01(inputs.repeatBookingRate),
    revenueVsGoal:
      inputs.revenueVsGoalRatio == null
        ? null
        : clamp01(inputs.revenueVsGoalRatio),
    cancellation: clamp01(1 - inputs.cancellationRate / CANCELLATION_ZERO_AT),
    retail:
      inputs.retailAttachRate == null
        ? null
        : clamp01(inputs.retailAttachRate / RETAIL_TARGET),
  };
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels[0]} and ${labels[1]}`;
}

/**
 * Compute the blended business score, per-component breakdown, and a short
 * coaching message that praises at/above 85 and otherwise names the one or two
 * signals leaving the most points on the table.
 */
export function computeBusinessScore(
  inputs: BusinessScoreInputs,
): BusinessScore {
  const frac = fractions(inputs);

  const keys = Object.keys(BASE_WEIGHTS) as BusinessScoreComponentKey[];
  const includedKeys = keys.filter((k) => frac[k] != null);
  const includedBaseSum = includedKeys.reduce(
    (sum, k) => sum + BASE_WEIGHTS[k],
    0,
  );
  // Guard against the degenerate all-null case (never happens with current
  // inputs, since three signals are always present).
  const scale = includedBaseSum > 0 ? 100 / includedBaseSum : 0;

  const components = {} as Record<
    BusinessScoreComponentKey,
    BusinessScoreComponent
  >;
  let rawScore = 0;
  for (const key of keys) {
    const f = frac[key];
    if (f == null) {
      components[key] = { included: false, fraction: 0, weight: 0, points: 0 };
      continue;
    }
    const weight = BASE_WEIGHTS[key] * scale;
    const points = f * weight;
    components[key] = { included: true, fraction: f, weight, points };
    rawScore += points;
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Rank included components by points left unearned (weight × shortfall).
  const gaps = includedKeys
    .map((key) => ({ key, gap: components[key].weight * (1 - components[key].fraction) }))
    .filter((g) => g.gap > 0.5)
    .sort((a, b) => b.gap - a.gap);

  const weakest = gaps.slice(0, 2).map((g) => LABELS[g.key]);
  const coachingMessage = buildMessage(score, weakest, inputs.terms ?? getVertical("general").terms);

  return { score, coachingMessage, components };
}

function buildMessage(
  score: number,
  weakest: string[],
  terms: VerticalTerms,
): string {
  if (score >= PRAISE_THRESHOLD) {
    if (weakest.length === 0) {
      return "You're performing beautifully across the board. Hold this standard.";
    }
    return `You're doing beautifully. Keep focusing on ${joinLabels(weakest)}.`;
  }

  if (weakest.length === 0) {
    return createTermsT(terms, "dashboard")("businessScore.steadyMomentum");
  }
  if (weakest.length === 1) {
    return `Your biggest opportunity right now is ${weakest[0]}.`;
  }
  return `Focus on ${joinLabels(weakest)} to lift your score.`;
}
