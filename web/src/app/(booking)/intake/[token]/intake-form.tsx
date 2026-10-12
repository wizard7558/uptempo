"use client";

import { useT } from "@/lib/terms/client";
import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  CheckCircle,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import {
  createIntakeSetupIntent,
  finalizeIntake,
} from "@/actions/policies";

interface IntakeFormProps {
  token: string;
  clientName: string;
  salonName: string;
  logoUrl: string | null;
  policyText: string;
}

interface InnerFormProps {
  token: string;
  clientName: string;
  onCompleted: () => void;
}

function InnerForm({ token, clientName, onCompleted }: InnerFormProps) {
  const t = useT("booking");
  const stripe = useStripe();
  const elements = useElements();
  const [signedName, setSignedName] = useState(clientName);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError(null);

    if (signedName.trim().length < 2) {
      setError("Please type your full name to sign.");
      return;
    }
    if (!acknowledged) {
      setError("Please confirm you've read the policies.");
      return;
    }

    setSubmitting(true);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Please check your card details");
      setSubmitting(false);
      return;
    }

    const intentResult = await createIntakeSetupIntent(token);
    if ("error" in intentResult) {
      setError(intentResult.error ?? "Could not start card setup");
      setSubmitting(false);
      return;
    }
    if (!intentResult.clientSecret) {
      setError("Could not start card setup");
      setSubmitting(false);
      return;
    }

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      clientSecret: intentResult.clientSecret,
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

    const finalize = await finalizeIntake({
      token,
      signedName: signedName.trim(),
      paymentMethodId,
    });

    if (!finalize.success) {
      setError(finalize.error ?? "Could not finalize intake");
      setSubmitting(false);
      return;
    }

    onCompleted();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="signedName">Type your full name to sign</Label>
        <Input
          id="signedName"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          placeholder="Your full name"
          autoComplete="name"
          required
        />
      </div>

      <label className="flex items-start gap-3 text-sm text-[var(--ink)]">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(v) => setAcknowledged(v === true)}
          className="mt-0.5"
        />
        <span>
          {t("intakeForm.agree")}
        </span>
      </label>

      <div className="space-y-2">
        <Label>Card on file</Label>
        <div className="rounded-md border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
          <PaymentElement />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full"
        
        variant="default"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <CreditCard className="mr-2 size-4" />
            Sign &amp; save card
          </>
        )}
      </Button>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3" />
        <span>
          Your card is securely saved by Stripe. We never see your full card
          number.
        </span>
      </div>
    </form>
  );
}

export function IntakeForm({
  token,
  clientName,
  salonName,
  logoUrl,
  policyText,
}: IntakeFormProps) {
  const t = useT("booking");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center space-y-4">
        <CheckCircle className="mx-auto size-12 text-green-600" />
        <h1 className="display text-3xl text-[var(--ink)]">All set</h1>
        <p className="text-[var(--ink-soft)]">
          Thanks {clientName.split(" ")[0]} — your signature and card are saved.
          See you soon at {salonName}!
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12 space-y-8">
      <header className="text-center space-y-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={salonName}
            className="mx-auto h-12 w-auto"
          />
        ) : null}
        <h1 className="display text-3xl text-[var(--ink)]">
          Welcome from {salonName}
        </h1>
        <p className="text-sm text-[var(--ink-soft)]">
          Please review our policies, sign, and add a card on file before your
          appointment.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          {t("intakeForm.policiesTitle")}
        </h2>
        <div className="rounded-md border border-[var(--line)] bg-[var(--ivory-raised)] p-4 text-sm leading-6 text-[var(--ink)] whitespace-pre-wrap">
          {policyText}
        </div>
      </section>

      <Elements
        stripe={stripePromise}
        options={{
          mode: "setup",
          currency: "usd",
          appearance: { theme: "stripe" },
        }}
      >
        <InnerForm
          token={token}
          clientName={clientName}
          onCompleted={() => setDone(true)}
        />
      </Elements>
    </div>
  );
}
