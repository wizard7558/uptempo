"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import {
  attachClientPaymentMethodForAdmin,
  createClientSetupIntentForAdmin,
  removeClientCardForAdmin,
} from "@/actions/stripe";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CreditCard, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useT } from "@/lib/terms/client";

interface CardInfo {
  hasCard: boolean;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
}

interface ClientCardOnFileProps {
  clientId: string;
  card: CardInfo;
}

function formatBrand(brand: string | null | undefined): string {
  if (!brand) return "Card";
  return brand
    .replace(/_/g, " ")
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function CardForm({
  clientId,
  onSaved,
}: {
  clientId: string;
  onSaved: () => void;
}) {
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

    const intent = await createClientSetupIntentForAdmin(clientId);
    if (!intent.success || !intent.clientSecret) {
      setError(("error" in intent && intent.error) || "Could not start card setup");
      setSubmitting(false);
      return;
    }

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      clientSecret: intent.clientSecret,
      redirect: "if_required",
      confirmParams: {
        return_url: window.location.href,
      },
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

    const attach = await attachClientPaymentMethodForAdmin({
      clientId,
      paymentMethodId,
    });
    setSubmitting(false);

    if (!attach.success) {
      setError(attach.error ?? "Could not save card");
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={!stripe || submitting} className="w-full sm:w-auto">
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Save card
            </>
          )}
        </Button>
      </DialogFooter>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3 w-3" />
        <span>Stripe stores the card. We never see the full number.</span>
      </div>
    </form>
  );
}

export function ClientCardOnFile({ clientId, card }: ClientCardOnFileProps) {
  const t = useT("clients");
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    const result = await removeClientCardForAdmin(clientId);
    setRemoving(false);
    setConfirmRemoveOpen(false);
    if (result.success) {
      toast.success("Card removed");
      router.refresh();
    } else {
      toast.error("Could not remove card");
    }
  }

  function handleSaved() {
    setDialogOpen(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Card on file</CardTitle>
          <CardDescription>
            Saved Stripe payment method for charges and no-show fees.
          </CardDescription>
        </div>
        <CreditCard className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {card.hasCard ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="font-medium">
                {formatBrand(card.brand)} •••• {card.last4 ?? "----"}
              </p>
              {card.expMonth && card.expYear ? (
                <p className="text-xs text-muted-foreground">
                  Expires{" "}
                  {String(card.expMonth).padStart(2, "0")}/
                  {String(card.expYear).slice(-2)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                
                onClick={() => setDialogOpen(true)}
              >
                Replace card
              </Button>
              <Button
                variant="ghost"
                
                onClick={() => setConfirmRemoveOpen(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              No card on file for this client.
            </p>
            <Button  onClick={() => setDialogOpen(true)}>
              <CreditCard className="mr-1 h-3.5 w-3.5" />
              Add card
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {card.hasCard ? "Replace card on file" : "Add card on file"}
            </DialogTitle>
            <DialogDescription>
              {t("cardOnFile.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {/* Re-mount Elements per dialog open so options resolve cleanly. */}
          {dialogOpen ? (
            <Elements
              stripe={stripePromise}
              options={{
                mode: "setup",
                currency: "usd",
                appearance: { theme: "stripe" },
              }}
            >
              <CardForm clientId={clientId} onSaved={handleSaved} />
            </Elements>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmRemoveOpen}
        onOpenChange={(next) => {
          if (!removing) setConfirmRemoveOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove card on file?</DialogTitle>
            <DialogDescription>
              The saved card will be detached from this client. You can add a
              new one anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRemoveOpen(false)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                "Remove card"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
