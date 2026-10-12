import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS, type VerticalTerms } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("@/actions/booking-public", () => ({
  getBookingStaff: vi.fn(),
  getAvailableDates: vi.fn(),
  getAvailableSlots: vi.fn(),
}));
vi.mock("@/actions/slot-waitlist-public", () => ({ joinSlotWaitlist: vi.fn() }));
vi.mock("@/actions/membership", () => ({
  getStoredValuePreviewForClient: vi.fn(),
  createStoredValueTopUpPaymentIntent: vi.fn(),
}));
vi.mock("@/lib/stripe/client", () => ({ stripePromise: null }));
vi.mock("@/actions/stripe", () => ({}));

import { ServiceStep } from "./service-step";
import { StoredValueSection } from "./stored-value-section";
import { TimeStep } from "./time-step";

function wrap(terms: VerticalTerms, children: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={terms}>{children}</TermsProvider>
    </NextIntlClientProvider>,
  );
}

const staffStep = (terms: VerticalTerms) =>
  wrap(
    terms,
    <ServiceStep
      salonId="s1"
      clientId={null}
      selectedStaffId={null}
      selectedServiceIds={[]}
      onComplete={vi.fn()}
    />,
  );

const member = (id: string, name: string) => ({
  id,
  displayName: name,
  photoUrl: null,
  bio: null,
  services: [{ serviceId: "svc", serviceName: "Cut" }],
});

const staffStepWith = (staff: ReturnType<typeof member>[]) =>
  wrap(
    VERTICALS.hair_salon.terms,
    <ServiceStep
      salonId="s1"
      clientId={null}
      selectedStaffId={null}
      selectedServiceIds={[]}
      onComplete={vi.fn()}
      initialStaff={staff}
    />,
  );

const storedValue = (terms: VerticalTerms) =>
  wrap(
    terms,
    <StoredValueSection
      clientId="c1"
      initialData={null}
      subscribeHref="/subscribe/x"
    />,
  );

describe("public booking copy follows industry terms", () => {
  it("staff step says barber for the barber pack", () => {
    const html = staffStep(VERTICALS.barber.terms);
    expect(html).toContain("Choose your barber");
    expect(html).not.toContain("tylist");
  });

  it("keeps 'Choose your stylist' for hair_salon", () => {
    expect(staffStep(VERTICALS.hair_salon.terms)).toContain(
      "Choose your stylist",
    );
  });

  it("membership copy uses the prepaid balance term", () => {
    const barber = storedValue(VERTICALS.barber.terms);
    expect(barber).toContain("Prepaid balance membership");
    expect(barber).not.toContain("Beauty Bank");
    expect(storedValue(VERTICALS.hair_salon.terms)).toContain(
      "Beauty Bank membership",
    );
  });

  it("offers the waitlist without using the word service on the button", () => {
    const html = wrap(
      VERTICALS.hair_salon.terms,
      <TimeStep
        staffId="s1"
        locationId="l1"
        serviceIds={["svc"]}
        salonTimezone="America/New_York"
        onComplete={vi.fn()}
        selectedDate={null}
        selectedTime={null}
        waitlistEnabled
        clientPhone="+15555550100"
      />,
    );
    const button = html.split("<button").find((chunk) => chunk.includes("Join the waitlist"));
    expect(button).toBeDefined();
    expect(button!.split("</button>")[0].toLowerCase()).not.toContain("service");
  });

  it("shows Anyone available when a person can be booked, and that card never says service", () => {
    expect(staffStepWith([])).not.toContain("Anyone available");

    const html = staffStepWith([member("a", "Ava")]);
    expect(html).toContain("Anyone available");
    const card = html.split("<button").find((chunk) => chunk.includes("Anyone available"));
    expect(card).toBeDefined();
    expect(card!.split("</button>")[0].toLowerCase()).not.toContain("service");
  });
});
