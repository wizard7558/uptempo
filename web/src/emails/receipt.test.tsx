import { describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { VERTICALS } from "@/lib/verticals";

const getTenantTerms = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant/industry", () => ({ getTenantTerms }));

import { getEmailT } from "@/lib/terms/email";
import { ReceiptEmail } from "./receipt";

describe("ReceiptEmail", () => {
  it("never mentions card processing: the client pays the listed price", async () => {
    getTenantTerms.mockResolvedValue(VERTICALS.hair_salon.terms);
    const t = await getEmailT("north-co", "emails");
    const html = await render(
      ReceiptEmail({
        t,
        businessName: "North Co",
        clientName: "Ana",
        lineItems: [{ label: "Cut", amountCents: 6000 }],
        tipCents: 0,
        totalCents: 6000,
        paidAtLabel: "Friday, May 1, 2026",
      }),
    );
    const text = await render(
      ReceiptEmail({
        t,
        businessName: "North Co",
        clientName: "Ana",
        lineItems: [{ label: "Cut", amountCents: 6000 }],
        tipCents: 0,
        totalCents: 6000,
        paidAtLabel: "Friday, May 1, 2026",
      }),
      { plainText: true },
    );
    expect(html).toContain("$60.00");
    expect(html.toLowerCase()).not.toContain("card processing");
    expect(text.toLowerCase()).not.toContain("card processing");
  });
});
