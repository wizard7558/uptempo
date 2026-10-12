"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import { updateBookingRules } from "@/actions/booking-rules";
import {
  SLOT_INTERVAL_OPTIONS,
  type BookingRules,
} from "@/lib/validators/booking-rules";

const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880];
const HORIZON_OPTIONS = [7, 14, 28, 60, 90, 180, 365];

export function BookingRulesClient({ initialRules }: { initialRules: BookingRules }) {
  const t = useT("settings");
  const [rules, setRules] = useState<BookingRules>(initialRules);
  const [pending, startTransition] = useTransition();

  const noticeLabel = (m: number) => {
    if (m === 0) return t("bookingRules.noNotice");
    if (m < 60) return t("bookingRules.minutes", { count: m });
    if (m < 1440) return t("bookingRules.hours", { count: m / 60 });
    return t("bookingRules.days", { count: m / 1440 });
  };
  // Keep a saved value selectable even if it is not one of the preset options.
  const withCurrent = (opts: number[], current: number) =>
    opts.includes(current) ? opts : [...opts, current].sort((a, b) => a - b);

  function save() {
    startTransition(async () => {
      const res = await updateBookingRules(rules);
      if (res.success) toast.success(t("bookingRules.saved"));
      else toast.error(t("bookingRules.saveError"));
    });
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="sameDayBooking">{t("bookingRules.sameDayLabel")}</Label>
          <Switch
            id="sameDayBooking"
            checked={rules.sameDayBooking === 1}
            onCheckedChange={(v) =>
              setRules((r) => ({ ...r, sameDayBooking: v ? 1 : 0 }))
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">{t("bookingRules.sameDayHint")}</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="minNotice">{t("bookingRules.minNoticeLabel")}</Label>
        <Select
          value={String(rules.minNoticeMinutes)}
          onValueChange={(v) => setRules((r) => ({ ...r, minNoticeMinutes: Number(v) }))}
        >
          <SelectTrigger id="minNotice" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {withCurrent(NOTICE_OPTIONS, rules.minNoticeMinutes).map((m) => (
              <SelectItem key={m} value={String(m)}>
                {noticeLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{t("bookingRules.minNoticeHint")}</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="maxAdvance">{t("bookingRules.maxAdvanceLabel")}</Label>
        <Select
          value={String(rules.maxAdvanceDays)}
          onValueChange={(v) => setRules((r) => ({ ...r, maxAdvanceDays: Number(v) }))}
        >
          <SelectTrigger id="maxAdvance" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {withCurrent(HORIZON_OPTIONS, rules.maxAdvanceDays).map((d) => (
              <SelectItem key={d} value={String(d)}>
                {t("bookingRules.days", { count: d })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="interval">{t("bookingRules.intervalLabel")}</Label>
        <Select
          value={String(rules.slotIntervalMinutes)}
          onValueChange={(v) =>
            setRules((r) => ({
              ...r,
              slotIntervalMinutes: Number(v) as BookingRules["slotIntervalMinutes"],
            }))
          }
        >
          <SelectTrigger id="interval" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLOT_INTERVAL_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m === 60
                  ? t("bookingRules.hours", { count: 1 })
                  : t("bookingRules.minutes", { count: m })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{t("bookingRules.intervalHint")}</p>
      </div>

      <Button onClick={save} disabled={pending}>
        {t("bookingRules.save")}
      </Button>
    </div>
  );
}
