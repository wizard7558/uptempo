"use client";

import { useState } from "react";
import { addDays, daysBetween, localDay } from "@/lib/scheduling/intervals";
import { joinSlotWaitlist } from "@/actions/slot-waitlist-public";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import type { TimeOfDay } from "@/lib/waitlist/match";

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function dateToYmd(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function WaitlistJoin({
  serviceIds,
  staffId,
  locationId,
  activeDate,
  salonTimezone,
  clientPhone,
}: {
  serviceIds: string[];
  staffId: string;
  locationId: string;
  activeDate: string | null;
  salonTimezone: string;
  clientPhone: string | null;
}) {
  const t = useT("waitlist");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("any");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openDialog(next: boolean) {
    if (next) {
      const start = activeDate ?? localDay(new Date(), salonTimezone);
      setFrom(start);
      setTo(addDays(start, 7));
      setError(null);
      setDone(false);
    }
    setOpen(next);
  }

  function chooseFrom(ymd: string) {
    setFrom(ymd);
    if (!to || daysBetween(ymd, to) < 0) setTo(addDays(ymd, 7));
    else if (daysBetween(ymd, to) > 60) setTo(addDays(ymd, 60));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await joinSlotWaitlist({
      serviceIds,
      staffId: staffId === "any" ? "any" : staffId,
      locationId: locationId || null,
      dateFrom: from,
      dateTo: to,
      timeOfDay,
      phone: clientPhone ? undefined : phone,
      smsConsent: consent,
      website,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setDone(true);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-soft)]">{t("join.hint")}</p>
      {done && <p className="text-sm">{t("join.done")}</p>}
      <Button type="button" variant="outline" className="h-12" onClick={() => openDialog(true)}>
        {t("join.button")}
      </Button>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("join.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("join.body")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("join.from")}</Label>
              <Calendar
                mode="single"
                selected={from ? ymdToDate(from) : undefined}
                onSelect={(d) => {
                  if (d) chooseFrom(dateToYmd(d));
                }}
                disabled={{ before: ymdToDate(localDay(new Date(), salonTimezone)) }}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("join.to")}</Label>
              <Calendar
                mode="single"
                selected={to ? ymdToDate(to) : undefined}
                onSelect={(d) => {
                  if (d) setTo(dateToYmd(d));
                }}
                disabled={
                  from
                    ? { before: ymdToDate(from), after: ymdToDate(addDays(from, 60)) }
                    : undefined
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("join.timeOfDay")}</Label>
            <Select value={timeOfDay} onValueChange={(v) => setTimeOfDay(v as TimeOfDay)}>
              <SelectTrigger className="h-12 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("join.any")}</SelectItem>
                <SelectItem value="morning">{t("join.morning")}</SelectItem>
                <SelectItem value="afternoon">{t("join.afternoon")}</SelectItem>
                <SelectItem value="evening">{t("join.evening")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!clientPhone && (
            <div className="space-y-1">
              <Label htmlFor="waitlist-phone">{t("join.phone")}</Label>
              <Input
                id="waitlist-phone"
                className="h-12"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="waitlist-consent"
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
            />
            <Label htmlFor="waitlist-consent">{t("join.consent")}</Label>
          </div>
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="absolute -left-[9999px]"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-12" onClick={() => setOpen(false)}>
              {t("join.cancel")}
            </Button>
            <Button type="button" className="h-12" disabled={busy} onClick={() => void submit()}>
              {t("join.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
