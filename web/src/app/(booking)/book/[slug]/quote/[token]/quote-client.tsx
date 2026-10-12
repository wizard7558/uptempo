"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentStep } from "@/components/booking-public/confirm-pay-step";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";
import {
  acceptQuote,
  declineQuote,
  getQuoteDays,
  getQuoteSlots,
  type AcceptQuoteResult,
  type QuotePageData,
  type QuoteSlot,
} from "@/actions/quotes-public";

const PARTS = ["morning", "afternoon", "evening"] as const;
type Booked = { dateLabel: string; timeLabel: string; staffName: string | null };

export function QuoteClient({ token, data }: { token: string; data: QuotePageData }) {
  const t = useT("booking");
  const business = data.businessName;
  const [done, setDone] = useState<
    | null
    | { kind: "booked"; booked: Booked; depositCents: number; depositPaid: boolean }
    | { kind: "card"; appointmentId: string; depositCents: number; booked: Booked }
    | { kind: "declined" }
  >(null);

  if (data.state !== "open" || !data.quote) {
    const key = {
      expired: "expired",
      accepted: "alreadyAccepted",
      declined: "declined",
      withdrawn: "withdrawn",
      unavailable: "unavailable",
      open: "unavailable",
    }[data.state];
    return (
      <div className="space-y-4 text-center">
        <p className="text-base text-[var(--ink)]">{t(`quotePage.${key}`, { business })}</p>
        {data.state === "accepted" && data.booked && (
          <p className="text-sm text-[var(--ink-soft)]">
            {t("quotePage.bookedFor", {
              date: data.booked.dateLabel,
              time: data.booked.timeLabel,
              name: data.booked.staffName ?? business,
            })}
          </p>
        )}
      </div>
    );
  }

  if (done?.kind === "declined") {
    return <p className="text-center text-base text-[var(--ink)]">{t("quotePage.declinedDone")}</p>;
  }
  if (done?.kind === "card") {
    return (
      <PaymentStep
        appointmentId={done.appointmentId}
        depositCents={done.depositCents}
        onComplete={() =>
          setDone({ kind: "booked", booked: done.booked, depositCents: done.depositCents, depositPaid: true })
        }
      />
    );
  }
  if (done?.kind === "booked") {
    return (
      <div className="space-y-3 text-center">
        <h2 className="display text-3xl text-[var(--ink)]">{t("quotePage.bookedTitle")}</h2>
        <p className="text-base text-[var(--ink)]">
          {t("quotePage.bookedFor", {
            date: done.booked.dateLabel,
            time: done.booked.timeLabel,
            name: done.booked.staffName ?? business,
          })}
        </p>
        {done.depositCents > 0 &&
          (done.depositPaid ? (
            <p className="text-sm font-medium text-[var(--ink)]">{t("quotePage.depositPaid")}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-[var(--ink)]">{t("quotePage.depositDue")}</p>
              <p className="text-sm text-[var(--ink-soft)]">{t("quotePage.depositRetry", { business })}</p>
            </>
          ))}
      </div>
    );
  }

  return (
    <OpenQuote
      token={token}
      data={data}
      quote={data.quote}
      onAccepted={(r) =>
        setDone(
          r.needsCard
            ? { kind: "card", appointmentId: r.appointmentId, depositCents: r.depositCents, booked: r.booked }
            : { kind: "booked", booked: r.booked, depositCents: r.depositCents, depositPaid: r.depositPaid },
        )
      }
      onDeclined={() => setDone({ kind: "declined" })}
    />
  );
}

type OpenData = NonNullable<QuotePageData["quote"]>;

