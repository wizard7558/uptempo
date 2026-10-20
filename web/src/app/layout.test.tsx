import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <div id="vercel-analytics" />,
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => <div id="vercel-speed" />,
}));

vi.mock("@/components/native/native-bridge", () => ({
  NativeBridge: () => <div id="native-bridge" />,
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

  it("mounts one native bridge at the root", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Hello</p>
      </RootLayout>,
    );

    expect(html.match(/id="native-bridge"/g)).toHaveLength(1);
  });
});

describe("RootLayout client weight", () => {
  it("leaves the app-wide client providers to each route group", () => {
    // Marketing pages share this layout. Importing the toast, tooltip, or
    // translation providers here ships the admin UI's client code to them.
    const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/Toaster|TooltipProvider|NextIntlClientProvider|PostHogProvider/);
  });
});
