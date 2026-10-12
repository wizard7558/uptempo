/**
 * Shared onboarding state — the single definition of the wizard's step flags
 * (previously duplicated across the actions, wizard, and sidebar checklist).
 *
 * Stored in `tenants.onboarding_steps` (jsonb on the public table — no tenant
 * migration involved). Reads default missing keys to false so tenants created
 * before a step existed merge forward lazily; writes spread-merge so unknown
 * keys are always preserved. Launched tenants are never re-gated: the portal
 * gate reads only `launched`.
 */

export interface OnboardingState {
  /** Tenant/profile exists (always true once the tenant row is created). */
  profile: boolean;
  /** Derived: at least one service in the catalog. */
  services: boolean;
  /** Derived: at least one working-hours row. */
  hours: boolean;
  /** Explicit: owner reviewed the salon policies step. */
  policies: boolean;
  /** Derived: Stripe Connect account exists. */
  stripe: boolean;
  /** Explicit: owner chose to skip Stripe during onboarding. */
  stripeSkipped: boolean;
  /** Explicit: owner saved branding during onboarding (optional; never blocks). */
  branding: boolean;
  /** Explicit: salon has launched — unlocks the admin portal. */
  launched: boolean;
}

/** Steps that may be explicitly marked complete by the wizard. */
export const MARKABLE_STEPS = ["hours", "policies", "branding"] as const;
export type MarkableStep = (typeof MARKABLE_STEPS)[number];

export function isMarkableStep(step: string): step is MarkableStep {
  return (MARKABLE_STEPS as readonly string[]).includes(step);
}

/** Cache tag for a tenant's onboarding state (shared with connect actions). */
export function onboardingTag(slug: string): string {
  return `tenant:${slug}:onboarding`;
}

/**
 * Back-compat read of the stored jsonb: missing keys → false. Tenants created
 * before `policies`/`stripeSkipped`/`branding` existed resolve them as
 * incomplete, which is correct — and irrelevant post-launch.
 */
export function readStoredSteps(
  stored: Record<string, unknown> | null | undefined,
): Pick<OnboardingState, "policies" | "stripeSkipped" | "branding" | "launched"> {
  const s = stored ?? {};
  return {
    policies: s.policies === true,
    stripeSkipped: s.stripeSkipped === true,
    branding: s.branding === true,
    launched: s.launched === true,
  };
}

export type LaunchPrereq = "services" | "hours" | "policies" | "payments";

/**
 * What still blocks launch. Branding and Stripe-the-actual-connection never
 * block — but the owner must have made an explicit payments CHOICE (connect or
 * skip). Pure so the wizard, launch validation, and tests share one rule.
 */
/**
 * Public booking stays open for tenants created before publish existed.
 * A new signup stores `launched: false` until the owner publishes.
 */
export function isBookingPageOpen(steps: unknown): boolean {
  if (!steps || typeof steps !== "object" || Array.isArray(steps)) return true;
  if (!Object.prototype.hasOwnProperty.call(steps, "launched")) return true;
  return (steps as { launched?: unknown }).launched === true;
}

export function getMissingLaunchPrereqs(state: {
  services: boolean;
  hours: boolean;
  policies: boolean;
  stripe: boolean;
  stripeSkipped: boolean;
}): LaunchPrereq[] {
  const missing: LaunchPrereq[] = [];
  if (!state.services) missing.push("services");
  if (!state.hours) missing.push("hours");
  if (!state.policies) missing.push("policies");
  if (!state.stripe && !state.stripeSkipped) missing.push("payments");
  return missing;
}
