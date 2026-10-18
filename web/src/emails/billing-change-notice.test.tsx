import { describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { VERTICALS } from "@/lib/verticals";

vi.mock("@/lib/tenant/industry", () => ({
  getTenantTerms: async () => VERTICALS.hair_salon.terms,
}));

import { getEmailT } from "@/lib/terms/email";
import { BillingChangeNotice } from "./billing-change-notice";

describe("BillingChangeNotice", () => {
  it("renders the scheduled date, the 5% line, estimate, and usage period without forbidden terms", async () => {
    const t = await getEmailT("test-salon", "emails");
    expect(t("billingChange.subject", { date: "December 15, 2026" })).toBe(
      "Your Uptempo price changes on December 15, 2026",
    );
    const html = await render(
      BillingChangeNotice({
        t,
        businessName: "Northside Studio",
        date: "December 15, 2026",
        currentRate: "5%",
        amount: "$33.00",
        activeProviders: 3,
        textsObserved: 100,
        textPeriodStart: "November 15, 2026",
        textPeriodEnd: "December 14, 2026",
        hasTextLine: true,
        usesSharedLine: true,
      }),
    );
    const plainText = await render(
      BillingChangeNotice({
        t,
        businessName: "Northside Studio",
        date: "December 15, 2026",
        currentRate: "5%",
        amount: "$33.00",
        activeProviders: 3,
        textsObserved: 100,
        textPeriodStart: "November 15, 2026",
        textPeriodEnd: "December 14, 2026",
        hasTextLine: true,
        usesSharedLine: true,
      }),
      { plainText: true },
    );

    for (const content of [html, plainText]) {
      expect(content).toContain("December 15, 2026");
      expect(content).toContain("Card processing: 5% of card payments");
      expect(content).toContain("$33.00");
      expect(content).toContain("November 15, 2026");
      expect(content).toContain("December 14, 2026");
      expect(content).toContain("without a setup charge");
      expect(content.toLowerCase()).not.toContain("stripe");
      expect(content.toLowerCase()).not.toContain("at cost");
      expect(content.toLowerCase()).not.toContain("fee breakdown");
    }
  });

  it("omits text charges and shared-number setup copy when text is not billable", async () => {
    const t = await getEmailT("test-salon", "emails");
    const content = await render(
      BillingChangeNotice({
        t,
        businessName: "Northside Studio",
        date: "December 15, 2026",
        currentRate: "5%",
        amount: "$12.00",
        activeProviders: 1,
        textsObserved: 5,
        textPeriodStart: "November 15, 2026",
        textPeriodEnd: "December 14, 2026",
        hasTextLine: false,
        usesSharedLine: false,
      }),
    );

    expect(content).not.toContain("Text reminders: $4 a month");
    expect(content).not.toContain("without a setup charge");
    expect(content).toContain("$12.00");
  });
});
