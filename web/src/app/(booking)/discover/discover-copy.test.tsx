import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const listMarketplaceSalons = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant/registry", () => ({ listMarketplaceSalons }));

import DiscoverPage, { metadata } from "./page";

async function render(q?: string) {
  const ui = await DiscoverPage({ searchParams: Promise.resolve({ q }) });
  return renderToStaticMarkup(ui);
}

describe("/discover marketplace copy is industry neutral", () => {
  it("empty state and heading never say salon", async () => {
    listMarketplaceSalons.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Find a local business to book");
    expect(html).toContain("tattoo studios");
    expect(html).toContain("No businesses are listed yet");
    expect(html).toContain("Search businesses by name");
    // "nail salons" is a deliberate industry example; nothing else may say salon.
    expect(html.replace(/nail salons/g, "")).not.toMatch(/salon/i);
  });

  it("no-results message says business", async () => {
    listMarketplaceSalons.mockResolvedValue([]);
    expect(await render("fade")).toContain("No businesses found for “fade”.");
  });

  it("lists businesses and keeps the booking link", async () => {
    listMarketplaceSalons.mockResolvedValue([{ slug: "fade-co", name: "Fade Co" }]);
    const html = await render();
    expect(html).toContain("Fade Co");
    expect(html).toContain('href="/book/fade-co"');
  });

  it("metadata is neutral", () => {
    expect(String(metadata.title)).not.toMatch(/salon/i);
    expect(String(metadata.description)).toContain("home-service pros");
  });
});
