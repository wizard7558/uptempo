import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS, type VerticalTerms } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/team", () => ({ switchActiveTenant: vi.fn() }));

import { OnboardingSalonSwitcher } from "./salon-switcher";

function render(terms: VerticalTerms) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={terms}>
        <OnboardingSalonSwitcher
          activeTenantSlug="a"
          memberships={[
            { tenantSlug: "a", role: "owner", salonName: "A" },
            { tenantSlug: "b", role: "owner", salonName: "B" },
          ]}
        />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("onboarding copy follows industry terms", () => {
  it("switcher says shop for the barber pack", () => {
    const html = render(VERTICALS.barber.terms);
    expect(html).toContain("Switch shop");
    expect(html).not.toContain("alon");
  });

  it("keeps salon for hair_salon", () => {
    expect(render(VERTICALS.hair_salon.terms)).toContain("Switch salon");
  });
});
