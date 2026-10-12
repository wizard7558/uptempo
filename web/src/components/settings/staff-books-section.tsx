"use client";

import { useEffect, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import {
  addBookingWindow,
  listBookingWindows,
  removeBookingWindow,
  setBooksMode,
  type BookingWindowView,
} from "@/actions/staff";

type Mode = "open" | "windows" | "closed";
type WindowKind = "requests" | "direct";

const shortDay = (day: string) => format(parseISO(day), "MMM d");

/** When one team member takes new work online: always, never, or only on set dates. */
export function StaffBooksSection({
  staffId,
  initialMode,
}: {
  staffId: string;
  initialMode: Mode;
}) {
  const t = useT("settings");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [windows, setWindows] = useState<BookingWindowView[]>([]);
  const [range, setRange] = useState<DateRange | undefined>();
  const [kind, setKind] = useState<WindowKind>("requests");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listBookingWindows(staffId).then((rows) => {
      if (!cancelled) setWindows(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  const reload = async () => setWindows(await listBookingWindows(staffId));

  function changeMode(next: Mode) {
    setMessage(null);
    startTransition(async () => {
      const res = await setBooksMode(staffId, next);
      if (res.success) {
        setMode(next);
        setMessage({ text: t("staffBooks.saved"), ok: true });
      } else setMessage({ text: res.error, ok: false });
    });
  }

  function saveDates() {
    if (!range?.from) {
      setMessage({ text: t("staffBooks.pickRange"), ok: false });
      return;
    }
    const from = format(range.from, "yyyy-MM-dd");
    const to = format(range.to ?? range.from, "yyyy-MM-dd");
    setMessage(null);
    startTransition(async () => {
      const res = await addBookingWindow({ staffId, from, to, mode: kind });
      if (res.success) {
        await reload();
        setRange(undefined);
        setAdding(false);
        setMessage({ text: t("staffBooks.saved"), ok: true });
      } else setMessage({ text: res.error, ok: false });
    });
  }

  function remove(id: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await removeBookingWindow(id);
      if (res.success) await reload();
      else setMessage({ text: res.error, ok: false });
    });
  }

  return (
    <section className="space-y-4 border-t pt-4" aria-labelledby="books-heading">
      <h3 id="books-heading" className="text-base font-semibold">
        {t("staffBooks.title")}
      </h3>
      <div className="space-y-1">
        <Label htmlFor="staff-books">{t("staffBooks.label")}</Label>
        <Select value={mode} onValueChange={(v) => changeMode(v as Mode)} disabled={pending}>
          <SelectTrigger id="staff-books" className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t("staffBooks.open")}</SelectItem>
            <SelectItem value="windows">{t("staffBooks.windows")}</SelectItem>
            <SelectItem value="closed">{t("staffBooks.closed")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "windows" && (
        <div className="space-y-3">
          {windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("staffBooks.noWindows")}</p>
          ) : (
            <ul className="space-y-2">
              {windows.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {t("staffBooks.row", {
                      from: shortDay(w.from),
                      to: shortDay(w.to),
                      what: t(w.mode === "direct" ? "staffBooks.direct" : "staffBooks.requests"),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={pending}
                    onClick={() => remove(w.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("staffBooks.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {!adding ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
              <CalendarPlus className="size-4" aria-hidden />
              {t("staffBooks.addDates")}
            </Button>
          ) : (
            <div className="space-y-3">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                disabled={{ before: new Date() }}
                className="p-0 [--cell-size:--spacing(11)]"
              />
              <div className="space-y-1">
                <Label htmlFor="staff-books-what">{t("staffBooks.whatOpens")}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as WindowKind)}>
                  <SelectTrigger id="staff-books-what" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requests">{t("staffBooks.requests")}</SelectItem>
                    <SelectItem value="direct">{t("staffBooks.direct")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" className="h-11" disabled={pending} onClick={saveDates}>
                {t("staffBooks.saveDates")}
              </Button>
            </div>
          )}
        </div>
      )}

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
