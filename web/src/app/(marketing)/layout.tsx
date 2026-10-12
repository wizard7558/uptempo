import type { Metadata } from "next";
import { MarketingHeader } from "./components/marketing-header";
import { MarketingFooter } from "./components/marketing-footer";

export const metadata: Metadata = {
  title: "Uptempo Bookings — The All-in-One Platform to Run Your Salon",
  description:
    "Online booking, smart scheduling with per-client durations, client records, checkout and payments, memberships, and revenue tracking — built for salons that care about getting every detail right.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="light flex min-h-screen flex-col bg-background text-foreground"
      data-theme-scope="marketing"
    >
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
