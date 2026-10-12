import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createTermsT } from "@/lib/terms/translator";
import { VERTICALS } from "@/lib/verticals";

const sendEmail = vi.fn();
const sendSms = vi.fn();

vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/sms/send", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));
vi.mock("@/lib/email/branding", () => ({
  getEmailBranding: async () => ({ salonName: "Ink Co", logoUrl: null }),
}));
vi.mock("@/lib/terms/email", () => ({
  getEmailT: async (_slug: string, ns: string) => createTermsT(VERTICALS.tattoo.terms, ns),
}));

import { absoluteProjectUrl, deliverDesign } from "./deliver";

const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz012345";
const link = `https://app.example.com/book/acme/project/${TOKEN}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
  sendEmail.mockResolvedValue({ success: true });
  sendSms.mockResolvedValue({ success: true });
});

describe("deliverDesign", () => {
  it("builds the link under the booking path, like quote links", () => {
    expect(absoluteProjectUrl("acme", TOKEN)).toBe(link);
  });

  it("texts a plain-ASCII message with the link and emails the client", async () => {
    await deliverDesign("acme", { clientId: "c1", email: "casey@example.com", phone: "+15551230000", token: TOKEN });
    const sms = sendSms.mock.calls[0][0] as { body: string; to: string; messageType: string };
    expect(sms.body).toBe(`Ink Co: your design is ready to review: ${link}`);
    expect(sms.body).toMatch(/^[\x20-\x7e]*$/);
    expect(sms.to).toBe("+15551230000");
    const mail = sendEmail.mock.calls[0][0] as { to: string; subject: string };
    expect(mail).toMatchObject({ to: "casey@example.com", subject: "Your design from Ink Co" });
    // The email has its own copy: heading, body and a button, not the SMS line.
    const html = renderToStaticMarkup((mail as unknown as { react: React.ReactElement }).react);
    expect(html).toContain("Your design is ready");
    expect(html).toContain("Ink Co has shared a design with you. Your artist can walk you through it.");
    expect(html).toContain("Review your design");
    expect(html).toContain(link);
    expect(html).not.toContain("is ready to review");
  });

  it("skips a channel the client has no address for, and survives a failing one", async () => {
    sendSms.mockRejectedValue(new Error("down"));
    await deliverDesign("acme", { clientId: "c1", email: null, phone: "+15551230000", token: TOKEN });
    expect(sendEmail).not.toHaveBeenCalled();
    await deliverDesign("acme", { clientId: "c1", email: "a@b.co", phone: null, token: TOKEN });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
