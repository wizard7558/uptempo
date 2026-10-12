"use client";

import { useT } from "@/lib/terms/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { percentTipCents } from "@/lib/checkout/tip";
import { RebookPrompt } from "@/components/checkout/rebook-prompt";
import {
  completeAppointment,
  createCheckoutPaymentIntent,
} from "@/actions/checkout";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import {
  CheckCircle,
  CreditCard,
  Loader2,
  AlertCircle,
  Wallet,
} from "lucide-react";

interface CheckoutFormProps {
  token: string;
  appointmentId: string;
  client: {
    id: string;
    name: string;
    hasCardOnFile: boolean;
    stripeCustomerId: string | null;
    stripePaymentMethodId: string | null;
  };
  services: { serviceName: string; priceCents: number }[];
  totalCents: number;
  storedValueBalanceCents: number;
  storedValueAppliedCents: number;
  cardChargeCents: number;
  memberDiscountPercent: number;
  fullBbDiscountedTotalCents: number;
  eligibleForFullBb: boolean;
  /** A pack or membership credit already paid for the services; only a tip is left. */
  paidWithCredit?: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function NewCardPaymentForm({
  token,
  appointmentId,
  cardChargeCents,
  tipCents,
  onSuccess,
  onError,
}: {
  token: string;
  appointmentId: string;
  cardChargeCents: number;
  tipCents: number;
  onSuccess: (paymentIntentId: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useT("booking");
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setSubmitting(true);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        onError(submitError.message ?? "Card validation failed");
        setSubmitting(false);
        return;
      }

      const result = await createCheckoutPaymentIntent(
        appointmentId,
        tipCents,
        undefined,
        token,
      );
      if ("error" in result && result.error) {
        onError(
          typeof result.error === "string"
            ? result.error
            : "Could not start payment",
        );
        setSubmitting(false);
        return;
      }

      if ("noCardChargeNeeded" in result && result.noCardChargeNeeded) {
        onError(
          t("checkoutForm.noCardNeeded"),
        );
        setSubmitting(false);
        return;
      }

      if (!result.clientSecret) {
        onError("Failed to create payment intent");
        setSubmitting(false);
        return;
      }

      // Build a return_url that carries the tip so we can resume cleanly after
      // a 3DS full-page redirect (some debit issuers force redirect_to_url).
      const resumeUrl = new URL(window.location.href);
      resumeUrl.searchParams.set("checkout_resume", "1");
      resumeUrl.searchParams.set("checkout_tip", String(tipCents));

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: result.clientSecret,
        redirect: "if_required",
        confirmParams: {
          return_url: resumeUrl.toString(),
        },
      });

      if (error) {
        onError(error.message ?? "Payment failed");
        setSubmitting(false);
        return;
      }

      if (paymentIntent?.id) {
        onSuccess(paymentIntent.id);
      } else {
        onError("Payment confirmation failed");
      }
    } catch {
      onError("Payment failed unexpectedly");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={submitting || !stripe || !elements}
        variant="default"
        
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          `Pay ${formatPrice(cardChargeCents)}`
        )}
      </Button>
    </div>
  );
}