function OpenQuote({
  token,
  data,
  quote,
  onAccepted,
  onDeclined,
}: {
  token: string;
  data: QuotePageData;
  quote: OpenData;
  onAccepted: (r: Extract<AcceptQuoteResult, { success: true }>) => void;
  onDeclined: () => void;
}) {
  const t = useT("booking");
  const tc = useT("consent");
  const business = data.businessName;
  const [dob, setDob] = useState("");
  const [days, setDays] = useState<string[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<QuoteSlot[] | null>(null);
  const [slot, setSlot] = useState<QuoteSlot | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const anyStaff = quote.staffId == null;
  const deposit = quote.depositCents;

  useEffect(() => {
    let live = true;
    getQuoteDays(token).then((d) => live && setDays(d));
    return () => {
      live = false;
    };
  }, [token]);

  const dayChosen = (d: string) => {
    setDay(d);
    setSlot(null);
    setSlots(null);
    getQuoteSlots(token, d).then(setSlots);
  };

  const enabled = useMemo(() => new Set(days ?? []), [days]);
  const grouped = useMemo(
    () => PARTS.map((part) => ({ part, items: (slots ?? []).filter((s) => s.part === part) })),
    [slots],
  );

  const submit = async () => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const r = await acceptQuote({
        token,
        start: slot.time,
        staffId: slot.staffId,
        acceptedName: name,
        agree,
        ...(data.ageGate && dob ? { dob } : {}),
      });
      if (r.success) return onAccepted(r);
      setError(r.error);
      // The time may be gone: refresh the day's list.
      if (day) getQuoteSlots(token, day).then(setSlots);
      setSlot(null);
    } catch {
      setError(t("quotePage.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      const r = await declineQuote(token);
      if (r.success) onDeclined();
      else setError(t("quotePage.genericError"));
    } finally {
      setBusy(false);
      setConfirmDecline(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="display text-3xl text-[var(--ink)]">{t("quotePage.title", { business })}</h1>
        <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {data.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-3 text-sm">
              <span className="text-[var(--ink)]">
                {l.description}
                {l.quantity > 1 && <span className="ml-2 text-[var(--ink-soft)]">x{l.quantity}</span>}
              </span>
              <span className="tabular-nums">{formatCurrency(l.quantity * l.unitCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>{t("quotePage.total")}</dt>
            <dd className="font-semibold tabular-nums">{formatCurrency(quote.subtotalCents)}</dd>
          </div>
          {deposit > 0 && (
            <div className="flex justify-between">
              <dt>{t("quotePage.depositToday")}</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(deposit)}</dd>
            </div>
          )}
        </dl>
        {quote.validUntilLabel && (
          <p className="text-sm text-[var(--ink-soft)]">{t("quotePage.goodUntil", { date: quote.validUntilLabel })}</p>
        )}
        {quote.message && (
          <blockquote className="border-l-2 border-[var(--line)] pl-4 text-sm text-[var(--ink)]">
            <p className="mb-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">
              {t("quotePage.noteLabel", { business })}
            </p>
            {quote.message}
          </blockquote>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="display text-2xl text-[var(--ink)]">{t("quotePage.chooseTime")}</h2>
        {days === null ? (
          <p className="text-sm text-[var(--ink-soft)]">{t("quotePage.loadingTimes")}</p>
        ) : (
          <Calendar
            mode="single"
            showOutsideDays={false}
            selected={day ? parseISO(day) : undefined}
            defaultMonth={days[0] ? parseISO(days[0]) : undefined}
            onDayClick={(d) => {
              const key = format(d, "yyyy-MM-dd");
              if (enabled.has(key)) dayChosen(key);
            }}
            disabled={(d) => !enabled.has(format(d, "yyyy-MM-dd"))}
            components={{
              DayButton: (props) => (
                <CalendarDayButton {...props} data-booking-date={format(props.day.date, "yyyy-MM-dd")} />
              ),
            }}
            className="p-0 [--cell-size:--spacing(11)]"
          />
        )}
        {!day && days !== null && <p className="text-sm text-[var(--ink-soft)]">{t("quotePage.pickDay")}</p>}
        {day && slots === null && <p className="text-sm text-[var(--ink-soft)]">{t("quotePage.loadingTimes")}</p>}
        {day && slots !== null && slots.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)]">{t("quotePage.noTimes")}</p>
        )}
        {grouped.map(
          ({ part, items }) =>
            items.length > 0 && (
              <div key={part} className="space-y-2">
                <h3 className="text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">{t(`quotePage.${part}`)}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((s) => (
                    <Button
                      key={`${s.time}-${s.staffId}`}
                      type="button"
                      variant={slot?.time === s.time && slot.staffId === s.staffId ? "default" : "outline"}
                      className="min-h-11"
                      data-slot-time={s.time}
                      aria-pressed={slot?.time === s.time && slot.staffId === s.staffId}
                      onClick={() => setSlot(s)}
                    >
                      {anyStaff && s.staffName
                        ? t("quotePage.withStaff", { time: s.label, name: s.staffName })
                        : s.label}
                    </Button>
                  ))}
                </div>
              </div>
            ),
        )}
      </section>

      {slot && (
        <section className="space-y-4">
          <h2 className="display text-2xl text-[var(--ink)]">{t("quotePage.accept")}</h2>
          {slot.arrival && (
            <p className="text-sm text-[var(--ink)]">
              {t("quotePage.arrival", { start: slot.arrival.startLabel, end: slot.arrival.endLabel })}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="accepted-name">{t("quotePage.typeName")}</Label>
            <Input
              id="accepted-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="min-h-11"
            />
          </div>
          {data.ageGate && (
            <div className="space-y-2">
              <Label htmlFor="accepted-dob">{tc("dob")}</Label>
              <Input
                id="accepted-dob"
                type="date"
                aria-label={tc("dob")}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                autoComplete="bday"
                className="min-h-11"
              />
              <p className="text-sm text-[var(--ink-soft)]">{tc("dobHint", { minAge: data.ageGate.minAge })}</p>
            </div>
          )}
          <div className="flex items-start gap-3">
            <Checkbox id="accept-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} />
            <Label htmlFor="accept-agree" className="text-sm leading-snug">
              {deposit > 0 ? t("quotePage.agreeDeposit") : t("quotePage.agree")}
            </Label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            type="button"
            
            variant="default"
            className="w-full"
            disabled={busy || !agree || name.trim().length < 2 || (!!data.ageGate && !dob)}
            onClick={submit}
          >
            {busy
              ? t("quotePage.working")
              : deposit > 0
                ? t("quotePage.acceptPay", { deposit: formatCurrency(deposit) })
                : t("quotePage.acceptBook")}
          </Button>
        </section>
      )}
      {!slot && error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="border-t border-[var(--line)] pt-6">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirmDecline(true)}>
          {t("quotePage.noThanks")}
        </Button>
      </div>
      <Dialog open={confirmDecline} onOpenChange={setConfirmDecline}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("quotePage.declineTitle")}</DialogTitle>
            <DialogDescription>{t("quotePage.declineBody", { business })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirmDecline(false)}>
              {t("quotePage.goBack")}
            </Button>
            <Button type="button" className="min-h-11" disabled={busy} onClick={decline}>
              {t("quotePage.declineYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
