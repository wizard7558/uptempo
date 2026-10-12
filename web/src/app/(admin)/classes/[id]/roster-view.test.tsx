import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/actions/classes", () => ({
  addToClass: vi.fn(),
  cancelClass: vi.fn(),
  clientClassCredit: vi.fn(),
  markAttendance: vi.fn(),
  staffCancelEnrollment: vi.fn(),
  updateCapacity: vi.fn(),
}));
vi.mock("@/components/booking/client-search", () => ({ ClientSearch: () => <div data-testid="client-search" /> }));

import { RosterView, type RosterSession } from "./roster-view";
import type { RosterEntry } from "@/actions/classes";

const entry = (over: Partial<RosterEntry>): RosterEntry => ({
  enrollmentId: "e1",
  clientId: "c1",
  name: "Gym A",
  status: "booked",
  waitlistPosition: null,
  usesCredit: false,
  checkedInAt: null,
  ...over,
});

const session: RosterSession = {
  id: "s1",
  className: "Bootcamp",
  staffName: "Jordan",
  whenLabel: "Mon, Jun 15, 6:00 AM to 6:45 AM",
  booked: 2,
  capacity: 5,
  status: "scheduled",
};

function render(props: { session?: Partial<RosterSession>; canAdmin?: boolean; booked?: RosterEntry[]; waitlist?: RosterEntry[] }) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.personal_training.terms}>
        <RosterView
          session={{ ...session, ...props.session }}
          booked={props.booked ?? [entry({}), entry({ enrollmentId: "e2", name: "Gym B", usesCredit: true })]}
          waitlist={props.waitlist ?? []}
          canAdmin={props.canAdmin ?? true}
        />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("RosterView", () => {
  it("shows the header and, per person, a credit or pay-at-place label", () => {
    const html = render({});
    expect(html).toContain("Bootcamp");
    expect(html).toContain("Mon, Jun 15, 6:00 AM to 6:45 AM");
    expect(html).toContain("2 of 5 booked");
    expect(html).toContain("Uses a credit");
    const place = VERTICALS.personal_training.terms.place.one.toLowerCase();
    expect(html).toContain(`Pays at the ${place}`);
    expect(html).toContain(">Checked in<");
    expect(html).toContain(">No-show<");
    expect(html).toContain(">Cancel spot<");
  });

  it("lists the waitlist as #1 Name and uses the customer word for adding", () => {
    const html = render({ waitlist: [entry({ enrollmentId: "w1", name: "Gym C", status: "waitlisted", waitlistPosition: 1 })] });
    expect(html).toContain("#1 Gym C");
    const customer = VERTICALS.personal_training.terms.customer.one.toLowerCase();
    expect(html).toContain(`Add a ${customer}`);
    expect(html).toContain('data-testid="client-search"');
  });

  it("shows Change spots and Cancel class to owners and admins only", () => {
    const owner = render({ canAdmin: true });
    expect(owner).toContain("Change spots");
    expect(owner).toContain(">Cancel class<");
    const provider = render({ canAdmin: false });
    expect(provider).not.toContain("Change spots");
    expect(provider).not.toContain("Cancel class");
    expect(provider).toContain(">Cancel spot<");
  });

  it("shows checked-in and no-show people as words, with no buttons", () => {
    const html = render({
      booked: [entry({ status: "attended" }), entry({ enrollmentId: "e2", name: "Gym B", status: "no_show" })],
    });
    expect(html).toContain("Checked in");
    expect(html).toContain("No-show");
    expect(html).not.toContain(">Cancel spot<");
  });

  it("disables roster actions and says why on a cancelled class", () => {
    const html = render({ session: { status: "cancelled" } });
    expect(html).toContain("This class is cancelled, so its spots can&#x27;t be changed.");
    expect(html).not.toContain("client-search");
    const buttons = html.match(/<button[^>]*>(Checked in|No-show|Cancel spot|Save|Cancel class)<\/button>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toContain("disabled");
  });
});
