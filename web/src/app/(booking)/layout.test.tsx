import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const getBrandingForBookingMock = vi.fn();
const getTenantSlugOrNullMock = vi.fn();
const getBookingSessionMock = vi.fn();
const isTenantProvisionedMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

vi.mock("@/lib/tenant/registry", () => ({
  isTenantProvisioned: isTenantProvisionedMock,
}));

vi.mock("@/lib/booking/cached-lookups", () => ({
  getBookingBrandingCached: getBrandingForBookingMock,
}));

vi.mock("@/lib/tenant/context", () => ({
  getTenantSlugOrNull: getTenantSlugOrNullMock,
}));

vi.mock("@/lib/terms/server", async () => {
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getTerms: async () => VERTICALS.general.terms,
    getT: async () => (key: string) => key,
  };
});

vi.mock("@/lib/booking/session-cookie", () => ({
  getBookingSession: getBookingSessionMock,
}));

vi.mock("@/components/booking-public/powered-by-badge", () => ({
  PoweredByBadge: ({ show }: { show: boolean }) =>
    show ? <div data-testid="powered-by">Powered by</div> : null,
}));

// Uses next/navigation hooks that need a mounted app router; native-only.
vi.mock("@/components/booking-public/native-tab-bar", () => ({
  NativeTabBar: () => null,
}));

describe("BookingGroupLayout", () => {
  beforeEach(() => {
    vi.resetModules();
    getBrandingForBookingMock.mockReset();
    getTenantSlugOrNullMock.mockReset();
    getBookingSessionMock.mockReset();
    isTenantProvisionedMock.mockReset();
    isTenantProvisionedMock.mockResolvedValue(true);
    notFoundMock.mockClear();
  });

  it("404s for an unknown tenant before any branding query", async () => {
    getTenantSlugOrNullMock.mockResolvedValue("does-not-exist");
    isTenantProvisionedMock.mockResolvedValue(false);

    const { default: BookingGroupLayout } = await import("./layout");
    await expect(
      BookingGroupLayout({ children: <main>x</main> }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(getBrandingForBookingMock).not.toHaveBeenCalled();
  });

  it("renders without tenant overrides when slug is missing", async () => {
    getTenantSlugOrNullMock.mockResolvedValue(null);
    getBookingSessionMock.mockResolvedValue(null);

    const { default: BookingGroupLayout } = await import("./layout");
    const html = renderToStaticMarkup(
      await BookingGroupLayout({
        children: <main>Booking content</main>,
      }),
    );

    expect(html).toContain("Booking content");
    expect(html).not.toContain("--primary");
    expect(html).not.toContain("--accent");
  });

  it("applies tenant branding css variables when branding exists", async () => {
    getTenantSlugOrNullMock.mockResolvedValue("test-salon");
    getBookingSessionMock.mockResolvedValue("client-123");
    getBrandingForBookingMock.mockResolvedValue({
      brandColor: "#FFFF00",
      fontPairing: "sans",
      cornerStyle: "square",
      density: "compact",
      colorMode: "light",
      primaryColor: "#6b4f3f",
      logoUrl: null,
      showPoweredBy: 1,
    });

    const { default: BookingGroupLayout } = await import("./layout");
    const html = renderToStaticMarkup(
      await BookingGroupLayout({
        children: <main>Booking content</main>,
      }),
    );

    expect(html).toContain("#7A7A00");
    expect(html).toContain("--radius:0");
    expect(html).toContain('data-density="compact"');
    expect(html).toContain("var(--font-hanken-grotesk)");
    expect(html).toContain('class="light min-h-screen bg-background text-foreground"');
    expect(html).not.toContain("#6b4f3f");
    expect(html).not.toContain("#FFFF00");
    expect(html).toContain("My Account");
    expect(html).toContain("Powered by");
  });
});
