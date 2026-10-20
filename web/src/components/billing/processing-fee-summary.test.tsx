// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import { processingRateLabel } from "@/lib/billing/processing-fee";
import messages from "@/i18n/messages/en.json";
import { ProcessingFeeSummary } from "./processing-fee-summary";

afterEach(cleanup);

describe("ProcessingFeeSummary", () => {
  it("shows the card processing line and what the business receives", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TermsProvider terms={VERTICALS.hair_salon.terms}>
          <ProcessingFeeSummary
            amountCents={6000}
            feeCents={300}
            rateLabel={processingRateLabel(500)}
          />
        </TermsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Card processing: 5% ($3.00)")).toBeTruthy();
    expect(screen.getByText("You receive: $57.00")).toBeTruthy();
  });
});
