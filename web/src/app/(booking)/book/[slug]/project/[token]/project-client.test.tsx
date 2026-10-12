import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

vi.mock("@/actions/projects", () => ({ approveDesign: vi.fn() }));

import { ProjectClient } from "./project-client";
import type { ProjectForClient } from "@/actions/projects";

const base: ProjectForClient = { title: "Sleeve", businessName: "Ink Co", designUrl: "https://files.test/d.png", approved: false, balance: 20000 };

function render(data: ProjectForClient) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.tattoo.terms}>
        <ProjectClient slug="ink" token={"t".repeat(32)} data={data} />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("ProjectClient", () => {
  it("shows the design with the name box and Approve button", () => {
    const html = render(base);
    expect(html).toContain("<h1");
    expect(html).toContain("Your design");
    expect(html).toContain('src="https://files.test/d.png"');
    expect(html).toContain("Type your full name to approve");
    expect(html).toContain("Approve design");
  });

  it("shows the thank-you instead of the form once approved", () => {
    const html = render({ ...base, approved: true });
    expect(html).toContain("Design approved. Thank you!");
    expect(html).not.toContain("Approve design");
  });

  it("explains when there is no design yet, with no approve form", () => {
    const html = render({ ...base, designUrl: null });
    expect(html).toContain("No design has been shared yet");
    expect(html).not.toContain("Approve design");
  });
});
