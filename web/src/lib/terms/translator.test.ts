import { describe, expect, it } from "vitest";
import { VERTICALS } from "@/lib/verticals";
import { createTermsT } from "./translator";

describe("createTermsT", () => {
  it("keeps the old hair_salon error text", () => {
    const t = createTermsT(VERTICALS.hair_salon.terms, "errors");
    expect(t("staff.notFound")).toBe("Stylist not found");
    expect(t("domains.notFound")).toBe(
      "Domain not found or does not belong to this salon",
    );
    expect(t("checkout.insufficientBalance")).toBe(
      "Insufficient Beauty Bank balance",
    );
    expect(t("charges.refundLedgerNote")).toBe(
      "Service refund — Beauty Bank returned",
    );
    expect(t("stripeWebhook.topUpLedgerNote")).toBe("Beauty Bank top-up");
    expect(t("checkout.ledgerNoteMemberDiscount")).toBe(
      "Service checkout (member Beauty Bank discount)",
    );
  });

  it("uses barber words for the barber pack", () => {
    const t = createTermsT(VERTICALS.barber.terms, "errors");
    expect(t("staff.notFound")).toBe("Barber not found");
    expect(t("appointments.staffUnavailable")).toBe(
      "Barber is unavailable at the selected location and time",
    );
    expect(t("domains.notFound")).toBe(
      "Domain not found or does not belong to this shop",
    );
    expect(t("staff.notFound")).not.toMatch(/stylist/i);
  });

  it("interpolates explicit values alongside terms", () => {
    const t = createTermsT(VERTICALS.barber.terms, "errors");
    expect(t("bookingPublic.notOnlineBookable", { serviceName: "Fade" })).toBe(
      "Fade can't be booked online — please contact the shop.",
    );
    expect(t("ownerAccount.soleOwner", { names: "A, B" })).toContain(
      "only owner of A, B.",
    );
  });
});
