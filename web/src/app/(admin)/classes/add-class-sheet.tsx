"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/lib/terms/client";
import { createClasses } from "@/actions/classes";
import type { ClassConflict } from "@/lib/classes/enroll";
import { canSaveAnyway, formatDayLabel, startTimeOptions } from "@/lib/classes/week";

export type ClassServiceOption = { id: string; name: string; classCapacity: number | null };
export type NamedOption = { id: string; name: string };

const REPEATS = [0, 4, 8, 12, 26] as const;
const TIMES = startTimeOptions();
const TRIGGER = "h-11 w-full";

export function AddClassSheet({
  services,
  staff,
  locations,
}: {
  services: ClassServiceOption[];
  staff: NamedOption[];
  locations: NamedOption[];
}) {
  const t = useT("classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState<Date | undefined>();
  const [startTime, setStartTime] = useState("");
  const [spots, setSpots] = useState("");
  const [waitlist, setWaitlist] = useState("10");
  const [repeat, setRepeat] = useState<(typeof REPEATS)[number]>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ClassConflict[]>([]);

  const staffName = staff.find((s) => s.id === staffId)?.name ?? "";

  function pickService(id: string) {
    setServiceId(id);
    const cap = services.find((s) => s.id === id)?.classCapacity;
    if (cap) setSpots(String(cap));
  }

  async function save(allowConflicts: boolean) {
    setError(null);
    if (!serviceId || !staffId || !date || !startTime) return setError(t("errors.needChoice"));
    const capacity = Number(spots);
    const waitlistCapacity = Number(waitlist);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) return setError(t("errors.needSpots"));
    if (!Number.isInteger(waitlistCapacity) || waitlistCapacity < 0 || waitlistCapacity > 100) {
      return setError(t("errors.needWaitlist"));
    }
    setBusy(true);
    const res = await createClasses({
      serviceId,
      staffId,
      locationId: locations.length > 0 && locationId ? locationId : null,
      resourceId: null,
      date: format(date, "yyyy-MM-dd"),
      startTime,
      capacity,
      waitlistCapacity,
      priceCents: null,
      repeatWeeks: repeat,
      allowConflicts,
    });
    setBusy(false);
    if (res.success) {
      setConflicts([]);
      setOpen(false);
      router.refresh();
      return;
    }
    if ("conflicts" in res) return setConflicts(res.conflicts);
    setConflicts([]);
    setError(res.error);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button"  variant="default">
          <PlusIcon aria-hidden />
          {t("add")}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col overflow-y-auto px-4 sm:max-w-md sm:px-6">
        <SheetHeader className="px-0">
          <SheetTitle>{t("add")}</SheetTitle>
        </SheetHeader>

        {services.length === 0 ? (
          <p className="text-muted-foreground">{t("noClassServices")}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="class-service">{t("class")}</Label>
              <Select value={serviceId} onValueChange={pickService}>
                <SelectTrigger id="class-service" className={TRIGGER}>
                  <SelectValue placeholder={t("chooseOne")} />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="class-staff">{t("staff")}</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger id="class-staff" className={TRIGGER}>
                  <SelectValue placeholder={t("chooseOne")} />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {locations.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="class-location">{t("location")}</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger id="class-location" className={TRIGGER}>
                    <SelectValue placeholder={t("chooseOne")} />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>{t("date")}</Label>
              <div className="flex justify-center rounded-lg border" data-testid="class-date">
                <Calendar mode="single" selected={date} onSelect={setDate} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="class-time">{t("startsAt")}</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger id="class-time" className={TRIGGER}>
                  <SelectValue placeholder={t("chooseOne")} />
                </SelectTrigger>
                <SelectContent>
                  {TIMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="class-spots">{t("spots")}</Label>
                <Input
                  id="class-spots"
                  className="h-11"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={spots}
                  onChange={(e) => setSpots(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="class-waitlist">{t("waitlistSpots")}</Label>
                <Input
                  id="class-waitlist"
                  className="h-11"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={waitlist}
                  onChange={(e) => setWaitlist(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="class-repeat">{t("repeat")}</Label>
              <Select value={String(repeat)} onValueChange={(v) => setRepeat(Number(v) as (typeof REPEATS)[number])}>
                <SelectTrigger id="class-repeat" className={TRIGGER}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEATS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 0 ? t("repeatNone") : t("repeatWeeks", { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {conflicts.length > 0 && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-sm">
                <p className="font-medium">{t("conflictsTitle")}</p>
                <ul className="list-disc space-y-1 pl-5">
                  {conflicts.map((c) => (
                    <li key={`${c.date}-${c.reason}`}>
                      {t(c.reason === "appointment" ? "conflict" : "conflictBlocked", {
                        date: formatDayLabel(c.date),
                        staff: staffName,
                      })}
                    </li>
                  ))}
                </ul>
                <p>{canSaveAnyway(conflicts) ? t("conflictsAppointmentOnly") : t("conflictsFix")}</p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        {services.length > 0 && (
          <SheetFooter className="px-0">
            <Button type="button"  variant="default" disabled={busy} onClick={() => void save(false)}>
              {busy ? t("saving") : t("save")}
            </Button>
            {canSaveAnyway(conflicts) && (
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void save(true)}>
                {t("saveAnyway")}
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
