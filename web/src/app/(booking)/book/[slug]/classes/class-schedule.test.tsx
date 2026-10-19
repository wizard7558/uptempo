import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("@/actions/booking-public", () => ({ updateClientName: vi.fn(), getAgeGateForServices: vi.fn() }));
vi.mock("@/actions/classes-public", () => ({
  bookClassSpot: vi.fn(),
  cancelMyClassSpot: vi.fn(),
  getClassAgeGate: vi.fn(),
  getClassCreditOption: vi.fn(),
  listPublicClasses: vi.fn(),
  myClassSpots: vi.fn(),
}));

import { CLASS_ERROR_CODES, ClassSchedule, ClassScheduleCard, classErrorKey } from "./class-schedule";
import type { MyClassSpot, PublicClass } from "@/actions/classes-public";

const TZ = "America/New_York";
// 6:00 AM New York on 2027-06-15 (EDT, UTC-4).
const SIX = "2027-06-15T10:00:00.000Z";
const SIX_45 = "2027-06-15T10:45:00.000Z";

const cls = (over: Partial<PublicClass>): PublicClass => ({
  id: "11111111-1111-4111-8111-111111111111",
  className: "Bootcamp",
  staffFirstName: "Jordan",
  start: SIX,
  end: SIX_45,
  spotsLeft: 3,
  waitlistOpen: false,
  priceCents: 2000,
  ...over,
});

function wrap(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.personal_training.terms}>{node}</TermsProvider>
    </NextIntlClientProvider>,
  );
}

function render(classes: PublicClass[], mine: MyClassSpot[] = []) {
  return wrap(
    <ClassSchedule
      businessId="s1"
      salonName="Test Gym"
      timezone={TZ}
      classes={classes}
      mine={mine}
      client={null}
      today="2026-10-11"
    />,
  );
}

describe("ClassSchedule", () => {
  it("renders a week and the spot sentences", () => {
    const html = render([
      cls({}),
      cls({
        id: "33333333-3333-4333-8333-333333333333",
        className: "Yoga",
        spotsLeft: 0,
        waitlistOpen: true,
      }),
    ]);
    expect(html).toContain("Week of Jun 14 to Jun 20");
    expect(html).toContain("Mon, Jun 14");
    expect(html).toContain("Tue, Jun 15");
    expect(html).toContain("Sun, Jun 20");
    expect(html).toContain("6:00 AM to 6:45 AM");
    expect(html).toContain("Bootcamp");
    expect(html).toContain("Trainer Jordan");
    expect(html).toContain("3 spots left");
    expect(html).toContain("Full, join the waitlist");
    expect(html).toContain("Step 1 of 4");
  });

  it("says Full, join the waitlist when the class is full", () => {
    const html = render([cls({ spotsLeft: 0, waitlistOpen: true })]);
    expect(html).toContain("Full, join the waitlist");
    expect(html).not.toContain("spots left");
  });

  it("disables the button when the waitlist is full too", () => {
    const html = render([cls({ spotsLeft: 0, waitlistOpen: false })]);
    expect(html).toContain("Waitlist full");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Waitlist full[\s\S]*?<\/button>/);
    expect(html).not.toContain("Full, join the waitlist");
  });

  it("says so in plain words when nothing is coming up", () => {
    expect(render([])).toContain("There are no classes coming up in the next 2 weeks.");
  });

  it("lists my classes with Booked and a cancel button", () => {
    const html = render([], [
      {
        enrollmentId: "22222222-2222-4222-8222-222222222222",
        className: "Bootcamp",
        start: SIX,
        end: SIX_45,
        status: "booked",
        waitlistPosition: null,
        usesCredit: true,
        isLate: false,
        windowHours: 24,
      },
    ]);
    expect(html).toContain("My classes");
    expect(html).toContain("Booked");
    expect(html).toContain("Cancel my spot");
  });
});

describe("ClassScheduleCard", () => {
  it("has the card words and never the word service", () => {
    const html = wrap(<ClassScheduleCard slug="test-gym" />);
    expect(html).toContain("Group classes");
    expect(html).toContain("See the class schedule");
    expect(html).toContain('href="/book/test-gym/classes"');
    expect(html.replace(/<[^>]*>/g, "").toLowerCase()).not.toContain("service");
  });
});

describe("classErrorKey", () => {
  const errors = (messages.classes.public.errors as Record<string, string>);

  it("gives every engine error code its own sentence", () => {
    for (const code of ["FULL", "CLOSED", "ALREADY", "STARTED", "UNDERAGE", "DOB_REQUIRED"]) {
      expect(CLASS_ERROR_CODES).toContain(code);
    }
    for (const code of CLASS_ERROR_CODES) {
      const key = classErrorKey(code);
      expect(key).toBe(`public.errors.${code}`);
      expect(errors[code], code).toBeTruthy();
    }
    const sentences = CLASS_ERROR_CODES.map((c) => errors[c]);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("falls back to the generic sentence for an unknown code", () => {
    expect(classErrorKey("NOPE")).toBe("public.errors.generic");
    expect(errors.generic).toBeTruthy();
  });
});
