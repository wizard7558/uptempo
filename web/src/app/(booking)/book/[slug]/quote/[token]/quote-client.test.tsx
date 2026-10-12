import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("@/actions/quotes-public", () => ({
  acceptQuote: vi.fn(),
  declineQuote: vi.fn(),
  getQuoteDays: vi.fn(async () => []),
  getQuoteSlots: vi.fn(async () => []),
}));
vi.mock("@/components/booking-public/confirm-pay-step", () => ({ PaymentStep: () => null }));

import { QuoteClient } from "./quote-client";
import type { QuotePageData } from "@/actions/quotes-public";

const open: QuotePageData = {
  state: "open",
  businessName: "Ink Co",
  clientFirstName: "Casey",
  quote: {
    subtotalCents: 60000,
    depositCents: 10000,
    message: "Looking forward to it.",
    validUntilLabel: "October 23, 2026",
    staffId: null,
  },
  lines: [{ description: "Half-day session", quantity: 1, unitCents: 60000 }],
};

function render(data: QuotePageData) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.tattoo.terms}>
        <QuoteClient token={"t".repeat(32)} data={data} />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("QuoteClient", () => {
  it("shows the price, the deposit due today and the expiry", () => {
    const html = render(open);
    expect(html).toContain("Your quote from Ink Co");
    expect(html).toContain("$600.00");
    expect(html).toContain("Deposit due today");
    expect(html).toContain("$100.00");
    expect(html).toContain("Good until October 23, 2026");
    expect(html).toContain("Looking forward to it.");
    expect(html).toContain("Choose a time");
    expect(html).toContain("No thanks");
  });

  it("hides the deposit line when there is no deposit", () => {
    const html = render({ ...open, quote: { ...open.quote!, depositCents: 0 } });
    expect(html).not.toContain("Deposit due today");
  });

  it("never uses the word 'service' on the page (the booking specs click buttons by that word)", () => {
    expect(render(open).toLowerCase()).not.toContain("service");
  });

  it.each([
    ["expired", "This quote has expired. Contact Ink Co for a new one."],
    ["declined", "You declined this quote."],
    ["withdrawn", "This quote is no longer available."],
    ["unavailable", "This page isn&#x27;t available."],
    ["accepted", "You already accepted this quote."],
  ] as const)("says it in words when the quote is %s", (state, text) => {
    const html = render({ ...open, state, quote: null, lines: [] });
    expect(html).toContain(text);
    expect(html).not.toContain("Choose a time");
  });

  it("shows when an accepted quote was booked", () => {
    const html = render({
      ...open,
      state: "accepted",
      booked: { dateLabel: "Friday, October 16, 2026", timeLabel: "10:00 AM", staffName: "Riley" },
    });
    expect(html).toContain("Friday, October 16, 2026 at 10:00 AM with Riley");
  });
});
