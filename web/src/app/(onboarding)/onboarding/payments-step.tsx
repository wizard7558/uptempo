"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { getConnectStatus, setupConnectAccount } from "@/actions/connect";
import { skipStripeForNow } from "@/actions/onboarding";
import { SelfHostedPaymentsCard } from "@/components/settings/self-hosted-payments-card";
import { useT } from "@/lib/terms/client";

export type ConnectStatusInfo =
  | { connected: false }
  | {
      connected: true;
      accountId: string;
      detailsSubmitted: boolean;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
    };

interface PaymentsStepProps {
  /** Server-fetched Connect status at page load. */
  initialStatus: ConnectStatusInfo;
  /** True when Stripe's hosted flow just returned (?stripe_setup=complete). */
  stripeSetupComplete: boolean;
  /** Flag step 4 done in the wizard's local checklist. */
  onMarkComplete: () => void;
  /** Advance to the next step. */
  onContinue: () => void;
  onBack: () => void;
  /** Set on a single-business install. Replaces Connect with the owner's Stripe key. */
  selfHosted?: { configured: boolean; webhookUrl: string } | null;
}

export function PaymentsStep({
  initialStatus,
  stripeSetupComplete,
  onMarkComplete,
  onContinue,
  onBack,
  selfHosted = null,
}: PaymentsStepProps) {
  const t = useT("onboarding");
  const [status, setStatus] = useState<ConnectStatusInfo>(initialStatus);
  // If Stripe just redirected back, re-check status before showing anything.
  const [checking, setChecking] = useState(stripeSetupComplete);
  const [connecting, setConnecting] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [cardDisabledNote, setCardDisabledNote] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!stripeSetupComplete) return;
    let active = true;
    (async () => {
      try {
        const fresh = await getConnectStatus();
        if (active) setStatus(fresh);
      } catch {
        // Leave the server-provided status in place.
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [stripeSetupComplete]);

  function handleConnect() {
    setConnecting(true);
    startTransition(async () => {
      const result = await setupConnectAccount({ returnPath: "/onboarding" });
      if (result.success) {
        // Redirect to Stripe's hosted onboarding; it returns to
        // /onboarding?stripe_setup=complete.
        window.location.href = result.url;
      } else {
        toast.error(result.error);
        setConnecting(false);
      }
    });
  }

  function handleSkip() {
    startTransition(async () => {
      const result = await skipStripeForNow();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      onMarkComplete();
      if (result.cardRequirementDisabled) {
        // Surface why "require card on file" was turned off, then let them
        // acknowledge before moving on.
        setConfirmSkip(false);
        setCardDisabledNote(true);
      } else {
        onContinue();
      }
    });
  }

  if (selfHosted) {
    return (
      <div className="space-y-6">
        <SelfHostedPaymentsCard
          configured={selfHosted.configured}
          webhookUrl={selfHosted.webhookUrl}
        />
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            onClick={() => {
              onMarkComplete();
              onContinue();
            }}
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Confirming a fresh return from Stripe.
  if (checking) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirming your Stripe connection…</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking your account status.
        </CardContent>
      </Card>
    );
  }

  // Skipped, and we disabled the card-on-file requirement — explain, then let
  // them continue.
  if (cardDisabledNote) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payments skipped for now</CardTitle>
          <CardDescription>You can connect Stripe anytime later.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Since you&apos;re not taking card payments yet, we turned off
            &ldquo;require card on file&rdquo; so clients can complete bookings.
            Turn it back on in Settings → Policies after you connect Stripe.
          </div>
          <div className="flex justify-end">
            <Button onClick={onContinue}>
              {t("payments.gotIt")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connected — show the same status rows as Settings → Billing.
  if (status.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stripe connected</CardTitle>
          <CardDescription>
            You&apos;re set up to take card payments, deposits, and no-show fees.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 rounded-lg border p-4">
            <StatusRow label="Details submitted" ok={status.detailsSubmitted} />
            <StatusRow label="Charges enabled" ok={status.chargesEnabled} />
            <StatusRow label="Payouts enabled" ok={status.payoutsEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={() => {
                onMarkComplete();
                onContinue();
              }}
            >
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not connected — offer to connect, or skip with a confirmation.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Take payments with Stripe</CardTitle>
        <CardDescription>
          Connect Stripe to take card payments, deposits, and no-show fees.
          Payouts go straight to your bank.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Button
          className="w-full sm:w-auto"
          onClick={handleConnect}
          disabled={connecting || isPending}
        >
          {connecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" />
          )}
          Connect Stripe
        </Button>

        {confirmSkip ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              Without Stripe you can&apos;t take card payments, collect deposits,
              or require a card on file. Clients can still book — you just
              can&apos;t charge cards until you connect. You can do this anytime
              in Settings → Payments.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                
                onClick={handleSkip}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("payments.laterConfirm")}
              </Button>
              <Button
                variant="ghost"
                
                onClick={() => setConfirmSkip(false)}
                disabled={isPending}
              >
                Never mind
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmSkip(true)}>
              {t("payments.later")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-5 text-green-600" />
      ) : (
        <AlertCircle className="size-5 text-amber-500" />
      )}
      <span className="text-sm">{label}</span>
    </div>
  );
}
