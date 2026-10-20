"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import type { OnboardingState } from "@/lib/onboarding/state";

interface OnboardingChecklistProps {
  steps: OnboardingState;
}

const FINISH_ITEMS: ReadonlyArray<{
  key: keyof OnboardingState;
  label: string;
  href: string;
}> = [
  { key: "stripe", label: "Connect Stripe", href: "/settings/billing" },
  { key: "branding", label: "Brand your booking page", href: "/settings/branding" },
];

/**
 * Post-launch "Finish setup" card. Shown only to owners who launched WITHOUT
 * connecting Stripe (they explicitly skipped it during onboarding) and still
 * have an optional item outstanding. Once every item is done it renders
 * nothing. Businesses that launched the normal way keep `stripeSkipped === false`
 * and never see this card.
 */
export function OnboardingChecklist({ steps }: OnboardingChecklistProps) {
  // Only relevant after launch, and only for businesses that skipped Stripe.
  if (!steps.launched || !steps.stripeSkipped) return null;

  const outstanding = FINISH_ITEMS.filter((item) => !steps[item.key]);
  if (outstanding.length === 0) return null;

  const completedCount = FINISH_ITEMS.length - outstanding.length;
  const totalSteps = FINISH_ITEMS.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  return (
    <Card className="mx-2 mb-2">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs font-medium flex items-center justify-between">
          <span>Finish setup</span>
          <span className="text-muted-foreground font-normal">
            {completedCount} of {totalSteps}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 space-y-2">
        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-1">
          {FINISH_ITEMS.map((item) => {
            const isComplete = steps[item.key];
            return (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-2 text-xs py-0.5 hover:text-primary transition-colors"
              >
                {isComplete ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
                <span className={isComplete ? "text-muted-foreground line-through" : ""}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
