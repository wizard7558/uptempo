"use client";

import { useT } from "@/lib/terms/client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  getStoredValuePreviewForClient,
  createStoredValueTopUpPaymentIntent,
} from "@/actions/membership";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";

interface Props {
  clientId: string;
}

function TopUpConfirmForm({
  onDone,
}: {
  onDone: () => void;
}) {
  const t = useT("booking");
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        toast.error(submitError.message ?? "Invalid payment details");
        setSubmitting(false);
        return;
      }

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });

      if (error) {
        toast.error(error.message ?? "Payment failed");
        setSubmitting(false);
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        toast.success(t("storedValueTopUp.success"));
        onDone();
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <Button
        className="w-full"
        onClick={pay}
        disabled={submitting || !stripe}
        variant="default"
        
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          "Confirm payment"
        )}
      </Button>
    </div>
  );
}

export function StoredValueTopUp({ clientId }: Props) {
  const t = useT("booking");
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [dollars, setDollars] = useState("50");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amountLabel, setAmountLabel] = useState("");

  const load = useCallback(async () => {
    const p = await getStoredValuePreviewForClient(clientId);
    setBalanceCents(p.balanceCents);
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function startPay() {
    const v = Number.parseFloat(dollars);
    if (!Number.isFinite(v) || v < 0.5) {
      toast.error("Minimum top-up is $0.50");
      return;
    }
    const cents = Math.round(v * 100);
    const res = await createStoredValueTopUpPaymentIntent({
      clientId,
      amountCents: cents,
    });
    if (!res.success || !res.clientSecret) {
      toast.error(
        "error" in res && res.error ? String(res.error) : "Could not start payment",
      );
      return;
    }
    setAmountLabel(`$${(cents / 100).toFixed(2)}`);
    setClientSecret(res.clientSecret);
  }

  return (
    <div className="space-y-4 border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-[var(--ink-soft)]" />
        <h2 className="font-display text-2xl font-light text-[var(--ink)]">{t("storedValueTopUp.title")}</h2>
      </div>
      {balanceCents !== null && (
        <p className="text-sm text-[var(--ink-soft)]">
          Current balance:{" "}
          <strong className="text-[var(--ink)]">
            ${(balanceCents / 100).toFixed(2)}
          </strong>
        </p>
      )}

      {!clientSecret ? (
        <div className="space-y-3 max-w-xs">
          <Field htmlFor="topup-amt" label="Add funds (USD)">
            <Field.Input
              id="topup-amt"
              type="number"
              min={0.5}
              step="0.01"
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            
            onClick={startPay}
          >
            Continue
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--ink)]">Pay {amountLabel}</p>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
            }}
          >
            <TopUpConfirmForm
              onDone={() => {
                setClientSecret(null);
                load();
              }}
            />
          </Elements>
          <Button
            type="button"
            variant="ghost"
            
            onClick={() => setClientSecret(null)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
