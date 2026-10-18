import { describe, expect, it } from "vitest";
import { legacyRedirectTarget, NEW_PRIMARY_ORIGIN } from "./legacy-redirect";

describe("legacyRedirectTarget", () => {
  it.each([
    ["bookuptempo.com", "/quiz", "?src=flyer"],
    ["bookuptempo.com", "/book/demo-salon", ""],
    ["bookuptempo.com", "/login", "?next=/schedule"],
    ["bookuptempo.com", "/api/auth/callback/google", "?code=abc"],
    ["bookuptempo.com", "/waitlist", "?src=expo-2026"],
    ["bookuptempo.com", "/", ""],
  ])(
    "redirects %s%s%s to the canonical origin, preserving path and query",
    (host, pathname, search) => {
      expect(legacyRedirectTarget(host, pathname, search)).toBe(
        `${NEW_PRIMARY_ORIGIN}${pathname}${search}`,
      );
    },
  );

  it("targets https://www.bookuptempo.com", () => {
    expect(legacyRedirectTarget("bookuptempo.com", "/book/acme", "?src=flyer")).toBe(
      "https://www.bookuptempo.com/book/acme?src=flyer",
    );
  });

  it("redirects a path that only shares a prefix with an old marketing label", () => {
    expect(legacyRedirectTarget("bookuptempo.com", "/quizzical", "")).toBe(
      `${NEW_PRIMARY_ORIGIN}/quizzical`,
    );
  });

  it("ignores the port on the host header", () => {
    expect(legacyRedirectTarget("bookuptempo.com:443", "/login", "")).toBe(
      `${NEW_PRIMARY_ORIGIN}/login`,
    );
  });

  it("is case-insensitive on the host", () => {
    expect(legacyRedirectTarget("BookUptempo.com", "/dashboard", "")).toBe(
      `${NEW_PRIMARY_ORIGIN}/dashboard`,
    );
  });

  it.each([
    "/api/stripe/webhook",
    "/api/stripe",
    "/api/twilio/status",
    "/api/twilio/inbound",
    "/api/cron/send-reminders",
    "/api/loopmessage/webhook",
    "/.well-known/apple-app-site-association",
    "/apple-app-site-association",
  ])("leaves callback path %s on the apex host", (pathname) => {
    expect(legacyRedirectTarget("bookuptempo.com", pathname, "")).toBeNull();
  });

  it("does not treat a nearby path as an exempt callback", () => {
    expect(legacyRedirectTarget("bookuptempo.com", "/api/stripe-extra", "")).toBe(
      `${NEW_PRIMARY_ORIGIN}/api/stripe-extra`,
    );
    expect(legacyRedirectTarget("bookuptempo.com", "/api/auth/sign-in", "")).toBe(
      `${NEW_PRIMARY_ORIGIN}/api/auth/sign-in`,
    );
  });

  it.each([
    ["www.bookuptempo.com", "/quiz"],
    ["www.bookuptempo.com", "/book/demo-salon"],
    ["byrende.com", "/quiz"],
    ["www.byrende.com", "/login"],
    ["salon.example.com", "/quiz"],
    ["localhost", "/login"],
    [["emme", "scheduler.vercel.app"].join("-"), "/book/demo-salon"],
  ])("does not redirect %s%s", (host, pathname) => {
    expect(legacyRedirectTarget(host, pathname, "?src=flyer")).toBeNull();
  });

  it.each([null, undefined, ""])("returns null for a missing host (%p)", (host) => {
    expect(legacyRedirectTarget(host, "/quiz", "")).toBeNull();
  });
});
