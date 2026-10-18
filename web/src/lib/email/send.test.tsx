import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const emailsSend = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: emailsSend };
  },
}));

import { buildFromAddress, sendEmail } from "./send";
import { getEmailProvider } from "@/lib/providers/email";

afterEach(() => {
  vi.unstubAllEnvs();
  emailsSend.mockReset();
  vi.restoreAllMocks();
});

describe("buildFromAddress", () => {
  it("stays unchanged in multi mode", () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("EMAIL_FROM", "");
    expect(buildFromAddress("Ada Salon")).toBe(
      "Ada Salon via Uptempo <noreply@bookuptempo.com>",
    );
    expect(buildFromAddress()).toBe("Uptempo <noreply@bookuptempo.com>");
  });

  it("omits the platform name in single mode", () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    vi.stubEnv("EMAIL_FROM", "");
    expect(buildFromAddress("Ada Salon")).toBe(
      "Ada Salon <noreply@bookuptempo.com>",
    );
    expect(buildFromAddress()).toBe("Bookings <noreply@bookuptempo.com>");
  });
});

describe("sendEmail", () => {
  it("renders React to HTML and plain text and sends through Resend", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("RESEND_API_KEY", "re_live_abc");
    vi.stubEnv("SMTP_HOST", "");
    emailsSend.mockResolvedValue({ data: { id: "email_1" }, error: null });

    expect(getEmailProvider().id).toBe("resend");
    const result = await sendEmail({
      to: "a@b.co",
      bcc: ["owner@b.co", "admin@b.co"],
      subject: "Hello",
      idempotencyKey: "billing-notice:test-salon:2026-12-15",
      react: React.createElement("p", null, "Hi there"),
    });

    expect(result).toEqual({ success: true, id: "email_1" });
    expect(emailsSend).toHaveBeenCalledOnce();
    const arg = emailsSend.mock.calls[0][0] as {
      html: string;
      text: string;
      from: string;
      to: string;
      subject: string;
      bcc?: string[];
    };
    expect(arg.html).toContain("Hi there");
    expect(arg.text).toContain("Hi there");
    expect(arg.from).toBe("Uptempo <noreply@bookuptempo.com>");
    expect(arg.to).toBe("a@b.co");
    expect(arg.subject).toBe("Hello");
    expect(arg.bcc).toEqual(["owner@b.co", "admin@b.co"]);
    expect(emailsSend.mock.calls[0][1]).toEqual({
      idempotencyKey: "billing-notice:test-salon:2026-12-15",
    });
  });

  it("selects the console provider and logs when no real key is set", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(getEmailProvider().id).toBe("console");
    const result = await sendEmail({
      to: "a@b.co",
      subject: "Hello",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true });
    expect(emailsSend).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[Email Dev] Would send email:",
      expect.any(String),
    );
    const loggedPayload = log.mock.calls[0][1];
    expect(JSON.parse(String(loggedPayload))).toMatchObject({
      from: "Uptempo <noreply@bookuptempo.com>",
      to: "a@b.co",
      subject: "Hello",
      html: "<p>x</p>",
    });
  });

  it("selects smtp when EMAIL_PROVIDER=smtp", () => {
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    vi.stubEnv("RESEND_API_KEY", "re_live_abc");
    expect(getEmailProvider().id).toBe("smtp");
  });
});
