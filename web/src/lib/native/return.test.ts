import { describe, it, expect } from "vitest";
import {
  buildNativeReturnUrl,
  isNativeApp,
  isNativeReturnPath,
} from "./return";
import { generateOAuthState, validateOAuthState } from "@/lib/calendar/oauth";

describe("buildNativeReturnUrl", () => {
  it("builds a custom-scheme deep link with query params", () => {
    const url = buildNativeReturnUrl("owner", "calendar-callback", {
      connected: "abc",
      platform: "google_calendar",
    });
    expect(url).toBe(
      "uptempo-owner://calendar-callback?connected=abc&platform=google_calendar",
    );
  });

  it("omits empty/undefined params and the trailing ?", () => {
    const url = buildNativeReturnUrl("client", "connect-callback", {
      error: undefined,
      connected: "",
    });
    expect(url).toBe("uptempo-client://connect-callback");
  });
});

describe("native guards", () => {
  it("validates app names", () => {
    expect(isNativeApp("owner")).toBe(true);
    expect(isNativeApp("client")).toBe(true);
    expect(isNativeApp("nope")).toBe(false);
    expect(isNativeApp(null)).toBe(false);
  });

  it("validates return paths against the allow-list", () => {
    expect(isNativeReturnPath("calendar-callback")).toBe(true);
    expect(isNativeReturnPath("../../evil")).toBe(false);
    expect(isNativeReturnPath(undefined)).toBe(false);
  });
});

describe("OAuth state native marker", () => {
  it("round-trips the native app through state", () => {
    const state = generateOAuthState("staff-1", "google_calendar", "owner");
    const decoded = validateOAuthState(state);
    expect(decoded).toMatchObject({
      staffId: "staff-1",
      platform: "google_calendar",
      native: "owner",
    });
  });

  it("leaves web state (no native) validating with native undefined", () => {
    const state = generateOAuthState("staff-1", "google_calendar");
    const decoded = validateOAuthState(state);
    expect(decoded?.native).toBeUndefined();
    expect(decoded?.staffId).toBe("staff-1");
  });

  it("rejects a tampered native marker (signature mismatch)", () => {
    // Take a web token and try to inject native=owner without re-signing.
    const state = generateOAuthState("staff-1", "google_calendar");
    const json = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    json.native = "owner";
    const tampered = Buffer.from(JSON.stringify(json)).toString("base64url");
    expect(validateOAuthState(tampered)).toBeNull();
  });
});

describe("validateOAuthState legacy key", () => {
  it("accepts a state minted before the stylistId -> staffId rename", async () => {
    const { createHmac } = await import("crypto");
    const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "fallback-dev-secret";
    const nonce = "abc123";
    const ts = Date.now();
    const sig = createHmac("sha256", secret)
      .update(`legacy-1:google_calendar:${nonce}:${ts}`)
      .digest("base64url");
    const state = Buffer.from(
      JSON.stringify({ stylistId: "legacy-1", platform: "google_calendar", nonce, ts, sig }),
    ).toString("base64url");
    expect(validateOAuthState(state)?.staffId).toBe("legacy-1");
  });
});
