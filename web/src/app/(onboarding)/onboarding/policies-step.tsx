"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PolicyForm } from "@/components/settings/policy-form";
import { markOnboardingStepComplete } from "@/actions/onboarding";

/** Shape PolicyForm needs — mirrors the policies settings page. */
export interface PolicyInitial {
  cancellationWindowHours: number;
  cancellationFeePercent: number;
  noShowFeePercent: number;
  requireCardOnFile: number;
  policyText: string | null;
  onlineBookingAudience: "both" | "existing_only" | "new_only";
  depositEnabled: number;
  depositDefaultType: "percent" | "fixed";
  depositDefaultAmount: number;
  depositDurationThresholdMinutes: number | null;
}

interface PoliciesStepProps {
  initialPolicy: PolicyInitial;
  stripeConnected: boolean;
  /** Flag step 3 done in the wizard's local checklist. */
  onMarkComplete: () => void;
  /** Advance to the next step. */
  onContinue: () => void;
  onBack: () => void;
}

export function PoliciesStep({
  initialPolicy,
  stripeConnected,
  onMarkComplete,
  onContinue,
  onBack,
}: PoliciesStepProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const cardRequired = initialPolicy.requireCardOnFile === 1;

  function markPolicies(thenAdvance: boolean) {
    startTransition(async () => {
      const result = await markOnboardingStepComplete("policies");
      if (!result.success) {
        toast.error(result.error ?? "Couldn't save. Please try again.");
        return;
      }
      onMarkComplete();
      router.refresh();
      if (thenAdvance) onContinue();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set your booking policies</CardTitle>
        <CardDescription>
          These protect your time and set client expectations. You can fine-tune
          them anytime in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Plain-language summary of the current policy values */}
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            Clients can cancel free up to{" "}
            <span className="font-semibold">
              {initialPolicy.cancellationWindowHours} hours
            </span>{" "}
            before.
          </p>
          <p>
            Late cancellations are charged{" "}
            <span className="font-semibold">
              {initialPolicy.cancellationFeePercent}%
            </span>
            , no-shows{" "}
            <span className="font-semibold">
              {initialPolicy.noShowFeePercent}%
            </span>
            .
          </p>
          <p>
            A card on file{" "}
            <span className="font-semibold">
              {cardRequired ? "is" : "isn't"} required
            </span>{" "}
            to book.
            {cardRequired && !stripeConnected && (
              <span className="ml-1 text-xs text-amber-600">
                (requires Stripe — next step)
              </span>
            )}
          </p>
        </div>

        <PolicyForm
          initialPolicy={initialPolicy}
          onSaved={() => markPolicies(false)}
        />

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="ghost" onClick={onBack} disabled={isPending}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={() => markPolicies(true)} disabled={isPending}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            These look good — continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
