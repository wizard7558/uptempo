import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS, type VerticalTerms } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import { createTermsT } from "@/lib/terms/translator";
import messages from "@/i18n/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/team", () => ({
  acceptInvitation: vi.fn(),
  joinBusinessFromInvitation: vi.fn(),
}));
vi.mock("@/actions/membership", () => ({
  setStoredValueExpiryMonths: vi.fn(),
  createMembershipPlan: vi.fn(),
  listMembershipPlans: vi.fn(),
  updateMembershipPlan: vi.fn(),
}));
vi.mock("@/actions/onboarding", () => ({
  createAdditionalBusinessAsOwner: vi.fn(),
  checkSlugAvailability: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: {} }));
vi.mock("@/actions/revenue", () => ({ getRevenueReport: vi.fn() }));

import { RevenueDashboard } from "@/components/admin/revenue-dashboard";
import { StoredValueExpirySettings } from "@/components/membership/stored-value-expiry-settings";
import { MembershipPlansManager } from "@/components/membership/membership-plans-manager";
import { AcceptInviteForm } from "@/app/(auth)/invite/[token]/accept-form";
import { CreateMyBusinessForm } from "@/app/(admin)/create-my-business/create-my-business-form";

const barber = VERTICALS.barber.terms;
const hairSalon = VERTICALS.hair_salon.terms;

function wrap(terms: VerticalTerms, node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={terms}>{node}</TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("remaining admin copy follows industry terms", () => {
  it("membership screens use the prepaid balance term", () => {
    const html = wrap(
      barber,
      <>
        <StoredValueExpirySettings initialMonths={null} />
        <MembershipPlansManager initialPlans={[]} services={[]} />
      </>,
    );
    expect(html).toContain("Prepaid balance");
    expect(html).not.toContain("Beauty Bank");
  });

  it("membership screens keep Beauty Bank for hair_salon", () => {
    const html = wrap(hairSalon, <MembershipPlansManager initialPlans={[]} services={[]} />);
    expect(html).toContain("Beauty Bank Monthly");
  });

  it("invite accept button says shop for barber and salon for hair_salon", () => {
    const props = {
      token: "t",
      email: "a@b.co",
      salonName: "Fade Co",
      role: "provider",
      canJoinAsSignedInUser: true,
    };
    const barberHtml = wrap(barber, <AcceptInviteForm {...props} />);
    expect(barberHtml).toContain("Join this shop");
    expect(barberHtml).not.toContain("alon");
    expect(wrap(hairSalon, <AcceptInviteForm {...props} />)).toContain(
      "Join this salon",
    );
  });

  it("existing-account error quotes the same button label", () => {
    const err = createTermsT(barber, "errors")("team.existingAccount");
    const button = createTermsT(barber, "auth")("acceptForm.joinButton");
    expect(err).toContain(`“${button}”`);
  });

  it("create-business form asks the industry, then uses the barber place word", () => {
    const html = wrap(barber, <CreateMyBusinessForm />);
    expect(html).toContain("What kind of business is this?");
    expect(createTermsT(barber, "business")("createForm.title")).toBe(
      "Start your own shop",
    );
    expect(createTermsT(barber, "business")("createForm.nameLabel")).toBe("Shop name");
  });

  it("revenue dashboard uses terms and shows retail sales", () => {
    const html = wrap(
      barber,
      <RevenueDashboard
        initialData={{
          staff: [
            {
              staffId: "s1",
              staffName: "Sam",
              totalCents: 5000,
              tipsCents: 0,
              serviceCents: 5000,
              platformFeeCents: 0,
              netCents: 5000,
              chargeCount: 2,
            },
          ],
          retail: { salesCents: 1200, orderCount: 2 },
        }}
      />,
    );
    expect(html).toContain("Retail sales");
    expect(html).toContain("$12.00");
    expect(html).toContain("2 orders");
    expect(html).toContain("Paid appointments");
    expect(html).not.toContain("tylist");
  });

  it("reports and nav copy use the staff and place terms", () => {
    const reports = createTermsT(barber, "reports");
    expect(reports("revenuePage.subtitle")).toBe(
      "Per-barber earnings from completed appointments.",
    );
    expect(reports("analyticsCharts.utilizationTitle")).toBe("Barber Utilization");
    expect(createTermsT(barber, "nav")("adminSidebar.startNewPlace")).toBe(
      "Start a new shop",
    );
  });

  it("storefront errors use the place term", () => {
    expect(createTermsT(barber, "errors")("storefront.pickupOnly")).toBe(
      "This shop offers pickup only",
    );
  });

  it("coaching message uses the place term", () => {
    expect(createTermsT(barber, "dashboard")("businessScore.steadyMomentum")).toBe(
      "Keep building steady momentum across the shop.",
    );
  });
});
