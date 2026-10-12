import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";
import { computeServiceAnalytics } from "@/lib/analytics/service-metrics";
import {
  FIXTURE_HISTORY,
  FIXTURE_LINES,
} from "@/lib/analytics/service-metrics-fixture";
import { ServiceAnalyticsSection } from "./service-analytics-section";

function render(data: Parameters<typeof ServiceAnalyticsSection>[0]["data"]) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.tattoo.terms}>
        <ServiceAnalyticsSection data={data} />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("ServiceAnalyticsSection", () => {
  it("renders both tables with tattoo terms", () => {
    const html = render(computeServiceAnalytics(FIXTURE_LINES, FIXTURE_HISTORY));
    expect(html).toContain("By piece");
    expect(html).toContain("By artist");
    expect(html).toContain("$110.00");
    expect(html).toContain("50.0%");
    expect(html).toContain("Blake");
    expect(html).toContain("What these numbers mean");
    expect(html).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it("shows the empty message and dashes when there is no data", () => {
    const html = render(computeServiceAnalytics([], []));
    expect(html).toContain("—");
    expect(html).toContain("in these dates yet.");
  });
});
