import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS, type ModuleId } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import type { UserMembershipRow } from "@/actions/team";

vi.mock("next/navigation", () => ({
  usePathname: () => "/schedule",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/team", () => ({ switchActiveTenant: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/lib/native/push-register", () => ({ revokeNativePush: vi.fn() }));

import { AdminSidebar } from "./admin-sidebar";

function render(
  terms: (typeof VERTICALS)["barber"]["terms"],
  enabledModules?: ModuleId[],
  memberships: UserMembershipRow[] = [],
  activeTenantSlug: string | null = null,
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <TermsProvider terms={terms}>
        <ThemeProvider>
          <SidebarProvider>
            <AdminSidebar
              role="owner"
              tenantSlug="demo"
              enabledModules={enabledModules}
              memberships={memberships}
              activeTenantSlug={activeTenantSlug}
            />
          </SidebarProvider>
        </ThemeProvider>
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

const HAIR_SALON_ORDER = [
  "Calendar",
  "Clients",
  "Services",
  "Walk-ins",
  "Waitlist",
  "Requests",
  "Projects",
  "Classes",
  "Gift cards",
  "Payments",
  "Expenses",
  "Reports",
  "Settings",
];

function labelIndexes(html: string, labels: string[]): number[] {
  return labels.map((label) => html.indexOf(`>${label}<`));
}

describe("AdminSidebar", () => {
  it("shows the active business name", () => {
    const html = render(
      VERTICALS.hair_salon.terms,
      undefined,
      [
        { tenantSlug: "other", role: "provider", businessName: "Other Shop" },
        { tenantSlug: "demo", role: "owner", businessName: "Northwind Hair" },
      ],
      "demo",
    );
    expect(html).toContain(">Northwind Hair<");
    expect(html).not.toContain(">Scheduling<");
  });

  it("falls back to Scheduling when there is no membership name", () => {
    expect(render(VERTICALS.hair_salon.terms)).toContain(">Scheduling<");
  });

  it("lists the calendar-first order for a hair salon", () => {
    const html = render(VERTICALS.hair_salon.terms, [
      "walk_in_queue",
      "slot_waitlist",
      "requests",
      "projects",
      "classes",
      "gift_cards",
    ]);
    const indexes = labelIndexes(html, HAIR_SALON_ORDER);
    for (const label of HAIR_SALON_ORDER) {
      expect(html, label).toContain(`>${label}<`);
    }
    const sorted = [...indexes].sort((a, b) => a - b);
    expect(indexes).toEqual(sorted);
    expect(html).not.toContain(">Dashboard<");
    expect(html).not.toContain(">Team<");
    expect(html).not.toContain('href="/revenue"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain(">Get help<");
    expect(html).toContain('href="mailto:support@bookuptempo.com"');
  });

  it("uses home-services words for customers and services", () => {
    const html = render(VERTICALS.home_services.terms);
    expect(html).toContain(">Customers<");
    expect(html).toContain(">Services<");
    expect(html).not.toContain(">Clients<");
  });

  it("shows barber terminology", () => {
    const html = render(VERTICALS.barber.terms);
    expect(html).toContain(">Clients<");
    expect(html).toContain(">Services<");
    expect(html).toContain(">Calendar<");
    expect(html).toContain(">Reports<");
    expect(html).not.toContain(">Team<");
  });

  it("shows different terminology for another pack", () => {
    const html = render(VERTICALS.personal_training.terms);
    const t = VERTICALS.personal_training.terms;
    expect(html).toContain(`>${t.customer.other}<`);
    expect(html).toContain(`>${t.offering.other}<`);
    expect(html).not.toContain(">Barbers<");
  });

  it("hides Requests unless the requests module is on", () => {
    const terms = VERTICALS.tattoo.terms;
    expect(render(terms)).not.toContain(">Requests<");
    expect(render(terms, ["aftercare"])).not.toContain(">Requests<");
    const on = render(terms, ["requests"]);
    expect(on).toContain(">Requests<");
    expect(on).toContain('href="/requests"');
  });

  it("hides Projects unless the projects module is on", () => {
    const terms = VERTICALS.tattoo.terms;
    expect(render(terms)).not.toContain(">Projects<");
    expect(render(terms, ["requests"])).not.toContain(">Projects<");
    const on = render(terms, ["projects"]);
    expect(on).toContain(">Projects<");
    expect(on).toContain('href="/projects"');
  });

  it("hides Waitlist unless the slot waitlist module is on", () => {
    const terms = VERTICALS.hair_salon.terms;
    expect(render(terms)).not.toContain(">Waitlist<");
    expect(render(terms, ["walk_in_queue"])).not.toContain(">Waitlist<");
    const on = render(terms, ["slot_waitlist"]);
    expect(on).toContain(">Waitlist<");
    expect(on).toContain('href="/slot-waitlist"');
  });

  it("hides Gift cards unless the gift cards module is on", () => {
    const terms = VERTICALS.hair_salon.terms;
    expect(render(terms)).not.toContain(">Gift cards<");
    expect(render(terms, ["storefront"])).not.toContain(">Gift cards<");
    const on = render(terms, ["gift_cards"]);
    expect(on).toContain(">Gift cards<");
    expect(on).toContain('href="/gift-cards"');
  });

  it("hides Classes unless the classes module is on", () => {
    const terms = VERTICALS.personal_training.terms;
    expect(render(terms)).not.toContain(">Classes<");
    expect(render(terms, ["requests"])).not.toContain(">Classes<");
    const on = render(terms, ["classes"]);
    expect(on).toContain(">Classes<");
    expect(on).toContain('href="/classes"');
  });
});
