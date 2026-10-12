"use client";

import { useT } from "@/lib/terms/client";
import { useEffect, useState } from "react";
import { format, addMinutes } from "date-fns";
import { TZDate } from "@date-fns/tz";
import {
  confirmBooking,
  getAgeGateForServices,
  getCreditOption,
  recheckPublicSlot,
} from "@/actions/booking-public";
import { getStoredValuePreviewForClient } from "@/actions/membership";
import { previewBookingDeposit, chargeBookingDeposit } from "@/actions/deposits";
import { MembershipUpsell } from "@/components/booking-public/membership-upsell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe/client";
import {
  Loader2Icon,
  UserIcon,
  ScissorsIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  Wallet,
  CreditCardIcon,
  ShieldCheckIcon,
} from "lucide-react";

interface BookingResult {
  id: string;
  staffName: string;
  services: { name: string; durationMinutes: number }[];
  start: string;
  end: string;
  totalDuration: number;
  locationName?: string | null;
  locationAddress?: string | null;
  depositCents?: number;
  depositCharged?: boolean;
}

function SetupForm({
  onComplete,
  appointmentId,
  depositCents,
  submitLabel,
}: {
  onComplete: () => void;
  appointmentId?: string;
  depositCents: number;
  submitLabel?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      clientSecret,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (confirmError) {
      setError(confirmError.message ?? "Card setup failed. Please try again.");
      setLoading(false);
      return;
    }
    if (appointmentId && depositCents > 0) {
      try {
        await chargeBookingDeposit(appointmentId);
      } catch (err) {
        if (err instanceof Error && err.name === "AuthError") throw err;
      }
    }
    onComplete();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!stripe || loading} className="w-full" variant="default">
        {loading ? (
          <>
            <Loader2Icon className="mr-2 size-4 animate-spin" />
            {depositCents > 0 ? "Processing..." : "Saving card..."}
          </>
        ) : (
          <>
            <CreditCardIcon className="mr-2 size-4" />
            {depositCents > 0
              ? `Save Card & Pay $${(depositCents / 100).toFixed(2)} Deposit`
              : (submitLabel ?? "Save Card & Complete Booking")}
          </>
        )}
      </Button>
      <div className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <ShieldCheckIcon className="size-4" />
        <span>Your card is securely saved by Stripe. We never see your full card number.</span>
      </div>
    </form>
  );
}

interface PaymentStepProps {
  onComplete: () => void;
  appointmentId?: string;
  depositCents?: number;
  submitLabel?: string;
}

export function PaymentStep({ onComplete, appointmentId, depositCents = 0, submitLabel }: PaymentStepProps) {
  const t = useT("booking");
  return (
    <div className="space-y-6">
      <h2 className="display text-3xl text-[var(--ink)]">Save card on file</h2>
      <p className="text-sm text-[var(--ink-soft)]">
        {depositCents > 0
          ? `A card on file is required, and a $${(depositCents / 100).toFixed(2)} deposit is collected now to reserve your appointment. The deposit is applied to your final total.`
          : t("paymentStep.cardRequired")}
      </p>
      <Elements
        stripe={stripePromise}
        options={{
          mode: "setup",
          currency: "usd",
          appearance: { theme: "stripe" },
        }}
      >
        <SetupForm
          onComplete={onComplete}
          appointmentId={appointmentId}
          depositCents={depositCents}
          submitLabel={submitLabel}
        />
      </Elements>
    </div>
  );
}

interface ConfirmPayStepProps {
  salonId: string;
  salonSlug: string;
  salonName: string;
  salonTimezone: string;
  staffId: string;
  staffName: string;
  anyStaff?: boolean;
  serviceIds: string[];
  serviceSummary: string;
  totalDuration: number;
  clientId: string;
  clientPhone?: string;
  locationId?: string;
  serviceAddressId?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  selectedDate: string;
  selectedTime: string;
  isDoubleBook?: boolean;
  doubleBookParentAppointmentId?: string | null;
  hasCardOnFile: boolean;
  requireCardOnFile: boolean;
  onConfirm: (booking: BookingResult) => void;
  onCardSaved: () => void;
  onSlotMismatch: () => void;
  onJustTaken: () => void;
}

