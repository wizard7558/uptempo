import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/charges", () => ({ waiveCharge: vi.fn(), refundCharge: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ChargeLog } from "./charge-log";

function markup(el: ReactElement) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.hair_salon.terms}>{el}</TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("ChargeLog", () => {
  it("renders a pack sale with no appointment as 'Pack sale' without a link", () => {
    const html = markup(
      <ChargeLog
        charges={[
          {
            id: "c1",
            clientName: "Pat Client",
            appointmentId: null,
            amountCents: 45000,
            reason: "package_sale",
            status: "completed",
            failureReason: null,
            createdAt: new Date("2031-03-04T15:00:00Z"),
          },
        ]}
      />,
    );
    expect(html).toContain("Pack sale");
    expect(html).not.toContain("package_sale");
    expect(html).toContain("Pat Client");
    expect(html).toContain("$450.00");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("/appointments/");
  });

  it("shows each row's stored fee and leaves rows without one blank", () => {
    const base = {
      clientName: "Casey",
      appointmentId: null,
      reason: "service_payment",
      status: "completed",
      failureReason: null,
      createdAt: new Date("2026-10-01T12:00:00Z"),
    };
    const html = markup(
      <ChargeLog
        charges={[
          { ...base, id: "a", amountCents: 6000, platformFeeCents: 300 },
          { ...base, id: "b", amountCents: 4000, platformFeeCents: 0 },
          { ...base, id: "c", amountCents: 5000 },
        ]}
      />,
    );
    expect(html).toContain("$3.00");
    expect(html).toContain("Card processing");
    expect(html).not.toContain("$0.00");
  });
});
