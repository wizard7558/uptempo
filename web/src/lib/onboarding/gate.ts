import type { OnboardingState } from "./state";

/**
 * Portal gate: where (if anywhere) to redirect a user hitting an admin route
 * for a tenant that hasn't launched yet.
 *
 * - launched (or unknown) state → no redirect (existing live salons unaffected)
 * - owner / admin → the onboarding wizard (they can complete setup)
 * - anyone else (stylist, assistant, …) → a "still being set up" holding page
 */
export function resolveOnboardingRedirect(
  state: Pick<OnboardingState, "launched"> | null,
  role: string | null | undefined,
): string | null {
  if (!state || state.launched) return null;
  return role === "owner" || role === "admin"
    ? "/onboarding"
    : "/onboarding/pending";
}
