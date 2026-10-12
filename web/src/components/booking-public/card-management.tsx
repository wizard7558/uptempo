"use client";

import { useT } from "@/lib/terms/client";
import { useState, useEffect, useCallback } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import { getClientPaymentMethod, removePaymentMethod } from "@/actions/stripe";
import { Button } from "@/components/ui/button";
import {
  CreditCardIcon,
  Trash2Icon,
  Loader2Icon,
  ShieldCheckIcon,
  RefreshCwIcon,
} from "lucide-react";

interface CardManagementProps {
  clientId: string;
}

/**
 * Inline save-card form (must render inside the Elements provider). Same
 * deferred SetupIntent flow as the booking payment step: the webhook
 * (setup_intent.succeeded) attaches the new card to the client record,
 * replacing any previous one.
 */
function SaveCardForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Please check your card details");
      setSaving(false);
      return;
    }

    const res = await fetch("/api/stripe/setup-intent", { method: "POST" });
    if (!res.ok) {
      setError("Unable to save card. Please try again.");
      setSaving(false);
      return;
    }
    const { clientSecret } = await res.json();

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      clientSecret,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Card setup failed. Please try again.");
      setSaving(false);
    } else {
      onSaved();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={!stripe || saving}
          
          variant="default"
          className="flex-1"
        >
          {saving ? (
            <>
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Saving card...
            </>
          ) : (
            <>
              <CreditCardIcon className="mr-2 size-4" />
              Save card
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function CardManagement({ clientId }: CardManagementProps) {
  const t = useT("booking");
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [cardInfo, setCardInfo] = useState<{
    hasCard: boolean;
    last4?: string;
    brand?: string;
  } | null>(null);

  const loadCard = useCallback(async () => {
    setLoading(true);
    const result = await getClientPaymentMethod(clientId);
    setCardInfo(result);
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    loadCard();
  }, [loadCard]);

  async function handleRemove() {
    if (!confirm("Are you sure you want to remove your saved card?")) return;
    setRemoving(true);
    await removePaymentMethod(clientId);
    setCardInfo({ hasCard: false });
    setRemoving(false);
  }

  function handleSaved() {
    setEditing(false);
    setJustSaved(true);
    // The card attaches via Stripe webhook — give it a moment, then refresh.
    setTimeout(() => {
      loadCard();
      setJustSaved(false);
    }, 2500);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--ink-soft)]">
        <Loader2Icon className="size-4 animate-spin" />
        Loading card info...
      </div>
    );
  }

  if (editing) {
    return (
      <Elements
        stripe={stripePromise}
        options={{
          mode: "setup",
          currency: "usd",
          appearance: { theme: "stripe" },
        }}
      >
        <SaveCardForm onSaved={handleSaved} onCancel={() => setEditing(false)} />
      </Elements>
    );
  }

  return (
    <div className="space-y-4">
      {justSaved && (
        <p className="text-sm text-[var(--ink)]">
          Card saved — it may take a few seconds to appear below.
        </p>
      )}

      {cardInfo?.hasCard ? (
        <div className="flex items-center justify-between border border-[var(--line)] p-4">
          <div className="flex items-center gap-3">
            <CreditCardIcon className="size-5 text-[var(--ink-soft)]" />
            <div>
              <p className="text-sm font-medium">
                {cardInfo.brand?.toUpperCase() ?? "Card"} ending in{" "}
                {cardInfo.last4 ?? "****"}
              </p>
              <p className="text-xs text-[var(--ink-soft)]">Saved on file</p>
            </div>
          </div>
          <Button
            variant="ghost"
            
            onClick={handleRemove}
            disabled={removing}
            className="text-destructive hover:text-destructive"
          >
            {removing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
          </Button>
        </div>
      ) : (
        <div className="border border-dashed border-[var(--line)] p-6 text-center">
          <CreditCardIcon className="mx-auto mb-2 size-8 text-[var(--ink-soft)]" />
          <p className="text-sm text-[var(--ink-soft)]">No card on file</p>
        </div>
      )}

      <Button
        variant="ghost"
        
        onClick={() => setEditing(true)}
        className="w-full"
      >
        {cardInfo?.hasCard ? (
          <>
            <RefreshCwIcon className="mr-2 size-4" />
            Replace card
          </>
        ) : (
          <>
            <CreditCardIcon className="mr-2 size-4" />
            Add a card
          </>
        )}
      </Button>

      <div className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
        <ShieldCheckIcon className="size-3" />
        <span>
          {t("cardManagement.policyNote")}
        </span>
      </div>
    </div>
  );
}