export function ConfirmPayStep({
  salonId,
  salonSlug,
  salonName,
  salonTimezone,
  staffId,
  staffName,
  anyStaff,
  serviceIds,
  serviceSummary,
  totalDuration,
  clientId,
  clientPhone,
  locationId,
  serviceAddressId,
  locationName,
  locationAddress,
  selectedTime,
  isDoubleBook,
  doubleBookParentAppointmentId,
  hasCardOnFile,
  requireCardOnFile,
  onConfirm,
  onCardSaved,
  onSlotMismatch,
  onJustTaken,
}: ConfirmPayStepProps) {
  const t = useT("booking");
  const tc = useT("consent");
  const tpk = useT("packages");
  const [ageGate, setAgeGate] = useState<{ minAge: number } | null>(null);
  const [dob, setDob] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [storedValueCents, setStoredValueCents] = useState<number | null>(null);
  const [depositCents, setDepositCents] = useState(0);
  const [creditOption, setCreditOption] = useState<{ name: string; remaining: number } | null>(null);
  const [useCredit, setUseCredit] = useState(true);
  const [pending, setPending] = useState<BookingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStoredValuePreviewForClient(clientId)
      .then((preview) => {
        if (!cancelled) setStoredValueCents(preview.balanceCents);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AuthError") throw err;
        if (!cancelled) setStoredValueCents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    getAgeGateForServices(serviceIds)
      .then((res) => {
        if (!cancelled) setAgeGate(res.gate && !res.birthdayKnown ? { minAge: res.gate.minAge } : null);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AuthError") throw err;
        if (!cancelled) setAgeGate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceIds]);

  useEffect(() => {
    let cancelled = false;
    getCreditOption(serviceIds)
      .then((option) => {
        if (!cancelled) setCreditOption(option);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AuthError") throw err;
        if (!cancelled) setCreditOption(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceIds, clientId]);

  useEffect(() => {
    let cancelled = false;
    previewBookingDeposit(serviceIds, clientId, staffId)
      .then((preview) => {
        if (!cancelled) setDepositCents(preview.enabled ? preview.totalCents : 0);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AuthError") throw err;
        if (!cancelled) setDepositCents(0);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceIds, clientId, staffId]);

  const startDate = new TZDate(new Date(selectedTime), salonTimezone);
  const endDate = new TZDate(addMinutes(new Date(selectedTime), totalDuration), salonTimezone);
  const formattedDate = format(startDate, "EEEE, MMMM d, yyyy");
  const formattedStartTime = format(startDate, "h:mm a");
  const formattedEndTime = format(endDate, "h:mm a");
  const serviceNames = serviceSummary.split(" + ");

  const finish = (booking: BookingResult) => {
    onConfirm(booking);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const recheck = await recheckPublicSlot({
        staffId,
        serviceIds,
        locationId: locationId ?? null,
        serviceAddressId: serviceAddressId ?? null,
        startTime: selectedTime,
        quotedMinutes: totalDuration,
      });
      if (!recheck.ok) {
        onSlotMismatch();
        return;
      }
      const result = await confirmBooking({
        salonId,
        staffId,
        clientId,
        serviceIds,
        startTime: selectedTime,
        locationId,
        serviceAddressId: serviceAddressId ?? null,
        isDoubleBook,
        doubleBookParentAppointmentId,
        anyStaff,
        smsOptIn: smsOptIn && !!clientPhone,
        clientPhone,
        ...(ageGate && dob ? { dob } : {}),
        ...(creditOption && useCredit ? { useCredit: true } : {}),
      });
      if (!result.success) {
        const errorMsg = result.error ?? "Failed to create booking";
        if (errorMsg.includes("just taken") || errorMsg.includes("conflict")) {
          toast.error(errorMsg);
          onJustTaken();
        } else {
          toast.error(errorMsg);
          setConfirming(false);
        }
        return;
      }
      const booking: BookingResult =
        "booking" in result && result.booking && "staffName" in result.booking
          ? (result.booking as BookingResult)
          : {
              id: "booking" in result && result.booking ? result.booking.id : "",
              staffName,
              services: serviceNames.map((name) => ({
                name,
                durationMinutes: Math.round(totalDuration / Math.max(serviceNames.length, 1)),
              })),
              start: selectedTime,
              end: endDate.toISOString(),
              totalDuration,
              locationName,
              locationAddress,
            };
      if (requireCardOnFile && !hasCardOnFile) {
        setPending(booking);
        setConfirming(false);
        return;
      }
      finish(booking);
    } catch (err) {
      if (err instanceof Error && err.name === "AuthError") throw err;
      toast.error("Something went wrong. Please try again.");
      setConfirming(false);
    }
  };

  if (pending) {
    return (
      <PaymentStep
        appointmentId={pending.id}
        depositCents={pending.depositCents ?? depositCents}
        onComplete={() => {
          onCardSaved();
          finish(pending);
        }}
      />
    );
  }

  return (
    <div className="space-y-6 pb-32 sm:pb-0">
      <h2 className="display text-3xl text-[var(--ink)]">{t("confirmPay.title")}</h2>

      {storedValueCents != null && storedValueCents > 0 && (
        <div className="flex items-center gap-2 border border-[var(--line)] bg-[var(--ivory-raised)] px-4 py-3 text-sm">
          <Wallet className="size-4 shrink-0 text-[var(--ink-soft)]" />
          <span>
            {t("confirmStep.prepaidBalance")} <strong>${(storedValueCents / 100).toFixed(2)}</strong> — applied when
            you pay after your visit.
          </span>
        </div>
      )}

      {depositCents > 0 && !(creditOption && useCredit) && (
        <div className="flex items-center gap-2 border border-[var(--ink)] bg-[var(--ivory-raised)] px-4 py-3 text-sm">
          <Wallet className="size-4 shrink-0 text-[var(--ink)]" />
          <span>
            A deposit of <strong>${(depositCents / 100).toFixed(2)}</strong> is collected to reserve this appointment,
            and applied to your final total.
          </span>
        </div>
      )}

      <div className="border border-[var(--line)] bg-[var(--ivory-raised)]">
        <div className="divide-y">
          <div className="flex items-center gap-3 px-4 py-3">
            <UserIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t("confirmStep.staffLabel")}</p>
              <p className="text-sm font-medium">{anyStaff ? t("confirmStep.withStaff", { name: staffName }) : staffName}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <ScissorsIcon className="mt-0.5 size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t("confirmPay.services")}</p>
              {serviceNames.map((name, i) => (
                <p key={i} className="text-sm font-medium">
                  {name}
                </p>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <CalendarIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t("confirmPay.date")}</p>
              <p className="text-sm font-medium">{formattedDate}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <ClockIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t("confirmPay.time")}</p>
              <p className="text-sm font-medium">
                {formattedStartTime} – {formattedEndTime}
              </p>
            </div>
          </div>
          {(locationName || locationAddress) && (
            <div className="flex items-start gap-3 px-4 py-3">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-[var(--ink-soft)]" />
              <div>
                <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t("confirmPay.location")}</p>
                {locationName && <p className="text-sm font-medium">{locationName}</p>}
                {locationAddress && <p className="text-sm text-[var(--ink-soft)]">{locationAddress}</p>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-3">
            <ClockIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t("confirmPay.duration")}</p>
              <p className="text-sm font-medium">{t("confirmPay.minutes", { minutes: totalDuration })}</p>
            </div>
          </div>
        </div>
      </div>

      {creditOption && (
        <div className="flex items-start gap-3 border border-[var(--line)] p-4">
          <Checkbox
            id="use-credit"
            checked={useCredit}
            onCheckedChange={(checked) => setUseCredit(checked === true)}
          />
          <label htmlFor="use-credit" className="cursor-pointer text-sm leading-snug">
            {tpk("useCredit", { name: creditOption.name, remaining: creditOption.remaining })}
          </label>
        </div>
      )}

      {ageGate && (
        <div className="space-y-2 border border-[var(--line)] p-4">
          <Label htmlFor="booking-dob">{tc("dob")}</Label>
          <Input
            id="booking-dob"
            type="date"
            aria-label={tc("dob")}
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            autoComplete="bday"
            className="min-h-11"
          />
          <p className="text-sm text-[var(--ink-soft)]">{tc("dobHint", { minAge: ageGate.minAge })}</p>
        </div>
      )}

      {clientPhone && (
        <div className="flex items-start gap-3 border border-[var(--line)] p-4">
          <Checkbox id="sms-opt-in" checked={smsOptIn} onCheckedChange={(checked) => setSmsOptIn(checked === true)} />
          <label htmlFor="sms-opt-in" className="cursor-pointer text-sm leading-tight">
            I agree to receive appointment reminders, confirmations, and cancellation notifications via SMS from{" "}
            {salonName} at the number provided ({clientPhone}).
            <span className="mt-1 block text-[13px] text-[var(--ink-soft)]">
              Message frequency varies (typically 2–4 messages per appointment). Message and data rates may apply.
              Reply STOP to opt out or HELP for help at any time. See our{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
                Privacy Policy
              </a>{" "}
              and{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
                Terms of Service
              </a>
              .
            </span>
          </label>
        </div>
      )}

      <MembershipUpsell salonSlug={salonSlug} clientId={clientId} variant="inline" />

      <div className="sticky bottom-[var(--app-tab-bar-offset,0px)] z-20 -mx-4 border-t border-[var(--line)] bg-[var(--ivory)] px-4 pb-[var(--app-footer-safe-pad,env(safe-area-inset-bottom))] pt-3 sm:static sm:-mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <Button onClick={handleConfirm} disabled={confirming} className="w-full" variant="default">
          {confirming ? (
            <>
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              {t("confirmPay.working")}
            </>
          ) : (
            t("confirmPay.confirm")
          )}
        </Button>
      </div>
    </div>
  );
}
