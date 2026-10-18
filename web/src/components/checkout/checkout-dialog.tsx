"use client";

import { useT } from "@/lib/terms/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { percentTipCents } from "@/lib/checkout/tip";
import { computeCheckoutAmounts } from "@/lib/checkout/due-now";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  PaymentSelector,
  type PaymentMethod,
} from "./payment-selector";
import {
  getCheckoutData,
  completeAppointment,
  createCheckoutPaymentIntent,
  sendReceipt,
} from "@/actions/checkout";
import { applyCreditAtCheckout } from "@/actions/credit-redemption";
import { lookupGiftCardForCheckout } from "@/actions/gift-cards";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import { Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { RebookPrompt } from "@/components/checkout/rebook-prompt";
import { ProcessingFeeSummary } from "@/components/billing/processing-fee-summary";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface CheckoutData {
  appointment: { id: string; status: string };
  /** Set when this checkout pays for a whole group booking. */
  group: { id: string; count: number } | null;
  client: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    stripeCustomerId: string | null;
    stripePaymentMethodId: string | null;
    hasCardOnFile: boolean;
  };
  services: { serviceId: string; serviceName: string; priceCents: number }[];
  totalCents: number;
  storedValueBalanceCents: number;
  storedValueAppliedCents: number;
  cardChargeCents: number;
  /** Deposit credit taken off what is due now. */
  depositAppliedCents: number;
  /** A pack or membership credit already pays for the services; only a tip is left. */
  creditCovered: boolean;
  /** "Use a credit" can be offered for this visit. */
  creditEligible: boolean;
  /** Set when the appointment belongs to a multi-session project. */
  project: { id: string; depositCreditCents: number; isLastScheduled: boolean } | null;
  hasActiveMembership: boolean;
  memberDiscountPercent: number;
  fullBbDiscountedTotalCents: number;
  eligibleForFullBb: boolean;
  staffName: string;
  giftCardsEnabled?: boolean;
}

type AppliedGift = {
  code: string;
  last4: string;
  balanceCents: number;
  useCents: number;
};

