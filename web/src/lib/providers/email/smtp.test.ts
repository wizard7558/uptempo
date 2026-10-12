import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn(async () => ({ messageId: "mid-1" })));
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail })));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { createSmtpEmailProvider } from "./smtp";

const baseEnv = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "2525",
  SMTP_USER: "user",
  SMTP_PASSWORD: "secret",
  SMTP_SECURE: "true",
};

describe("smtp email provider", () => {
  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
    for (const [key, value] of Object.entries(baseEnv)) {
      vi.stubEnv(key, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes host, port, secure, and auth to sendMail", async () => {
    const result = await createSmtpEmailProvider().send({
      from: "Uptempo <noreply@bookuptempo.com>",
      to: ["a@b.co", "c@d.co"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 2525,
      secure: true,
      auth: { user: "user", pass: "secret" },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "Uptempo <noreply@bookuptempo.com>",
      to: ["a@b.co", "c@d.co"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(result).toEqual({ success: true, id: "mid-1" });
  });

  it("omits auth when SMTP_USER is unset", async () => {
    vi.stubEnv("SMTP_USER", "");
    await createSmtpEmailProvider().send({
      from: "a@b.co",
      to: "c@d.co",
      subject: "s",
      html: "<p>x</p>",
    });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 2525,
      secure: true,
      auth: undefined,
    });
  });
});
