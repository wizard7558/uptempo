"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetailsStep } from "@/components/booking-public/details-step";
import { ProgressBar } from "@/components/booking-public/progress-bar";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";
import { addDays, localDay } from "@/lib/scheduling/intervals";
import { formatClockTime, formatDayLabel, formatTimeRange, formatWeekRange, groupByDay, weekStartOf } from "@/lib/classes/week";
import {
  bookClassSpot,
  cancelMyClassSpot,
  getClassAgeGate,
  getClassCreditOption,
  listPublicClasses,
  myClassSpots,
  type MyClassSpot,
  type PublicClass,
} from "@/actions/classes-public";

/** Every code the booking action can return, each with its own sentence under `classes.public.errors`. */
export const CLASS_ERROR_CODES = [
  "FULL",
  "CLOSED",
  "ALREADY",
  "STARTED",
  "UNDERAGE",
  "DOB_REQUIRED",
  "NOT_SIGNED_IN",
] as const;

/** The message key (under `classes`) for an error code; unknown codes get the generic sentence. */
export function classErrorKey(code: string): string {
  return (CLASS_ERROR_CODES as readonly string[]).includes(code)
    ? `public.errors.${code}`
    : "public.errors.generic";
}

/** The week the schedule opens on: the week of the soonest class, or `today` when none are listed. */
export function openingWeek(starts: string[], timezone: string, today: string): string {
  const days = starts.map((iso) => localDay(new Date(iso), timezone)).sort();
  return weekStartOf(days[0] ?? today);
}

type SpotSession = { spotsLeft: number; waitlistOpen: boolean };

export function spotPhrase(session: SpotSession): "open" | "waitlist" | "closed" {
  if (session.spotsLeft > 0) return "open";
  if (session.waitlistOpen) return "waitlist";
  return "closed";
}

export type ClassClient = { clientId: string; clientName: string };

interface Props {
  salonId: string;
  salonName: string;
  timezone: string;
  classes: PublicClass[];
  mine: MyClassSpot[];
  client: ClassClient | null;
  /** Salon-local YYYY-MM-DD, so the first week matches on the server and the client. */
  today: string;
}

type Notice = { kind: "ok" | "error"; text: string };
type FlowStep = "schedule" | "details" | "confirm";

const FRAME = ["service", "time", "details", "confirm"] as const;

/**
 * Picking a row chooses the class and its time together, so details is step 3
 * and confirm is step 4 of the shared four-step frame.
 */
function frameState(step: FlowStep): { index: number; completed: Set<string> } {
  if (step === "details") return { index: 2, completed: new Set(["service", "time"]) };
  if (step === "confirm") return { index: 3, completed: new Set(["service", "time", "details"]) };
  return { index: 0, completed: new Set() };
}

function rethrowAuthError(error: unknown): void {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AuthError") {
    throw error;
  }
}

