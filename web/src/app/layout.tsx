import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import { Bodoni_Moda, Geist_Mono, Hanken_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NativeBridge } from "@/components/native/native-bridge";
import "./globals.css";

const bodoniModa = Bodoni_Moda({
  variable: "--font-bodoni-moda",
  subsets: ["latin"],
  style: ["normal"],
  weight: "variable",
});

// Italic is used on one page below the fold. Declared apart from the upright
// face so its preload does not compete with the fonts the first paint needs.
const bodoniModaItalic = Bodoni_Moda({
  variable: "--font-bodoni-moda-italic",
  subsets: ["latin"],
  style: ["italic"],
  weight: "variable",
  preload: false,
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin"],
  weight: "variable",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Only code samples use it; a preload would compete with the text fonts.
  preload: false,
});

export const metadata: Metadata = {
  title: "Uptempo Bookings",
  description:
    "Booking software for businesses that run on appointments: a booking page, a team calendar, reminders, and card payments.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Uptempo",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0E0E" },
  ],
  width: "device-width",
  initialScale: 1,
  // Allow content to extend into the iOS safe areas (notch / home indicator)
  // so the Capacitor WebView can render edge-to-edge.
  viewportFit: "cover",
};

// Providers (messages, tooltips, toasts, analytics) live in each route group's
// layout through <AppProviders>, so a public marketing page does not ship the
// admin UI's client code or every translation namespace.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {gaMeasurementId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}');
              `}
            </Script>
          </>
        ) : null}
      </head>
      <body
        className={`${bodoniModa.variable} ${bodoniModaItalic.variable} ${hankenGrotesk.variable} ${geistMono.variable} antialiased`}
      >
        <Suspense fallback={null}>
          <NativeBridge />
        </Suspense>
        {children}
        {process.env.VERCEL === "1" ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