interface CheckoutDialogProps {
  appointmentId: string | null;
  onClose: () => void;
  onComplete: () => void;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Inner form for the "new card" flow that lives inside the Stripe Elements provider.
 */
function NewCardForm({
  appointmentId,
  cardChargeCents,
  tipCents,
  finalProjectSession,
  giftCard,
  onSuccess,
  onError,
}: {
  appointmentId: string;
  cardChargeCents: number;
  tipCents: number;
  finalProjectSession: boolean;
  giftCard?: { code: string; amountCents: number };
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
      // Validate the form fields
      const { error: submitError } = await elements.submit();
      if (submitError) {
        onError(submitError.message ?? "Card validation failed");
        setSubmitting(false);
        return;
      }

      // Create PaymentIntent on server
      const result = await createCheckoutPaymentIntent(
        appointmentId,
        tipCents,
        finalProjectSession,
        giftCard,
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
          t("checkoutDialog.noCardNeeded"),
        );
        setSubmitting(false);
        return;
      }

      if (!result.clientSecret) {
        onError("Failed to create payment intent");
        setSubmitting(false);
        return;
      }

      // Build a return_url that lets us resume after a 3DS full-page redirect
      // (some debit issuers force redirect_to_url instead of inline iframe auth).
      const resumeUrl = new URL(window.location.href);
      resumeUrl.searchParams.set("checkout_resume", appointmentId);
      resumeUrl.searchParams.set("checkout_tip", String(tipCents));
      if (finalProjectSession) resumeUrl.searchParams.set("checkout_final", "1");

      // Confirm payment client-side
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
        className="w-full bg-green-600 hover:bg-green-700 text-white"
        onClick={handleSubmit}
        disabled={submitting || !stripe || !elements}
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

export function CheckoutDialog({
  appointmentId,
  onClose,
  onComplete,
}: CheckoutDialogProps) {
  const t = useT("booking");
  const ts = useT("schedule");
  const tpk = useT("packages");
  const [applyingCredit, setApplyingCredit] = useState(false);
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedAmount, setCompletedAmount] = useState<number | null>(null);
  const [completedFee, setCompletedFee] = useState<{
    feeCents: number;
    rateLabel: string;
  } | null>(null);
  const [receiptSending, setReceiptSending] = useState(false);
  const [receiptDone, setReceiptDone] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [tipCents, setTipCents] = useState(0);
  const [customTipDollars, setCustomTipDollars] = useState("");
  // Project checkouts: "this is the last session" re-prices the visit on the server.
  const [finalSession, setFinalSession] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [gift, setGift] = useState<AppliedGift | null>(null);
  const [giftCode, setGiftCode] = useState("");
  const [giftError, setGiftError] = useState<string | null>(null);
  const tg = useT("giftCards");
  const recomputeSeq = useRef(0);

  const isOpen = appointmentId !== null;

  const giftActive = gift !== null && selectedMethod !== "beauty_bank";
  const amounts = useMemo(() => {
    if (!checkoutData) return null;
    return computeCheckoutAmounts({
      payingFullFromPrepaid: selectedMethod === "beauty_bank" && tipCents === 0,
      totalCents: checkoutData.totalCents,
      tipCents,
      partialBankAppliedCents: checkoutData.storedValueAppliedCents,
      discountedTotalCents: checkoutData.fullBbDiscountedTotalCents,
      depositAppliedCents: checkoutData.depositAppliedCents,
      creditCovered: checkoutData.creditCovered,
      giftBalanceCents: giftActive ? (gift?.balanceCents ?? 0) : 0,
      giftRequestedCents: giftActive ? (gift?.useCents ?? null) : null,
    });
  }, [checkoutData, tipCents, selectedMethod, gift, giftActive]);
  const cardChargeWithTip = amounts?.remainderCents ?? 0;

  useEffect(() => {
    if (selectedMethod === "beauty_bank" && tipCents > 0) {
      setSelectedMethod(null);
    }
  }, [tipCents, selectedMethod]);

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    setSelectedMethod(null);
    setCompletedAmount(null);
    setCompletedFee(null);
    setReceiptDone(false);
    setTipCents(0);
    setCustomTipDollars("");
    setFinalSession(false);
    setGift(null);
    setGiftCode("");
    setGiftError(null);
    recomputeSeq.current += 1;
    try {
      const result = await getCheckoutData(id);
      if ("error" in result) {
        toast.error(result.error);
        onClose();
        return;
      }
      let data = result as CheckoutData;
      // A project's last scheduled session starts with the deposit credit applied.
      if (data.project?.isLastScheduled) {
        const again = await getCheckoutData(id, true);
        if (!("error" in again)) {
          data = again as CheckoutData;
          setFinalSession(true);
        }
      }
      setCheckoutData(data);
    } catch {
      toast.error("Failed to load checkout data");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [onClose]);

  useEffect(() => {
    if (appointmentId) {
      fetchData(appointmentId);
    } else {
      setCheckoutData(null);
      setSelectedMethod(null);
      setCompletedAmount(null);
      setReceiptDone(false);
    }
  }, [appointmentId, fetchData]);

  /** Asks the server to price the visit with or without the project's deposit credit. */
  async function onToggleFinal(checked: boolean) {
    if (!appointmentId) return;
    const seq = ++recomputeSeq.current;
    setFinalSession(checked);
    setRecomputing(true);
    try {
      const result = await getCheckoutData(appointmentId, checked);
      if (seq !== recomputeSeq.current) return; // a newer toggle owns the screen
      if ("error" in result) {
        toast.error(result.error);
        setFinalSession(!checked);
      } else {
        setCheckoutData(result as CheckoutData);
      }
    } catch {
      if (seq !== recomputeSeq.current) return;
      toast.error("Failed to load checkout data");
      setFinalSession(!checked);
    } finally {
      if (seq === recomputeSeq.current) setRecomputing(false);
    }
  }

  async function handleComplete(stripePaymentIntentId?: string) {
    const giftPayload = giftActive && gift
      ? { code: gift.code, amountCents: gift.useCents }
      : undefined;
    const method = giftPayload && cardChargeWithTip === 0 ? "gift_card" : selectedMethod;
    if (!appointmentId || !method) return;

    setSubmitting(true);
    try {
      const result = await completeAppointment({
        appointmentId,
        paymentMethod: method,
        stripePaymentIntentId,
        tipCents,
        ...(giftPayload ? { giftCard: giftPayload } : {}),
        ...(checkoutData?.project ? { finalProjectSession: finalSession } : {}),
      });

      if (result.success) {
        toast.success(
          `Checkout complete - ${formatPrice(result.totalCents)}`,
        );
        setCompletedAmount(result.totalCents);
        setCompletedFee(
          result.platformFeeCents > 0 && result.processingRateLabel
            ? {
                feeCents: result.platformFeeCents,
                rateLabel: result.processingRateLabel,
              }
            : null,
        );
      } else {
        toast.error(result.error ?? "Checkout failed");
      }
    } catch {
      toast.error("Checkout failed unexpectedly");
    } finally {
      setSubmitting(false);
    }
  }

  /** "Use a credit": spend one on this visit, then reload the amounts (they drop to the tip). */
  async function handleUseCredit() {
    if (!appointmentId) return;
    setApplyingCredit(true);
    try {
      const result = await applyCreditAtCheckout(appointmentId);
      if (result.success) {
        toast.success(tpk("creditUsed"));
        await fetchData(appointmentId);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Could not use a credit");
    } finally {
      setApplyingCredit(false);
    }
  }

  async function handleDirectSubmit() {
    if (selectedMethod === "new_card") return; // handled by NewCardForm
    await handleComplete();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Checkout{checkoutData ? ` - ${checkoutData.client.name}` : ""}
          </DialogTitle>
        </DialogHeader>

        {completedAmount !== null && checkoutData ? (
          <div className="space-y-4 text-center py-4">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
            <div>
              <h3 className="text-lg font-semibold">Checkout Complete</h3>
              <p className="text-muted-foreground mt-1">
                {formatPrice(completedAmount)} charged
              </p>
            </div>
            {completedFee && (
              <ProcessingFeeSummary
                amountCents={completedAmount}
                feeCents={completedFee.feeCents}
                rateLabel={completedFee.rateLabel}
              />
            )}
            {!receiptDone && (
              <>
                <Separator />
                <div className="text-left space-y-3">
                  <p className="text-sm font-medium">Send receipt to client?</p>
                  <p className="text-xs text-muted-foreground">
                    {checkoutData.client.email
                      ? `Email: ${checkoutData.client.email}`
                      : "No email on file"}
                    <br />
                    {checkoutData.client.phone
                      ? `Phone: ${checkoutData.client.phone}`
                      : "No phone on file"}
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={
                        receiptSending || !checkoutData.client.email
                      }
                      onClick={async () => {
                        setReceiptSending(true);
                        const r = await sendReceipt({
                          appointmentId: checkoutData.appointment.id,
                          channel: "email",
                        });
                        setReceiptSending(false);
                        if (r.success) {
                          toast.success("Receipt emailed");
                          setReceiptDone(true);
                        } else {
                          toast.error(r.error ?? "Could not send receipt");
                        }
                      }}
                    >
                      Email receipt
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={
                        receiptSending || !checkoutData.client.phone
                      }
                      onClick={async () => {
                        setReceiptSending(true);
                        const r = await sendReceipt({
                          appointmentId: checkoutData.appointment.id,
                          channel: "sms",
                        });
                        setReceiptSending(false);
                        if (r.success) {
                          toast.success("Receipt sent by text");
                          setReceiptDone(true);
                        } else {
                          toast.error(r.error ?? "Could not send receipt");
                        }
                      }}
                    >
                      Text receipt
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full"
                      disabled={receiptSending}
                      onClick={() => setReceiptDone(true)}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              </>
            )}
            <Separator />
            <RebookPrompt clientId={checkoutData.client.id} />
            <Button
              variant="outline"
              className="w-full"
              onClick={onComplete}
            >
              Close
            </Button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : checkoutData ? (
          <div className="space-y-4">
            {checkoutData.group && (
              <p className="border border-[var(--line)] bg-[var(--ivory-raised)] px-3 py-2 text-sm">
                {ts("checkout.groupBanner", { count: checkoutData.group.count })}
              </p>
            )}
            {checkoutData.project && (
              <div className="space-y-2 border border-[var(--line)] bg-[var(--ivory-raised)] px-3 py-3">
                <div className="flex min-h-11 items-start gap-3">
                  <Checkbox
                    id="final-project-session"
                    className="mt-1 size-5"
                    checked={finalSession}
                    disabled={submitting || recomputing}
                    onCheckedChange={(v) => void onToggleFinal(v === true)}
                  />
                  <Label htmlFor="final-project-session" className="text-sm font-medium leading-snug">
                    {ts("checkout.finalSession", {
                      amount: formatPrice(checkoutData.project.depositCreditCents),
                    })}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  {ts("checkout.creditLeft", {
                    amount: formatPrice(
                      Math.max(0, checkoutData.project.depositCreditCents - checkoutData.depositAppliedCents),
                    ),
                  })}
                </p>
              </div>
            )}
            {checkoutData.creditCovered && (
              <p className="border border-[var(--line)] bg-[var(--ivory-raised)] px-3 py-2 text-sm font-medium">
                {tpk("paidWithCredit")}
              </p>
            )}
            {checkoutData.creditEligible && !checkoutData.creditCovered && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full"
                disabled={applyingCredit || submitting}
                onClick={handleUseCredit}
              >
                {applyingCredit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tpk("useAtCheckout")}
              </Button>
            )}
            {/* Service summary */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Services</h4>
              {checkoutData.services.map((svc, i) => (
                <div
                  key={`${svc.serviceId}-${i}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{svc.serviceName}</span>
                  <span className="text-muted-foreground">
                    {formatPrice(svc.priceCents)}
                  </span>
                </div>
              ))}
              <Separator />
              {!checkoutData.creditCovered &&
                selectedMethod === "beauty_bank" &&
                checkoutData.memberDiscountPercent > 0 &&
                checkoutData.fullBbDiscountedTotalCents <
                  checkoutData.totalCents && (
                  <div className="flex items-center justify-between text-sm text-primary">
                    <span>
                      Member discount ({checkoutData.memberDiscountPercent}%)
                    </span>
                    <span>
                      -
                      {formatPrice(
                        checkoutData.totalCents -
                          checkoutData.fullBbDiscountedTotalCents,
                      )}
                    </span>
                  </div>
                )}
              {checkoutData.storedValueBalanceCents > 0 && !checkoutData.creditCovered && (
                <div className="flex items-center justify-between text-sm text-primary">
                  <span>
                    {selectedMethod === "beauty_bank"
                      ? t("checkoutDialog.fullPay")
                      : t("checkoutDialog.partial")}
                  </span>
                  <span>
                    -
                    {formatPrice(
                      selectedMethod === "beauty_bank"
                        ? checkoutData.fullBbDiscountedTotalCents
                        : checkoutData.storedValueAppliedCents,
                    )}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between font-bold text-sm">
                <span>Services total</span>
                <span>
                  {formatPrice(
                    checkoutData.creditCovered
                      ? 0
                      : selectedMethod === "beauty_bank"
                        ? checkoutData.fullBbDiscountedTotalCents
                        : checkoutData.totalCents,
                  )}
                </span>
              </div>
              {tipCents > 0 && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Tip</span>
                  <span>{formatPrice(tipCents)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm font-semibold pt-1 border-t border-border/60">
                <span>Total</span>
                <span>
                  {formatPrice(
                    checkoutData.creditCovered
                      ? (amounts?.totalWithTip ?? tipCents)
                      : (selectedMethod === "beauty_bank"
                          ? checkoutData.fullBbDiscountedTotalCents
                          : checkoutData.totalCents) + tipCents,
                  )}
                </span>
              </div>
              {checkoutData.depositAppliedCents > 0 && !checkoutData.creditCovered && (
                <div className="flex items-center justify-between text-sm text-primary">
                  <span>{ts("checkout.depositApplied")}</span>
                  <span>-{formatPrice(checkoutData.depositAppliedCents)}</span>
                </div>
              )}
              {giftActive && gift && (amounts?.giftAppliedCents ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm text-primary">
                  <span>{tg("checkout.line", { last4: gift.last4 })}</span>
                  <span>-{formatPrice(amounts?.giftAppliedCents ?? 0)}</span>
                </div>
              )}
              {giftActive && (
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{tg("checkout.leftToPay")}</span>
                  <span>{formatPrice(cardChargeWithTip)}</span>
                </div>
              )}
              {cardChargeWithTip > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Card / cash due</span>
                  <span>{formatPrice(cardChargeWithTip)}</span>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-sm font-medium">Tip (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Based on services total ({formatPrice(checkoutData.totalCents)}
                ).
              </p>
              <div className="flex flex-wrap gap-2">
                {([18, 20, 25] as const).map((pct) => {
                  const cents = percentTipCents(checkoutData.totalCents, pct);
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
                <Label htmlFor="tip-custom" className="text-xs">
                  Custom ($)
                </Label>
                <Input
                  id="tip-custom"
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

            {checkoutData.giftCardsEnabled && selectedMethod !== "beauty_bank" && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{tg("checkout.title")}</h4>
                {gift ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      {tg("checkout.available", {
                        last4: gift.last4,
                        amount: formatPrice(gift.balanceCents),
                      })}
                    </p>
                    <Label htmlFor="gift-use">{tg("checkout.use")}</Label>
                    <Input
                      id="gift-use"
                      inputMode="decimal"
                      value={(gift.useCents / 100).toFixed(2)}
                      onChange={(e) => {
                        const n = Number.parseFloat(e.target.value);
                        const cents = Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
                        setGift({ ...gift, useCents: Math.min(cents, gift.balanceCents) });
                      }}
                      disabled={submitting}
                    />
                    <Button type="button" variant="outline" onClick={() => setGift(null)} disabled={submitting}>
                      {tg("checkout.remove")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="gift-code">{tg("checkout.code")}</Label>
                    <Input
                      id="gift-code"
                      autoComplete="off"
                      autoCapitalize="characters"
                      value={giftCode}
                      onChange={(e) => setGiftCode(e.target.value)}
                      disabled={submitting}
                    />
                    {giftError && <p role="alert" className="text-sm text-destructive">{giftError}</p>}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting || giftCode.trim() === ""}
                      onClick={async () => {
                        setGiftError(null);
                        const found = await lookupGiftCardForCheckout(giftCode);
                        if (!found.success) {
                          setGiftError(found.error);
                          return;
                        }
                        const due = computeCheckoutAmounts({
                          payingFullFromPrepaid: false,
                          totalCents: checkoutData.totalCents,
                          tipCents,
                          partialBankAppliedCents: checkoutData.storedValueAppliedCents,
                          discountedTotalCents: checkoutData.fullBbDiscountedTotalCents,
                          depositAppliedCents: checkoutData.depositAppliedCents,
                          creditCovered: checkoutData.creditCovered,
                        }).remainderCents;
                        setGift({
                          code: giftCode,
                          last4: found.last4,
                          balanceCents: found.balanceCents,
                          useCents: Math.min(found.balanceCents, due),
                        });
                      }}
                    >
                      {tg("checkout.apply")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Payment method selection. A gift card that covers the bill replaces it. */}
            {giftActive && cardChargeWithTip === 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{tg("checkout.paidByGiftCard")}</p>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleComplete()}
                  disabled={submitting || recomputing}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Complete Checkout"
                  )}
                </Button>
              </div>
            ) : (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Payment Method</h4>
              <PaymentSelector
                hasCardOnFile={checkoutData.client.hasCardOnFile}
                selectedMethod={selectedMethod}
                onSelect={(method) => {
                  if (method === "beauty_bank") setGift(null);
                  setSelectedMethod(method);
                }}
                disabled={submitting}
                eligibleForFullBb={checkoutData.eligibleForFullBb && !checkoutData.creditCovered}
                tipCents={tipCents}
                memberDiscountPercent={checkoutData.memberDiscountPercent}
              />
            </div>
            )}

            {/* New card Stripe Elements */}
            {selectedMethod === "new_card" && cardChargeWithTip > 0 && !recomputing && (
              <Elements
                key={`pay-${tipCents}-${cardChargeWithTip}-${gift?.useCents ?? 0}`}
                stripe={stripePromise}
                options={{
                  mode: "payment",
                  amount: cardChargeWithTip,
                  currency: "usd",
                }}
              >
                <NewCardForm
                  appointmentId={checkoutData.appointment.id}
                  cardChargeCents={cardChargeWithTip}
                  tipCents={tipCents}
                  finalProjectSession={finalSession}
                  giftCard={
                    giftActive && gift
                      ? { code: gift.code, amountCents: gift.useCents }
                      : undefined
                  }
                  onSuccess={(paymentIntentId) =>
                    handleComplete(paymentIntentId)
                  }
                  onError={(msg) => toast.error(msg)}
                />
              </Elements>
            )}

            {/* Submit button for card_on_file, cash, or beauty_bank */}
            {selectedMethod &&
              selectedMethod !== "new_card" && (
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleDirectSubmit}
                  disabled={submitting || recomputing}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : selectedMethod === "beauty_bank" ? (
                    t("checkoutDialog.completeWithPrepaid", {
                      amount: formatPrice(
                        checkoutData.fullBbDiscountedTotalCents,
                      ),
                    })
                  ) : (
                    "Complete Checkout"
                  )}
                </Button>
              )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
