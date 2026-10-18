import { afterEach, describe, expect, it, vi } from "vitest";

import { createConsoleEmailProvider } from "./console";

describe("console email provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the full email payload with the verification HTML and optional plaintext", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const message = {
      from: "Uptempo <noreply@bookuptempo.com>",
      to: "client@example.com",
      subject: "Your verification code",
      html: '<p>Your verification code is <strong>482913</strong>.</p>',
      text: "Your verification code is 482913.",
    };

    const result = await createConsoleEmailProvider().send(message);

    expect(result).toEqual({ success: true });
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[Email Dev] Would send email:",
      JSON.stringify(message),
    );
  });

  it("logs long message bodies without truncation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const html = `<p>${"verification-body-".repeat(700)}</p>`;

    await createConsoleEmailProvider().send({
      from: "noreply@example.com",
      to: "client@example.com",
      subject: "Long message",
      html,
    });

    expect(html.length).toBeGreaterThan(10_000);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][1]).toBe(
      JSON.stringify({
        from: "noreply@example.com",
        to: "client@example.com",
        subject: "Long message",
        html,
      }),
    );
    expect(log.mock.calls[0][1]).toContain(html);
  });
});
