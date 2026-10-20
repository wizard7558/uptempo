import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS, type VerticalTerms } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/appointments", () => ({
  getAppointmentsForDate: vi.fn(),
}));

import { DayView } from "./day-view";

function render(terms: VerticalTerms) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={terms}>
        <DayView
          staff={[]}
          currentDate={new Date("2026-03-04T12:00:00Z")}
          onSlotClick={vi.fn()}
          onAppointmentSelect={vi.fn()}
          onDragReschedule={vi.fn()}
        />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("schedule copy follows industry terms", () => {
  it("empty day view names barbers for the barber pack", () => {
    const html = render(VERTICALS.barber.terms);
    const plural = VERTICALS.barber.terms.staff.other.toLowerCase();
    expect(html).toContain(`No ${plural} configured. Add ${plural} in Settings.`);
    expect(html).not.toContain("tylist");
  });

  it.each(Object.values(VERTICALS))("uses the staff term for $id", (vertical) => {
    const html = render(vertical.terms);
    const plural = vertical.terms.staff.other.toLowerCase();
    expect(html).toContain(`No ${plural} configured. Add ${plural} in Settings.`);
  });
});
