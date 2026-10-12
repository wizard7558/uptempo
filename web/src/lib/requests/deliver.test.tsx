import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";

const sendEmail = vi.fn();
const sendSms = vi.fn();
const load = vi.fn();

vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/sms/send", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));
vi.mock("@/lib/email/branding", () => ({
  getEmailBranding: async () => ({ salonName: "Ink Co", logoUrl: null }),
}));
vi.mock("./deliver-data", () => ({ loadQuoteForDelivery: (...a: unknown[]) => load(...a) }));
vi.mock("@/lib/terms/email", () => ({
  getEmailT: async (_slug: string, ns: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return String(node).replace(/\{(\w+)\}/g, (m, k) => (k in (values ?? {}) ? String(values?.[k]) : m));
  },
}));

import { absoluteQuoteUrl, deliverQuote } from "./deliver";

const data = {
  token: "tok_abcdefghijklmnopqrstuvwxyz012345",
  clientId: "c1",
  clientName: "Casey",
  clientEmail: "casey@example.com",
  clientPhone: "+15551230000",
  subtotalCents: 70000,
  depositCents: 10000,
  validUntilLabel: "October 23, 2026",
  lines: [{ description: "Sleeve session", quantity: 1, unitCents: 60000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
  sendEmail.mockResolvedValue({ success: true });
  sendSms.mockResolvedValue({ success: true });
  load.mockResolvedValue(data);
});

describe("deliverQuote", () => {
  const link = `https://app.example.com/book/acme/quote/${data.token}`;

  it("builds the link from the public base URL", () => {
    expect(absoluteQuoteUrl("acme", data.token)).toBe(link);
  });

  it("emails the client with the link and totals", async () => {
    await deliverQuote("acme", "q1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe("casey@example.com");
    expect(arg.subject).toBe("Your quote from Ink Co");
    expect(arg.react.props).toMatchObject({
      link,
      totalLabel: "$700.00",
      depositLabel: "$100.00",
      validUntilLabel: "October 23, 2026",
    });
  });

  it("texts the client a plain ASCII message that contains the link", async () => {
    await deliverQuote("acme", "q1");
    expect(sendSms).toHaveBeenCalledTimes(1);
    const arg = sendSms.mock.calls[0][0];
    expect(arg).toMatchObject({ to: "+15551230000", tenantSlug: "acme", clientId: "c1", messageType: "quote" });
    expect(arg.body).toContain(link);
    expect(arg.body).toContain("$700.00");
    expect(arg.body).toMatch(/^[\x20-\x7E]*$/);
  });

  it("skips the channel a client has no address for", async () => {
    load.mockResolvedValue({ ...data, clientEmail: null, clientPhone: null });
    await deliverQuote("acme", "q1");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("still texts when the email fails", async () => {
    sendEmail.mockRejectedValue(new Error("smtp down"));
    await deliverQuote("acme", "q1");
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the quote is gone", async () => {
    load.mockResolvedValue(null);
    await deliverQuote("acme", "q1");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
