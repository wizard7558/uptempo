"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

const TIERS = [
  {
    name: "Starter",
    description: "For solo stylists getting started.",
    feePercent: 0.5,
    maxStaff: "1 stylist",
    features: [
      "Online booking page",
      "Google Calendar sync",
      "Client profiles & history",
      "Per-client duration overrides",
      "Email notifications",
      "Card & cash payments",
    ],
    highlighted: false,
  },
  {
    name: "Professional",
    description: "For growing salons with a team.",
    feePercent: 1,
    maxStaff: "Up to 5 stylists",
    features: [
      "Everything in Starter, plus:",
      "Team management & invitations",
      "Role-based permissions",
      "Forms, waivers & aftercare",
      "Client self-checkout",
      "Revenue dashboard",
    ],
    highlighted: true,
  },
  {
    name: "Studio",
    description: "For established studios that need it all.",
    feePercent: 2,
    maxStaff: "Unlimited stylists",
    features: [
      "Everything in Professional, plus:",
      "Priority support",
      "Custom booking page branding",
      "Advanced analytics",
      "API access",
    ],
    highlighted: false,
  },
];

const REVENUE_MIN = 2000;
const REVENUE_MAX = 50000;
const REVENUE_STEP = 1000;

function formatCurrency(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

export function PricingSlider() {
  const [monthlyRevenue, setMonthlyRevenue] = useState(15000);

  return (
    <>
      {/* Revenue slider */}
      <div className="mx-auto mb-12 max-w-md space-y-4">
        <label className="block text-center text-xs font-medium uppercase tracking-[0.3em] text-[var(--ink-soft)]">
          Your monthly salon revenue
        </label>
        <div className="text-center font-display text-3xl font-light tracking-tight text-[var(--ink)]">
          ${monthlyRevenue.toLocaleString()}
          {monthlyRevenue >= REVENUE_MAX && "+"}
          <span className="font-sans text-base font-normal text-[var(--ink-soft)]">
            /month
          </span>
        </div>
        <Slider
          value={[monthlyRevenue]}
          onValueChange={([v]) => setMonthlyRevenue(v)}
          min={REVENUE_MIN}
          max={REVENUE_MAX}
          step={REVENUE_STEP}
          className="py-4 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:rounded-full [&_[data-slot=slider-track]]:bg-[var(--ink-faint)] [&_[data-slot=slider-track]]:ring-1 [&_[data-slot=slider-track]]:ring-[var(--ink-soft)] [&_[data-slot=slider-range]]:bg-[var(--ink)] [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-[var(--ink)] [&_[data-slot=slider-thumb]]:bg-[var(--ivory-raised)] [&_[data-slot=slider-thumb]]:shadow-md [&_[data-slot=slider-thumb]]:ring-2 [&_[data-slot=slider-thumb]]:ring-[var(--ivory)]"
        />
        <div className="flex justify-between text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">
          <span>${REVENUE_MIN.toLocaleString()}</span>
          <span>${REVENUE_MAX.toLocaleString()}+</span>
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => {
          const monthlyCostCents = Math.round(
            monthlyRevenue * (tier.feePercent / 100) * 100,
          );

          return (
            <Card
              variant="default"
              key={tier.name}
              className={cn(
                "editorial-card-hover flex flex-col transition-colors",
                tier.highlighted &&
                  "border-[var(--ink)]",
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-display text-2xl font-light tracking-tight text-[var(--ink)]">
                    {tier.name}
                  </CardTitle>
                  {tier.highlighted && (
                    <Badge
                      variant="default"
                      className="shrink-0 border-[var(--ink)] text-[var(--ink)]"
                    >
                      Most popular
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-pretty text-[var(--ink-soft)]">
                  {tier.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-6">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-light tracking-tight text-[var(--ink)]">
                      {tier.feePercent}%
                    </span>
                    <span className="text-sm text-[var(--ink-soft)]">
                      of revenue
                    </span>
                  </div>
                  <p className="text-sm text-[var(--ink-soft)]">
                    ≈ {formatCurrency(monthlyCostCents)}/month at $
                    {monthlyRevenue.toLocaleString()} revenue
                  </p>
                </div>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
                    <span className="font-medium text-[var(--ink)]">{tier.maxStaff}</span>
                  </li>
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm"
                    >
                      {feature.endsWith(":") ? (
                        <span className="pt-1 font-medium text-[var(--ink-soft)]">
                          {feature}
                        </span>
                      ) : (
                        <>
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
                          <span>{feature}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  asChild
                  className="w-full"
                  variant={tier.highlighted ? "default" : "outline"}
                >
                  <Link href="/signup">Start free trial</Link>
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </>
  );
}