function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function ClassSchedule({
  salonId,
  salonName,
  timezone,
  classes: initialClasses,
  mine: initialMine,
  client: initialClient,
  today,
}: Props) {
  const t = useT("classes");
  const tc = useT("consent");
  const tpk = useT("packages");
  const [classes, setClasses] = useState(initialClasses);
  const [mine, setMine] = useState(initialMine);
  const [client, setClient] = useState(initialClient);
  const [weekStart, setWeekStart] = useState(() => openingWeek(initialClasses.map((c) => c.start), timezone, today));
  const [picked, setPicked] = useState<PublicClass | null>(null);
  const [step, setStep] = useState<FlowStep>("schedule");
  const [creditOption, setCreditOption] = useState<{ name: string; remaining: number } | null>(null);
  const [useCredit, setUseCredit] = useState(true);
  const [ageGate, setAgeGate] = useState<{ minAge: number } | null>(null);
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [optionsReady, setOptionsReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, spots] = await Promise.all([listPublicClasses(), myClassSpots()]);
      setClasses(list.classes);
      setMine(spots);
    } catch (error) {
      rethrowAuthError(error);
    }
  }, []);

  useEffect(() => {
    if (step !== "confirm" || !picked || !client) return;
    let cancelled = false;
    setOptionsReady(false);
    (async () => {
      try {
        const [credit, gate] = await Promise.all([getClassCreditOption(picked.id), getClassAgeGate(picked.id)]);
        if (cancelled) return;
        setCreditOption(credit);
        setUseCredit(true);
        setAgeGate(gate);
        setOptionsReady(true);
      } catch (error) {
        rethrowAuthError(error);
        if (!cancelled) {
          setCreditOption(null);
          setAgeGate(null);
          setOptionsReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picked, client, step]);

  const whenOf = (iso: string) => {
    const start = new Date(iso);
    return { date: formatDayLabel(localDay(start, timezone)), time: formatClockTime(start, timezone) };
  };

  function showSchedule() {
    setStep("schedule");
    setPicked(null);
    setDob("");
    setCreditOption(null);
    setAgeGate(null);
    setOptionsReady(false);
  }

  function choose(id: string) {
    const session = classes.find((item) => item.id === id);
    if (!session || spotPhrase(session) === "closed") return;
    setNotice(null);
    setCreditOption(null);
    setAgeGate(null);
    setDob("");
    setUseCredit(true);
    setPicked(session);
    setStep("details");
  }

  function goToFrame(index: number) {
    if (index <= 1) showSchedule();
    else if (index === 2 && picked) {
      setOptionsReady(false);
      setStep("details");
    }
  }

  async function confirm() {
    if (!picked) return;
    setBusy(true);
    setNotice(null);
    try {
      const spendingCredit = creditOption !== null && useCredit && picked.spotsLeft > 0;
      const res = await bookClassSpot(picked.id, spendingCredit, ageGate && dob ? dob : undefined);
      if ("error" in res) {
        setNotice({ kind: "error", text: t(classErrorKey(res.error)) });
        if (res.error === "FULL" || res.error === "CLOSED" || res.error === "STARTED") {
          showSchedule();
          await refresh();
        }
        return;
      }
      const when = whenOf(picked.start);
      setNotice({
        kind: "ok",
        text:
          res.status === "booked"
            ? t("public.booked", { className: picked.className, date: when.date, time: when.time })
            : t("public.waitlisted", { n: res.position ?? 1 }),
      });
      showSchedule();
      await refresh();
    } catch (error) {
      rethrowAuthError(error);
      setNotice({ kind: "error", text: t("public.errors.generic") });
    } finally {
      setBusy(false);
    }
  }

  async function cancelSpot(enrollmentId: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await cancelMyClassSpot(enrollmentId);
      setNotice(
        res.success
          ? { kind: "ok", text: t("public.cancelled") }
          : { kind: "error", text: t(classErrorKey(res.error)) },
      );
      setCancelling(null);
      await refresh();
    } catch (error) {
      rethrowAuthError(error);
      setNotice({ kind: "error", text: t("public.errors.generic") });
    } finally {
      setBusy(false);
    }
  }

  function seats(session: SpotSession): string {
    const phrase = spotPhrase(session);
    if (phrase === "open") return t("public.spotsLeft", { count: session.spotsLeft });
    if (phrase === "waitlist") return t("public.flow.fullWaitlist");
    return t("public.waitlistFull");
  }

  const frame = frameState(step);
  const stepLabels = [
    t("public.flow.stepWeek"),
    t("public.flow.stepTime"),
    t("public.flow.stepDetails"),
    t("public.flow.stepConfirm"),
  ];

  const weekSessions = classes.flatMap((session) => {
    const start = new Date(session.start);
    const day = localDay(start, timezone);
    if (day < weekStart || day >= addDays(weekStart, 7)) return [];
    return [{ ...session, start }];
  });
  const byDay = new Map(groupByDay(weekSessions, timezone).map((group) => [group.day, group.sessions]));

  const header = (
    <div className="text-center">
      <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{salonName}</h1>
      <p className="mt-1 text-base text-[var(--ink)]">{t("public.title")}</p>
    </div>
  );

  const banner = notice && (
    <p
      role={notice.kind === "error" ? "alert" : "status"}
      className={
        notice.kind === "error"
          ? "border border-destructive p-4 text-center text-sm text-destructive"
          : "border border-[var(--line)] bg-[var(--ivory-raised)] p-4 text-center text-base text-[var(--ink)]"
      }
    >
      {notice.text}
    </p>
  );

  const progress = (
    <ProgressBar
      steps={stepLabels}
      stepKeys={[...FRAME]}
      currentStep={frame.index}
      completedSteps={frame.completed}
      onStepClick={goToFrame}
    />
  );

  const back =
    step === "schedule" ? null : (
      <button
        type="button"
        onClick={() => {
          if (step === "confirm") {
            setOptionsReady(false);
            setStep("details");
            return;
          }
          showSchedule();
        }}
        className="inline-flex min-h-11 items-center gap-1 text-[13px] text-[var(--ink)] underline"
      >
        <span aria-hidden>←</span>
        {t("public.back")}
      </button>
    );

  function shell(body: ReactNode) {
    return (
      <div className="space-y-6">
        {header}
        {progress}
        {back}
        {banner}
        {body}
      </div>
    );
  }

  if (picked && step === "details") {
    return shell(
      <div className="space-y-4">
        <p className="text-sm text-[var(--ink)]">{t("public.flow.detailsLead")}</p>
        <DetailsStep
          salonId={salonId}
          clientId={client?.clientId ?? null}
          clientName={client?.clientName ?? null}
          onComplete={(clientId, clientName) => {
            setClient({ clientId, clientName });
            setOptionsReady(false);
            setStep("confirm");
          }}
          onContinue={() => {
            setOptionsReady(false);
            setStep("confirm");
          }}
          onNotYou={() => {
            void fetch("/api/booking/clear-session", { method: "POST" });
            setClient(null);
          }}
        />
      </div>,
    );
  }

  if (picked && step === "confirm") {
    const when = whenOf(picked.start);
    const spendingCredit = creditOption !== null && useCredit && picked.spotsLeft > 0;
    return shell(
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="display text-3xl text-[var(--ink)]">{t("public.flow.confirmTitle")}</h2>
          <p className="text-sm text-[var(--ink)]">{t("public.flow.confirmLead")}</p>
        </div>
        <div className="space-y-1 border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
          <p className="text-sm text-[var(--ink)]">
            {formatTimeRange(new Date(picked.start), new Date(picked.end), timezone)}
          </p>
          <p className="display text-xl text-[var(--ink)]">{picked.className}</p>
          <p className="text-sm text-[var(--ink)]">{when.date}</p>
          <p className="text-sm text-[var(--ink)]">{t("public.flow.instructor", { name: picked.staffFirstName })}</p>
          <p className="text-sm font-medium text-[var(--ink)]">{seats(picked)}</p>
        </div>

        {optionsReady && creditOption && picked.spotsLeft > 0 && (
          <div className="flex items-center gap-3 border border-[var(--line)] p-4">
            <Checkbox
              id="class-use-credit"
              checked={useCredit}
              onCheckedChange={(checked) => setUseCredit(checked === true)}
            />
            <label htmlFor="class-use-credit" className="cursor-pointer text-sm leading-snug">
              {tpk("useCredit", { name: creditOption.name, remaining: creditOption.remaining })}
            </label>
          </div>
        )}

        {optionsReady && !spendingCredit && (
          <p className="text-base text-[var(--ink)]">
            {picked.priceCents !== null
              ? t("public.flow.payAtPlace", { price: formatCurrency(picked.priceCents) })
              : t("public.flow.payAtPlaceNoPrice")}
          </p>
        )}

        {ageGate && (
          <div className="space-y-2 border border-[var(--line)] p-4">
            <Label htmlFor="class-dob">{tc("dob")}</Label>
            <Input
              id="class-dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              autoComplete="bday"
              className="min-h-11"
            />
            <p className="text-sm text-[var(--ink-soft)]">{tc("dobHint", { minAge: ageGate.minAge })}</p>
          </div>
        )}

        <Button
          type="button"
          variant="default"
          className="h-auto min-h-11 w-full whitespace-normal"
          disabled={busy || !optionsReady}
          onClick={() => void confirm()}
        >
          {busy ? t("public.booking") : t("public.flow.confirm")}
        </Button>
      </div>,
    );
  }

  return shell(
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal px-2 text-center"
          onClick={() => setWeekStart((week) => addDays(week, -7))}
        >
          {t("prevWeek")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal px-2 text-center"
          onClick={() => setWeekStart(weekStartOf(today))}
        >
          {t("thisWeek")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal px-2 text-center"
          onClick={() => setWeekStart((week) => addDays(week, 7))}
        >
          {t("nextWeek")}
        </Button>
      </div>
      <p className="text-base text-[var(--ink)]" aria-live="polite">
        {t("weekLabel", { range: formatWeekRange(weekStart) })}
      </p>

      {classes.length === 0 ? (
        <p className="text-center text-base text-[var(--ink)]">{t("public.empty")}</p>
      ) : (
        <div className="space-y-5">
          {weekSessions.length === 0 && <p className="text-base text-[var(--ink)]">{t("public.flow.emptyWeek")}</p>}
          {weekDays(weekStart).map((day) => {
            const sessions = byDay.get(day) ?? [];
            return (
              <section key={day} className="space-y-2" aria-labelledby={`class-day-${day}`}>
                <h2 id={`class-day-${day}`} className="display text-xl text-[var(--ink)]">
                  {formatDayLabel(day)}
                </h2>
                {sessions.length > 0 && (
                  <ul className="space-y-2">
                    {sessions.map((session) => (
                      <li key={session.id}>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto min-h-11 w-full flex-col items-start justify-start gap-1 whitespace-normal px-4 py-3 text-left font-normal"
                          disabled={spotPhrase(session) === "closed"}
                          onClick={() => choose(session.id)}
                        >
                          <span className="text-sm text-[var(--ink)]">
                            {formatTimeRange(session.start, new Date(session.end), timezone)}
                          </span>
                          <span className="display text-xl text-[var(--ink)]">{session.className}</span>
                          <span className="text-sm text-[var(--ink)]">
                            {t("public.flow.instructor", { name: session.staffFirstName })}
                          </span>
                          <span className="text-sm font-medium text-[var(--ink)]">{seats(session)}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {mine.length > 0 && (
        <section className="space-y-3" aria-labelledby="my-classes-heading">
          <h2 id="my-classes-heading" className="display text-2xl text-[var(--ink)]">
            {t("public.mine")}
          </h2>
          <ul className="space-y-3">
            {mine.map((spot) => {
              const when = whenOf(spot.start);
              return (
                <li key={spot.enrollmentId} className="space-y-3 border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
                  <div>
                    <p className="display text-xl text-[var(--ink)]">{spot.className}</p>
                    <p className="text-sm text-[var(--ink)]">
                      {when.date}, {formatTimeRange(new Date(spot.start), new Date(spot.end), timezone)}
                    </p>
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {spot.status === "booked"
                        ? t("enrollment.booked")
                        : t("public.onWaitlist", { n: spot.waitlistPosition ?? 1 })}
                    </p>
                  </div>
                  {cancelling === spot.enrollmentId ? (
                    <div className="space-y-3 border border-[var(--line)] p-4">
                      <p className="text-base font-medium text-[var(--ink)]">{t("public.cancelConfirm")}</p>
                      {spot.isLate && spot.usesCredit && (
                        <p className="text-sm text-[var(--ink)]">{t("public.lateWarning", { hours: spot.windowHours })}</p>
                      )}
                      <div className="flex flex-wrap gap-3">
                        <Button type="button" disabled={busy} onClick={() => void cancelSpot(spot.enrollmentId)}>
                          {t("public.cancelNow")}
                        </Button>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => setCancelling(null)}>
                          {t("public.keepMine")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setCancelling(spot.enrollmentId)}>
                      {t("public.cancelMine")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>,
  );
}

/** "Group classes" card at the top of the book page. Never uses the word for what a business sells. */
export function ClassScheduleCard({ slug }: { slug: string }) {
  const t = useT("classes");
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-[var(--line)] bg-[var(--ivory-raised)] p-5">
      <p className="display text-xl text-[var(--ink)]">{t("public.scheduleCardTitle")}</p>
      <Link href={`/book/${slug}/classes`} className={buttonVariants({ variant: "default" })}>
        {t("public.scheduleCardButton")}
      </Link>
    </div>
  );
}