export function CheckoutForm({
  token,
  appointmentId,
  client,
  services,
  totalCents,
  storedValueBalanceCents,
  storedValueAppliedCents,
  cardChargeCents,
  memberDiscountPercent,
  fullBbDiscountedTotalCents,
  eligibleForFullBb,
  paidWithCredit = false,
}: CheckoutFormProps) {
  const t = useT("booking");
  const tpk = useT("packages");
  const [selectedMethod, setSelectedMethod] = useState<
    "card_on_file" | "new_card" | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successTotalCents, setSuccessTotalCents] = useState<number | null>(
    null,
  );
  const [successBbCents, setSuccessBbCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipCents, setTipCents] = useState(0);
  const [customTipDollars, setCustomTipDollars] = useState("");
  /** When eligible, "member" uses discounted full-BB path; "standard" uses partial BB + card/cash. */
  const [memberBbMode, setMemberBbMode] = useState<"member" | "standard">(
    () =>
      eligibleForFullBb && memberDiscountPercent > 0 ? "member" : "standard",
  );

  useEffect(() => {
    if (tipCents > 0 || !eligibleForFullBb) {
      setMemberBbMode("standard");
    }
  }, [tipCents, eligibleForFullBb]);

  // Resume checkout after a Stripe 3DS full-page redirect. The form's
  // confirmPayment call sets ?checkout_resume=1&checkout_tip=<cents>; Stripe
  // appends ?payment_intent=&redirect_status=. On a fresh mount we finalize.
  const resumeRanRef = useRef(false);
  useEffect(() => {
    if (resumeRanRef.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("checkout_resume") !== "1") return;
    resumeRanRef.current = true;

    const piId = url.searchParams.get("payment_intent");
    const status = url.searchParams.get("redirect_status");
    const resumedTip = Math.max(
      0,
      Number.parseInt(url.searchParams.get("checkout_tip") ?? "0", 10) || 0,
    );

    const cleanUrl = new URL(url.toString());
    for (const k of [
      "checkout_resume",
      "checkout_tip",
      "payment_intent",
      "payment_intent_client_secret",
      "redirect_status",
    ]) {
      cleanUrl.searchParams.delete(k);
    }
    window.history.replaceState(
      {},
      "",
      cleanUrl.pathname + cleanUrl.search,
    );

    if (status === "succeeded" && piId) {
      (async () => {
        setSubmitting(true);
        try {
          const result = await completeAppointment({
            appointmentId,
            token,
            paymentMethod: "new_card",
            stripePaymentIntentId: piId,
            tipCents: resumedTip,
          });
          if (result.success) {
            setSuccessTotalCents(result.totalCents);
            setSuccessBbCents(storedValueAppliedCents);
            setSuccess(true);
          } else {
            setError(result.error ?? "Payment failed");
          }
        } catch {
          setError("Payment failed unexpectedly");
        } finally {
          setSubmitting(false);
        }
      })();
    } else {
      setError(
        status === "failed"
          ? "Card authentication failed — please try again"
          : "Checkout could not be completed",
      );
    }
  }, [appointmentId, storedValueAppliedCents]);

  const isMemberBbCheckout =
    eligibleForFullBb && tipCents === 0 && memberBbMode === "member";

  const displayBbApplied = useMemo(
    () =>
      isMemberBbCheckout ? fullBbDiscountedTotalCents : storedValueAppliedCents,
    [
      isMemberBbCheckout,
      fullBbDiscountedTotalCents,
      storedValueAppliedCents,
    ],
  );

  const displayServicesTotal = useMemo(
    () => (isMemberBbCheckout ? fullBbDiscountedTotalCents : totalCents),
    [isMemberBbCheckout, fullBbDiscountedTotalCents, totalCents],
  );

  const cardDueCents = useMemo(() => {
    if (isMemberBbCheckout) {
      return tipCents;
    }
    return cardChargeCents + tipCents;
  }, [isMemberBbCheckout, cardChargeCents, tipCents]);

  const discountCents =
    isMemberBbCheckout && memberDiscountPercent > 0
      ? totalCents - fullBbDiscountedTotalCents
      : 0;

  async function handleStoredValueFullMember() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await completeAppointment({
        appointmentId,
        token,
        paymentMethod: "beauty_bank",
        tipCents: 0,
      });
      if (result.success) {
        setSuccessTotalCents(result.totalCents);
        setSuccessBbCents(fullBbDiscountedTotalCents);
        setSuccess(true);
      } else {
        setError(result.error ?? "Checkout failed");
      }
    } catch {
      setError("Checkout failed unexpectedly");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStoredValueStandardCash() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await completeAppointment({
        appointmentId,
        token,
        paymentMethod: "cash",
        tipCents: 0,
      });
      if (result.success) {
        setSuccessTotalCents(result.totalCents);
        setSuccessBbCents(storedValueAppliedCents);
        setSuccess(true);
      } else {
        setError(result.error ?? "Checkout failed");
      }
    } catch {
      setError("Checkout failed unexpectedly");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCardOnFile() {
    setSubmitting(true);
    setError(null);

    try {
      const result = await completeAppointment({
        appointmentId,
        token,
        paymentMethod: "card_on_file",
        tipCents,
      });

      if (result.success) {
        setSuccessTotalCents(result.totalCents);
        setSuccessBbCents(storedValueAppliedCents);
        setSuccess(true);
      } else {
        setError(result.error ?? "Payment failed");
      }
    } catch {
      setError("Payment failed unexpectedly");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNewCardSuccess(paymentIntentId: string) {
    setSubmitting(true);
    setError(null);

    try {
      const result = await completeAppointment({
        appointmentId,
        token,
        paymentMethod: "new_card",
        stripePaymentIntentId: paymentIntentId,
        tipCents,
      });

      if (result.success) {
        setSuccessTotalCents(result.totalCents);
        setSuccessBbCents(storedValueAppliedCents);
        setSuccess(true);
      } else {
        setError(result.error ?? "Payment failed");
      }
    } catch {
      setError("Payment failed unexpectedly");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const bbMsg =
      successBbCents != null && successBbCents > 0
        ? ` ${t("checkoutForm.successIncluding", { amount: formatPrice(successBbCents) })}`
        : "";
    return (
      <div className="border border-[var(--line)] bg-[var(--ivory-raised)] p-6 space-y-6 text-center">
        <div className="flex justify-center">
          <CheckCircle className="h-16 w-16 text-green-600" />
        </div>
        <div>
          <h2 className="display text-4xl text-[var(--ink)]">Payment Complete!</h2>
          <p className="text-[var(--ink-soft)] mt-2">
            {formatPrice(successTotalCents ?? totalCents)} total
            {bbMsg}. Thank you!
          </p>
        </div>
        <Separator />
        <RebookPrompt clientId={client.id} />
      </div>
    );
  }

  const bankOnlyStandard =
    cardChargeCents === 0 &&
    storedValueAppliedCents > 0 &&
    tipCents === 0 &&
    !eligibleForFullBb;

  const bankOnlyEligibleNoDiscount =
    cardChargeCents === 0 &&
    tipCents === 0 &&
    eligibleForFullBb &&
    memberDiscountPercent === 0;

  const showMemberModeToggle =
    eligibleForFullBb && tipCents === 0 && memberDiscountPercent > 0;

  const showCardSection =
    !isMemberBbCheckout && (cardDueCents > 0 || client.hasCardOnFile);

  return (
    <div className="border border-[var(--line)] bg-[var(--ivory-raised)] p-6 space-y-6">
      <div>
        <h1 className="display text-4xl text-[var(--ink)]">Checkout</h1>
        <p className="text-[var(--ink-soft)] mt-1">
          Hi {client.name}, please complete your payment below.
        </p>
      </div>

      {paidWithCredit && (
        <p className="border border-[var(--line)] px-3 py-2 text-sm font-medium">
          {tpk("paidWithCredit")}
        </p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Services</h4>
        {services.map((svc, i) => (
          <div
            key={i}
            className="flex items-center justify-between text-sm"
          >
            <span>{svc.serviceName}</span>
            <span className="text-muted-foreground">
              {formatPrice(svc.priceCents)}
            </span>
          </div>
        ))}
        <Separator />
        {discountCents > 0 && (
          <div className="flex items-center justify-between text-sm text-primary">
            <span>Member discount ({memberDiscountPercent}%)</span>
            <span>-{formatPrice(discountCents)}</span>
          </div>
        )}
        {storedValueBalanceCents > 0 && (
          <div className="flex items-center justify-between text-sm text-primary">
            <span className="flex items-center gap-1">
              <Wallet className="h-4 w-4" />
              {isMemberBbCheckout
                ? t("checkoutForm.memberRate")
                : t("checkoutForm.partial")}
            </span>
            <span>-{formatPrice(displayBbApplied)}</span>
          </div>
        )}
        {tipCents > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Tip</span>
            <span>{formatPrice(tipCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between font-bold text-sm">
          <span>
            {bankOnlyStandard || bankOnlyEligibleNoDiscount || isMemberBbCheckout
              ? "Total due"
              : "Total"}
          </span>
          <span>{formatPrice(displayServicesTotal + tipCents)}</span>
        </div>
        {cardDueCents > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Card charge</span>
            <span>{formatPrice(cardDueCents)}</span>
          </div>
        )}
        {storedValueBalanceCents > 0 && storedValueAppliedCents === 0 && !isMemberBbCheckout && (
          <p className="text-xs text-muted-foreground">
            {t("checkoutForm.balanceNotApplied", {
              amount: formatPrice(storedValueBalanceCents),
            })}
          </p>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <Label className="text-sm font-medium">Tip (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Based on services total ({formatPrice(totalCents)}).
        </p>
        <div className="flex flex-wrap gap-2">
          {([18, 20, 25] as const).map((pct) => {
            const cents = percentTipCents(totalCents, pct);
            return (
              <Button
                key={pct}
                type="button"
                
                variant={tipCents === cents ? "default" : "outline"}
                onClick={() => {
                  setCustomTipDollars("");
                  setTipCents(cents);
                }}
                disabled={submitting}
              >
                {pct}%
              </Button>
            );
          })}
          <Button
            type="button"
            
            variant={tipCents === 0 ? "default" : "outline"}
            onClick={() => {
              setTipCents(0);
              setCustomTipDollars("");
            }}
            disabled={submitting}
          >
            No tip
          </Button>
        </div>
        <div className="space-y-1">
          <Label htmlFor="public-tip-custom" className="text-xs">
            Custom ($)
          </Label>
          <Input
            id="public-tip-custom"
            inputMode="decimal"
            placeholder="0.00"
            value={customTipDollars}
            onChange={(e) => {
              const v = e.target.value;
              setCustomTipDollars(v);
              const n = Number.parseFloat(v);
              if (!Number.isFinite(n) || n < 0) {
                setTipCents(0);
              } else {
                setTipCents(Math.round(n * 100));
              }
            }}
            disabled={submitting}
          />
        </div>
      </div>

      <Separator />

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="ghost"
              
              className="mt-1 h-auto p-0 text-xs text-destructive underline"
              onClick={() => setError(null)}
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {showMemberModeToggle && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <p className="text-sm font-medium">{t("checkoutForm.modeTitle")}</p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant={memberBbMode === "member" ? "default" : "outline"}
              className="h-auto min-h-14 justify-start px-4 py-3 text-left whitespace-normal"
              onClick={() => {
                setMemberBbMode("member");
                setSelectedMethod(null);
                setError(null);
              }}
              disabled={submitting}
            >
              <Wallet className="mr-2 h-5 w-5 shrink-0 inline" />
              <span>
                {t("checkoutForm.payFully")}
                {memberDiscountPercent > 0
                  ? ` (${memberDiscountPercent}% off services)`
                  : ""}{" "}
                — {formatPrice(fullBbDiscountedTotalCents)} from your balance
              </span>
            </Button>
            <Button
              type="button"
              variant={memberBbMode === "standard" ? "default" : "outline"}
              className="h-auto min-h-14 justify-start px-4 py-3 text-left whitespace-normal"
              onClick={() => {
                setMemberBbMode("standard");
                setSelectedMethod(null);
                setError(null);
              }}
              disabled={submitting}
            >
              {t("checkoutForm.standardPrefix")}
              {formatPrice(storedValueAppliedCents)} from BB
              {cardChargeCents > 0
                ? `, ${formatPrice(cardChargeCents + tipCents)} due`
                : ""}
              )
            </Button>
          </div>
        </div>
      )}

      {isMemberBbCheckout && (
          <Button
            className="w-full"
          onClick={handleStoredValueFullMember}
          disabled={submitting}
            variant="default"
            
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-5 w-5" />
              {t("checkoutForm.payAmount", {
                amount: formatPrice(fullBbDiscountedTotalCents),
              })}
            </>
          )}
        </Button>
      )}

      {bankOnlyStandard && (
        <Button
          className="w-full"
          onClick={handleStoredValueStandardCash}
          disabled={submitting}
          variant="default"
          
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-5 w-5" />
              {t("checkoutForm.payAmount", { amount: formatPrice(totalCents) })}
            </>
          )}
        </Button>
      )}

      {bankOnlyEligibleNoDiscount && (
        <Button
          className="w-full"
          onClick={handleStoredValueFullMember}
          disabled={submitting}
          variant="default"
          
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-5 w-5" />
              {t("checkoutForm.payAmount", { amount: formatPrice(totalCents) })}
            </>
          )}
        </Button>
      )}

      {showCardSection && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Payment Method</h4>

          {client.hasCardOnFile && (
            <Button
              variant={selectedMethod === "card_on_file" ? "default" : "outline"}
              className="w-full justify-start gap-3 h-14"
              onClick={() => {
                setSelectedMethod("card_on_file");
                setError(null);
              }}
              disabled={submitting}
            >
              <CreditCard className="h-5 w-5" />
              <span>Pay with card on file</span>
            </Button>
          )}

          {cardDueCents > 0 && (
            <Button
              variant={selectedMethod === "new_card" ? "default" : "outline"}
              className="w-full justify-start gap-3 h-14"
              onClick={() => {
                setSelectedMethod("new_card");
                setError(null);
              }}
              disabled={submitting}
            >
              <CreditCard className="h-5 w-5" />
              <span>Pay with a new card</span>
            </Button>
          )}
        </div>
      )}

      {selectedMethod === "card_on_file" && !isMemberBbCheckout && (
        <Button
          className="w-full"
          onClick={handleCardOnFile}
          disabled={submitting}
          variant="default"
          
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            `Pay ${formatPrice(cardDueCents)}${
              storedValueAppliedCents > 0
                ? ` (${t("checkoutForm.fromPrepaid", { amount: formatPrice(storedValueAppliedCents) })})`
                : ""
            }`
          )}
        </Button>
      )}

      {selectedMethod === "new_card" && cardDueCents > 0 && !isMemberBbCheckout && (
        <Elements
          key={`pay-${tipCents}`}
          stripe={stripePromise}
          options={{
            mode: "payment",
            amount: cardDueCents,
            currency: "usd",
          }}
        >
          <NewCardPaymentForm
            token={token}
            appointmentId={appointmentId}
            cardChargeCents={cardDueCents}
            tipCents={tipCents}
            onSuccess={handleNewCardSuccess}
            onError={(msg) => setError(msg)}
          />
        </Elements>
      )}

      {!isMemberBbCheckout &&
        eligibleForFullBb &&
        tipCents === 0 &&
        cardChargeCents === 0 &&
        memberDiscountPercent > 0 &&
        memberBbMode === "standard" && (
          <Button
            className="w-full"
            onClick={handleStoredValueStandardCash}
            disabled={submitting}
            variant="default"
            
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-5 w-5" />
                {t("checkoutForm.payListPrice", { amount: formatPrice(totalCents) })}
              </>
            )}
          </Button>
        )}
    </div>
  );
}
