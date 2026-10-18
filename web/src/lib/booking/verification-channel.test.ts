import { afterEach, describe, expect, it, vi } from "vitest";
import { getBookingVerificationChannel } from "./verification-channel";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBookingVerificationChannel", () => {
  it.each([
    { mode: "single", sms: "none", expected: "email" },
    { mode: "single", sms: "twilio", expected: "phone" },
    { mode: "single", sms: "loopmessage", expected: "phone" },
    { mode: "multi", sms: "none", expected: "phone" },
    { mode: "multi", sms: "twilio", expected: "phone" },
  ])("returns $expected for $mode mode with SMS_PROVIDER=$sms", ({ mode, sms, expected }) => {
    vi.stubEnv("UPTEMPO_MODE", mode);
    vi.stubEnv("SMS_PROVIDER", sms);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");

    expect(getBookingVerificationChannel()).toBe(expected);
  });

  it("uses email when single mode resolves its default provider to none", () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    vi.stubEnv("SMS_PROVIDER", "");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");

    expect(getBookingVerificationChannel()).toBe("email");
  });

  it("keeps invalid SMS provider configuration fail-closed", () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    vi.stubEnv("SMS_PROVIDER", "unsupported");

    expect(() => getBookingVerificationChannel()).toThrow(
      "SMS_PROVIDER must be one of twilio|loopmessage|none",
    );
  });
});
