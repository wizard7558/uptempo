import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./globals.css", () => ({}));

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "font-bodoni" }),
  Hanken_Grotesk: () => ({ variable: "font-hanken" }),
  Geist_Mono: () => ({ variable: "font-mono" }),
}));

vi.mock("next/script", () => ({
  default: ({
    src,
    id,
    children,
  }: {
    src?: string;
    id?: string;
    children?: React.ReactNode;
  }) =>
    src ? <div data-ga-src={src} /> : <div id={id}>{children}</div>,
}));

vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/analytics/posthog-provider", () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <div id="vercel-analytics" />,
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => <div id="vercel-speed" />,
}));

import RootLayout from "./layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("RootLayout analytics", () => {
  it("omits Google Analytics and Vercel analytics when the env is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    vi.stubEnv("VERCEL", "");
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Hello</p>
      </RootLayout>,
    );
    expect(html).toContain("Hello");
    expect(html).not.toContain("googletagmanager.com");
    expect(html).not.toContain("vercel-analytics");
    expect(html).not.toContain("vercel-speed");
  });

  it("renders Google Analytics only when NEXT_PUBLIC_GA_MEASUREMENT_ID is set", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("VERCEL", "1");
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Hello</p>
      </RootLayout>,
    );
    expect(html).toContain("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    expect(html).toContain("G-TEST123");
    expect(html).toContain("vercel-analytics");
    expect(html).toContain("vercel-speed");
  });
});
