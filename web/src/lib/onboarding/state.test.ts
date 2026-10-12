import { describe, expect, it } from "vitest";
import {
  getMissingLaunchPrereqs,
  isBookingPageOpen,
  isMarkableStep,
  onboardingTag,
  readStoredSteps,
} from "./state";
import { resolveOnboardingRedirect } from "./gate";

describe("readStoredSteps — back-compat merge", () => {
  it("defaults missing keys to false for legacy tenants", () => {
    // A tenant created before policies/stripeSkipped/branding existed.
    const legacy = {
      profile: true,
      services: true,
      hours: true,
      stripe: false,
      launched: true,
    };
    expect(readStoredSteps(legacy)).toEqual({
      policies: false,
      stripeSkipped: false,
      branding: false,
      launched: true, // preserved — launched tenants are never re-gated
    });
  });

  it("handles null/undefined/garbage stored values", () => {
    expect(readStoredSteps(null)).toEqual({
      policies: false,
      stripeSkipped: false,
      branding: false,
      launched: false,
    });
    expect(
      readStoredSteps({ policies: "yes", launched: 1 } as Record<
        string,
        unknown
      >),
    ).toEqual({
      policies: false, // only literal true counts
      stripeSkipped: false,
      branding: false,
      launched: false,
    });
  });
});

describe("isBookingPageOpen", () => {
  it("keeps older tenants bookable when launched was never stored", () => {
    expect(isBookingPageOpen({ profile: true, services: true })).toBe(true);
    expect(isBookingPageOpen(null)).toBe(true);
    expect(isBookingPageOpen(undefined)).toBe(true);
  });

  it("closes a new signup until publish and opens after launch", () => {
    expect(isBookingPageOpen({ launched: false })).toBe(false);
    expect(isBookingPageOpen({ launched: true })).toBe(true);
  });
});

describe("getMissingLaunchPrereqs", () => {
  const complete = {
    services: true,
    hours: true,
    policies: true,
    stripe: true,
    stripeSkipped: false,
  };

  it("returns empty when everything required is done", () => {
    expect(getMissingLaunchPrereqs(complete)).toEqual([]);
  });

  it("accepts an explicit Stripe skip in place of a connection", () => {
    expect(
      getMissingLaunchPrereqs({ ...complete, stripe: false, stripeSkipped: true }),
    ).toEqual([]);
  });

  it("requires a payments CHOICE (neither connected nor skipped blocks)", () => {
    expect(
      getMissingLaunchPrereqs({ ...complete, stripe: false, stripeSkipped: false }),
    ).toEqual(["payments"]);
  });

  it("reports each missing prereq", () => {
    expect(
      getMissingLaunchPrereqs({
        services: false,
        hours: false,
        policies: false,
        stripe: false,
        stripeSkipped: false,
      }),
    ).toEqual(["services", "hours", "policies", "payments"]);
  });

  it("never blocks on branding (not part of the rule at all)", () => {
    // Type-level: branding isn't even an input. This documents the intent.
    expect(getMissingLaunchPrereqs(complete)).toEqual([]);
  });
});

describe("isMarkableStep", () => {
  it("allows exactly hours/policies/branding", () => {
    expect(isMarkableStep("hours")).toBe(true);
    expect(isMarkableStep("policies")).toBe(true);
    expect(isMarkableStep("branding")).toBe(true);
    expect(isMarkableStep("launched")).toBe(false); // must go through launchSalon
    expect(isMarkableStep("stripe")).toBe(false); // derived
    expect(isMarkableStep("stripeSkipped")).toBe(false); // must go through skipStripeForNow
  });
});

describe("resolveOnboardingRedirect (portal gate)", () => {
  const unlaunched = { launched: false };
  const launched = { launched: true };

  it("never redirects launched tenants (grandfathering)", () => {
    expect(resolveOnboardingRedirect(launched, "owner")).toBeNull();
    expect(resolveOnboardingRedirect(launched, "stylist")).toBeNull();
    expect(resolveOnboardingRedirect(launched, "provider")).toBeNull();
  });

  it("never redirects when state is unknown (degenerate tenants)", () => {
    expect(resolveOnboardingRedirect(null, "owner")).toBeNull();
  });

  it("sends owners and admins to the wizard", () => {
    expect(resolveOnboardingRedirect(unlaunched, "owner")).toBe("/onboarding");
    expect(resolveOnboardingRedirect(unlaunched, "admin")).toBe("/onboarding");
  });

  it("sends non-managers to the pending page", () => {
    expect(resolveOnboardingRedirect(unlaunched, "stylist")).toBe(
      "/onboarding/pending",
    );
    expect(resolveOnboardingRedirect(unlaunched, "provider")).toBe(
      "/onboarding/pending",
    );
    expect(resolveOnboardingRedirect(unlaunched, "assistant")).toBe(
      "/onboarding/pending",
    );
    expect(resolveOnboardingRedirect(unlaunched, null)).toBe(
      "/onboarding/pending",
    );
  });
});

describe("onboardingTag", () => {
  it("is stable per slug", () => {
    expect(onboardingTag("test-salon")).toBe("tenant:test-salon:onboarding");
  });
});
