import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Uptempo Bookings",
  description:
    "Simple, transparent pricing for the all-in-one platform to run your salon. Start free, upgrade when you're ready.",
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
