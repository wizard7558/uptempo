import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/requests", () => ({ saveQuoteDraft: vi.fn(), sendQuote: vi.fn() }));

import { QuoteBuilder, type BuilderInitial } from "./quote-builder";

const services = [{ id: "11111111-1111-4111-8111-111111111111", name: "Sleeve", priceCents: 60000, defaultDurationMinutes: 240 }];

function render(initial?: BuilderInitial, projectsOn?: boolean) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.tattoo.terms}>
        <QuoteBuilder requestId="r1" clientName="Casey" services={services} staff={[]} initial={initial} projectsOn={projectsOn} />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

const twoLines: BuilderInitial = {
  staffId: null,
  depositCents: 10000,
  message: "",
  validDays: 14,
  lines: [
    { serviceId: services[0].id, description: "Sleeve session", quantity: 1, unitCents: 60000, minutes: 240 },
    { serviceId: services[0].id, description: "Touch-up", quantity: 2, unitCents: 5000, minutes: 30 },
  ],
};

describe("QuoteBuilder", () => {
  it("shows the total and the time needed for the lines", () => {
    const html = render(twoLines);
    expect(html).toContain("$700.00");
    expect(html).toContain("4 hr 30 min");
  });

  it("formats a single four hour line as 4 hr", () => {
    const html = render({ ...twoLines, lines: [twoLines.lines[0]] });
    expect(html).toContain(">4 hr<");
    expect(html).toContain("$600.00");
  });

  it("has the buttons and the deposit hint", () => {
    const html = render();
    expect(html).toContain("Add a line");
    expect(html).toContain("Save draft");
    expect(html).toContain("Send quote");
    expect(html).toContain("Due when they accept. Leave at $0 for no deposit.");
  });

  it("hides the project switch unless the projects module is on", () => {
    expect(render(twoLines)).not.toContain("Track as a multi-session project");
    const on = render(twoLines, true);
    expect(on).toContain("Track as a multi-session project");
    // Off by default, so no session count yet.
    expect(on).not.toContain('id="project-sessions"');
  });

  it("pre-fills the session count from a saved project quote", () => {
    const html = render({ ...twoLines, projectSessions: 5 }, true);
    expect(html).toContain('id="project-sessions"');
    expect(html).toContain("How many sessions");
    expect(html).toMatch(/<option value="5" selected/);
    expect(html).toContain('<option value="12"');
    expect(html).not.toContain('<option value="13"');
    expect(html).not.toMatch(/<option value="1"[ >]/);
  });
});
