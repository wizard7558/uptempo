import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { render } from "@react-email/render";
import { VERTICALS, type VerticalId } from "@/lib/verticals";

declare global {
  interface ImportMeta {
    glob(
      pattern: string | readonly string[],
      options: { eager: true },
    ): Record<string, Record<string, unknown>>;
  }
}

const getTenantTerms = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant/industry", () => ({ getTenantTerms }));

import { getEmailT } from "@/lib/terms/email";

const modules = import.meta.glob(["./*.tsx", "!./*.test.tsx"], { eager: true });

const PACKS = ["hair_salon", "tattoo", "home_services"] as const satisfies readonly VerticalId[];

const barber = VERTICALS.barber.terms;
const hairSalon = VERTICALS.hair_salon.terms;

function templateFns(mod: object) {
  return Object.entries(mod).filter(
    (entry): entry is [string, ComponentType<Record<string, unknown>>] => typeof entry[1] === "function",
  );
}

function fixture(t: Awaited<ReturnType<typeof getEmailT>>): Record<string, unknown> {
  return {
    t,
    businessName: "North Co",
    clientName: "Ana",
    staffName: "Sam",
    inviterName: "Rae",
    roleLabel: "Admin",
    services: ["Fade"],
    date: "Friday, May 1, 2026",
    time: "2:00 PM",
    duration: "30 minutes",
    businessAddress: "1 Main St",
    cancelUrl: "https://example.com/cancel",
    rescheduleUrl: "https://example.com/reschedule",
    checkoutUrl: "https://example.com/pay",
    logoUrl: "https://example.com/logo.png",
    brandColor: "#B3122E",
    formName: "Intake",
    formDescription: "A few questions",
    formUrl: "https://example.com/form",
    intakeUrl: "https://example.com/intake",
    settingsUrl: "https://example.com/settings",
    platformLabel: "Google Calendar",
    lineItems: [{ label: "Cut", amountCents: 4000 }],
    tipCents: 500,
    totalCents: 4500,
    paidAtLabel: "May 1, 2026",
    heading: "Update",
    body: "Details are ready.",
    cta: "Open",
    url: "https://example.com/open",
    link: "https://example.com/open",
    acceptUrl: "https://example.com/accept",
    templates: [{ name: "Care", content: "Keep it dry.", productRecommendations: "Balm" }],
    answers: [{ question: "Name", answer: "Ana" }],
    name: "Ana",
    email: "ana@example.com",
    phone: "555-0100",
    source: "qr",
    submittedAt: "May 1, 2026",
    code: "ABCD2345",
    message: "Enjoy",
    balanceUrl: "https://example.com/balance",
    purchaser: "Rae",
    amount: "$50.00",
    lines: [{ description: "Small piece", quantity: 1, amountLabel: "$150.00" }],
    totalLabel: "$150.00",
    depositLabel: "$50.00",
    validUntilLabel: "May 8, 2026",
  };
}

describe("email copy follows the industry pack", () => {
  const found = Object.entries(modules).flatMap(([file, mod]) =>
    templateFns(mod as object).map(([exportName, Component]) => ({ file, exportName, Component })),
  );

  it("finds every template file", () => {
    expect(found.map((item) => item.file).sort()).toEqual(
      Object.keys(modules).sort(),
    );
  });

  for (const { file, exportName, Component } of found) {
    for (const pack of PACKS) {
      it(`${file} ${exportName} renders ${pack} words`, async () => {
        getTenantTerms.mockResolvedValue(VERTICALS[pack].terms);
        const t = await getEmailT("preview", "emails");
        const html = await render(createElement(Component, fixture(t)));
        const staff = VERTICALS[pack].terms.staff.one.toLowerCase();
        expect(html.toLowerCase()).toContain(staff);
        expect(html).toContain("Bodoni Moda");
        expect(html).toContain("Hanken Grotesk");
        expect(html).toContain("https://example.com/logo.png");
        if (pack !== "hair_salon") {
          expect(html).not.toMatch(/\bstylists?\b/i);
          expect(html).not.toMatch(/\bsalons?\b/i);
        }
      });
    }
  }
});

describe("getEmailT", () => {
  it("merges the tenant's terms into email copy", async () => {
    getTenantTerms.mockResolvedValue(barber);
    const t = await getEmailT("fade-co", "emails");
    expect(getTenantTerms).toHaveBeenCalledWith("fade-co");
    expect(t("fallbacks.yourPlace")).toBe("Your shop");
    expect(t("fallbacks.ourPlaceTitle")).toBe("Our Shop");
    expect(t("fallbacks.yourStaff")).toBe("Your barber");
    expect(t("intake.sms", { placeName: "Fade Co", url: "https://x" })).toBe(
      "Fade Co: please review and sign our shop policies and add a card on file — https://x",
    );
  });

  it("keeps the old hair_salon wording", async () => {
    getTenantTerms.mockResolvedValue(hairSalon);
    const t = await getEmailT("emme", "emails");
    expect(t("fallbacks.ourPlaceTitle")).toBe("Our Salon");
    expect(t("fallbacks.thePlace")).toBe("the salon");
    expect(t("receipt.prepaidApplied")).toBe("Beauty Bank applied");
    expect(t("charges.noShowPolicy")).toBe(
      "This charge was applied per our salon's no-show policy.",
    );
  });
});
