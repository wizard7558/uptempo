"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { stripePromise } from "@/lib/stripe/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  createPlatformBillingSetupIntent,
  savePlatformPaymentMethod,
  type PlatformBillingSettings,
} from "@/actions/platform-billing";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_LABEL: Record<string, string> = {
  succeeded: "Paid",
  skipped: "No charge",
  failed: "Failed",
  no_payment_method: "No card",
  pending: "Pending",
};

function CardForm({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError(null);
    setSubmitting(true);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Please check the card details");
      setSubmitting(false);
      return;
    }

    const intent = await createPlatformBillingSetupIntent();
    if (!intent.clientSecret) {
      setError("Could not start card setup");
      setSubmitting(false);
      return;
    }

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      clientSecret: intent.clientSecret,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    if (confirmError) {
      setError(confirmError.message ?? "Card setup failed");
      setSubmitting(false);
      return;
    }

    const paymentMethodId =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (!paymentMethodId) {
      setError("Card setup did not return a payment method");
      setSubmitting(false);
      return;
    }

    const result = await savePlatformPaymentMethod(paymentMethodId);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Could not save card");
      return;
    }
    toast.success("Card saved");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-4">
        <PaymentElement />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={!stripe || submitting} className="w-full sm:w-auto">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : "Save card"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PlatformBillingCard({
  settings,
}: {
  settings: PlatformBillingSettings;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { card, recentCharges } = settings;

  function handleSaved() {
    setDialogOpen(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform billing</CardTitle>
        <CardDescription>
          Your plan is now billed monthly to the card on file. We charge the
          greater of the $50 floor or your revenue percentage, less fees already
          collected on transactions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CreditCard className="size-5 text-muted-foreground" />
            {card ? (
              <span className="text-sm">
                <span className="font-medium capitalize">{card.brand}</span> ••••{" "}
                {card.last4}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                No card on file
              </span>
            )}
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" >
                {card ? "Update card" : "Add card"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {card ? "Update payment method" : "Add payment method"}
                </DialogTitle>
              </DialogHeader>
              {dialogOpen ? (
                <Elements
                  stripe={stripePromise}
                  options={{ mode: "setup", currency: "usd", appearance: { theme: "stripe" } }}
                >
                  <CardForm onSaved={handleSaved} />
                </Elements>
              ) : null}
            </DialogContent>
          </Dialog>
        </div>

        {!card ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Add a card so your monthly platform fee can be charged.
          </p>
        ) : null}

        {recentCharges.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent charges
            </p>
            <ul className="divide-y divide-border text-sm">
              {recentCharges.map((c) => (
                <li
                  key={c.periodStart}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-muted-foreground">{c.periodStart}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">
                      {usd(c.amountChargedCents)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
