import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { VERTICALS, type VerticalTerms } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import { mergeTermValues } from "@/lib/terms/args";
import messages from "@/i18n/messages/en.json";

let currentTerms: VerticalTerms = VERTICALS.hair_salon.terms;

vi.mock("@/lib/terms/server", () => ({
  getT: async (namespace: string) => {
    const t = createTranslator({
      locale: "en",
      messages,
      namespace: namespace as "settings",
    }) as (
      key: string,
      values?: Record<string, unknown>,
    ) => string;
    return (key: string, values?: Record<string, unknown>) =>
      t(key, mergeTermValues(currentTerms, values));
  },
}));
const enabledModules = vi.hoisted(() => ({
  value: ["assistant_tasks", "aftercare", "storefront"] as string[],
}));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => "t" }));
vi.mock("@/lib/tenant/modules", () => ({
  getEnabledModules: async () => enabledModules.value,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/staff", () => ({
  deactivateStaffMember: vi.fn(),
  createStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
}));

import SettingsPage from "./page";
import { StaffPageClient } from "./staff/client";

describe("settings copy follows industry terms", () => {
  it("settings index shows barber words and keeps Stylists for hair_salon", async () => {
    currentTerms = VERTICALS.hair_salon.terms;
    const hairHtml = renderToStaticMarkup(await SettingsPage());
    expect(hairHtml).toContain(">Stylists<");
    expect(hairHtml).toContain("Beauty Bank / Memberships");
    expect(hairHtml).toContain("Manage your salon configuration.");

    currentTerms = VERTICALS.barber.terms;
    const barber = renderToStaticMarkup(await SettingsPage());
    const t = VERTICALS.barber.terms;
    expect(barber).toContain(`>${t.staff.other}<`);
    expect(barber).toContain(`${t.prepaidBalance} / Memberships`);
    expect(barber).toContain("Manage your shop configuration.");
    expect(barber).not.toContain("Stylist");
    expect(barber).not.toContain("Beauty Bank");
  });

  it("settings index hides cards for modules that are off", async () => {
    currentTerms = VERTICALS.hair_salon.terms;
    enabledModules.value = [];
    try {
      const html = renderToStaticMarkup(await SettingsPage());
      expect(html).not.toContain("Aftercare");
      expect(html).not.toContain("Assistants");
      expect(html).not.toContain("Storefront");
      expect(html).toContain("Features");
      expect(html).toContain("Custom fields");
      expect(html).toContain("Extra details to keep for clients and appointments.");
    } finally {
      enabledModules.value = ["assistant_tasks", "aftercare", "storefront"];
    }
  });

  it("staff page client uses barber terms", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TermsProvider terms={VERTICALS.barber.terms}>
          <StaffPageClient initialStaff={[]} assistants={[]} />
        </TermsProvider>
      </NextIntlClientProvider>,
    );
    const t = VERTICALS.barber.terms;
    expect(html).toContain(`Add ${t.staff.one}`);
    expect(html).toContain(`No ${t.staff.other.toLowerCase()} yet.`);
    expect(html).not.toContain("tylist");
  });
});
