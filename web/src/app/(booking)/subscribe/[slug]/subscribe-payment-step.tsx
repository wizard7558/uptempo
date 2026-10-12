"use client";

import { useT } from "@/lib/terms/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import { Button } from "@/components/ui/button";
import {
  Loader2Icon,
  CreditCardIcon,
  ShieldCheckIcon,
  ArrowLeftIcon,
} from "lucide-react";
import { startStoredValueSubscriptionPublic } from "@/actions/membership";

const SUBSCRIBE_CLIENT_PARAM = "subscribe_client";
const SUBSCRIBE_PLAN_PARAM = "subscribe_plan";
const SUBSCRIBE_AMOUNT_PARAM = "subscribe_amount";
const SETUP_INTENT_CLIENT_SECRET_PARAM = "setup_intent_client_secret";

function SubscribeSetupForm({
  clientId,
  planId,
  customAmountCents,
  onSuccess,
}: {
  clientId: string;
  planId: string;
  customAmountCents: number | null;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledRedirectRef = useRef(false);

  const clearSubscribeQueryParams = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(SUBSCRIBE_CLIENT_PARAM);
    url.searchParams.delete(SUBSCRIBE_PLAN_PARAM);
    url.searchParams.delete(SUBSCRIBE_AMOUNT_PARAM);
    url.searchParams.delete("setup_intent");
    url.searchParams.delete(SETUP_INTENT_CLIENT_SECRET_PARAM);
    url.searchParams.delete("redirect_status");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const finalizeSubscription = useCallback(
    async (paymentMethodId: string, amountCents: number | null) => {
      const sub = await startStoredValueSubscriptionPublic({
        clientId,
        planId,
        customAmountCents: amountCents ?? undefined,
        stripePaymentMethodId: paymentMethodId,
      });
      clearSubscribeQueryParams();
      if (!sub.success) {
        setError("error" in sub ? sub.error : "Subscription failed");
        setLoading(false);
        return;
      }

      onSuccess();
    },
    [clearSubscribeQueryParams, clientId, onSuccess, planId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Please check your card details");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/stripe/setup-intent", { method: "POST" });
    if (!res.ok) {
      setError("Unable to save card. Please try again.");
      setLoading(false);
      return;
    }
    const { clientSecret } = await res.json();

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      clientSecret,
      confirmParams: {
        return_url: (() => {
          const url = new URL(window.location.href);
          url.searchParams.set(SUBSCRIBE_CLIENT_PARAM, clientId);
          url.searchParams.set(SUBSCRIBE_PLAN_PARAM, planId);
          if (customAmountCents != null) {
            url.searchParams.set(
              SUBSCRIBE_AMOUNT_PARAM,
              String(customAmountCents),
            );
          }
          return url.toString();
        })(),
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(
        confirmError.message ?? "Card setup failed. Please try again.",
      );
      setLoading(false);
      return;
    }

    const pmRaw = setupIntent?.payment_method;
    const paymentMethodId =
      typeof pmRaw === "string" ? pmRaw : pmRaw?.id ?? null;
    if (!paymentMethodId) {
      setError("Could not confirm payment method. Please try again.");
      setLoading(false);
      return;
    }

    await finalizeSubscription(paymentMethodId, customAmountCents);
  };

  useEffect(() => {
    if (!stripe || handledRedirectRef.current) return;

    const url = new URL(window.location.href);
    const resumeClientId = url.searchParams.get(SUBSCRIBE_CLIENT_PARAM);
    const resumePlanId = url.searchParams.get(SUBSCRIBE_PLAN_PARAM);
    const resumeAmountRaw = url.searchParams.get(SUBSCRIBE_AMOUNT_PARAM);
    const resumeAmount =
      resumeAmountRaw && Number.isFinite(Number(resumeAmountRaw))
        ? Number(resumeAmountRaw)
        : null;
    const clientSecret = url.searchParams.get(SETUP_INTENT_CLIENT_SECRET_PARAM);
    const redirectStatus = url.searchParams.get("redirect_status");

    if (
      !clientSecret ||
      redirectStatus == null ||
      resumeClientId !== clientId ||
      resumePlanId !== planId
    ) {
      return;
    }

    handledRedirectRef.current = true;
    setLoading(true);
    setError(null);

    void stripe.retrieveSetupIntent(clientSecret).then(async ({ setupIntent, error }) => {
      if (error) {
        setError(error.message ?? "Card setup failed. Please try again.");
        setLoading(false);
        clearSubscribeQueryParams();
        return;
      }

      if (setupIntent?.status !== "succeeded") {
        setError("Card setup was not completed. Please try again.");
        setLoading(false);
        clearSubscribeQueryParams();
        return;
      }

      const pmRaw = setupIntent.payment_method;
      const paymentMethodId =
        typeof pmRaw === "string" ? pmRaw : pmRaw?.id ?? null;
      if (!paymentMethodId) {
        setError("Could not confirm payment method. Please try again.");
        setLoading(false);
        clearSubscribeQueryParams();
        return;
      }

      await finalizeSubscription(paymentMethodId, resumeAmount);
    });
  }, [clearSubscribeQueryParams, clientId, finalizeSubscription, planId, stripe]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={!stripe || loading}
        className="w-full"
        
        variant="default"
      >
        {loading ? (
          <>
            <Loader2Icon className="mr-2 size-4 animate-spin" />
            Starting subscription…
          </>
        ) : (
          <>
            <CreditCardIcon className="mr-2 size-4" />
            Save card & subscribe
          </>
        )}
      </Button>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3" />
        <span>
          Your card is saved by Stripe for recurring membership billing.
        </span>
      </div>
    </form>
  );
}

interface SubscribePaymentStepProps {
  clientId: string;
  planId: string;
  planName: string;
  monthlyAmountCents: number;
  customAmountCents: number | null;
  onSuccess: () => void;
  onBack: () => void;
}

export function SubscribePaymentStep({
  clientId,
  planId,
  planName,
  monthlyAmountCents,
  customAmountCents,
  onSuccess,
  onBack,
}: SubscribePaymentStepProps) {
  const t = useT("booking");
  return (
    <div className="space-y-6">
      <Button
        type="button"
        variant="ghost"
        
        className="-ml-2 text-[var(--ink-soft)]"
        onClick={onBack}
      >
        <ArrowLeftIcon className="mr-1 size-4" />
        Back
      </Button>
      <div>
        <h2 className="display text-3xl text-[var(--ink)]">Payment method</h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          {t("subscribePayment.summary", {
            planName,
            amount: (monthlyAmountCents / 100).toFixed(2),
          })}
        </p>
      </div>
      <Elements
        stripe={stripePromise}
        options={{
          mode: "setup",
          currency: "usd",
          appearance: { theme: "stripe" },
        }}
      >
        <SubscribeSetupForm
          clientId={clientId}
          planId={planId}
          customAmountCents={customAmountCents}
          onSuccess={onSuccess}
        />
      </Elements>
    </div>
  );
}
