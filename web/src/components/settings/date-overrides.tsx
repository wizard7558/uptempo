"use client";

import { useState } from "react";
import { format, parse, startOfDay } from "date-fns";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  deleteAvailabilityOverride,
  listAvailabilityOverrides,
  saveAvailabilityOverride,
  type AvailabilityOverrideRow,
} from "@/actions/working-hours";
import { useT } from "@/lib/terms/client";
import { validateShifts, type Shift } from "@/lib/scheduling/week";
import { ShiftRows, formatTime, nextShift, type LocationOption } from "./shift-rows";

interface DateOverridesProps {
  staffId: string;
  locations: LocationOption[];
  initialOverrides: AvailabilityOverrideRow[];
}

const toDate = (day: string) => parse(day, "yyyy-MM-dd", new Date());

export function DateOverrides({ staffId, locations, initialOverrides }: DateOverridesProps) {
  const t = useT("settings");
  const [overrides, setOverrides] = useState(initialOverrides);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [closed, setClosed] = useState(true);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const defaultLocationId = locations[0]?.id ?? null;

  async function refresh() {
    setOverrides(await listAvailabilityOverrides(staffId));
  }

  function openNew() {
    setDate(undefined);
    setClosed(true);
    setShifts([nextShift([], defaultLocationId)]);
    setReason("");
    setOpen(true);
  }

  function openEdit(row: AvailabilityOverrideRow) {
    setDate(toDate(row.date));
    setClosed(row.closed);
    setShifts(row.shifts.length > 0 ? row.shifts : [nextShift([], defaultLocationId)]);
    setReason(row.reason ?? "");
    setOpen(true);
  }

  function handleClosedChange(next: boolean) {
    setClosed(next);
    if (!next && shifts.length === 0) setShifts([nextShift([], defaultLocationId)]);
  }

  async function handleSave() {
    if (!date) {
      toast.error(t("hours.overrides.pickDate"));
      return;
    }
    if (!closed) {
      const problem = validateShifts(shifts);
      if (problem) {
        toast.error(problem === "overlap" ? t("hours.overlapError") : t("hours.orderError"));
        return;
      }
      if (shifts.some((s) => !s.locationId)) {
        toast.error(t("hours.locationPlaceholder"));
        return;
      }
    }
    setSaving(true);
    try {
      const result = await saveAvailabilityOverride({
        staffId,
        date: format(date, "yyyy-MM-dd"),
        closed,
        shifts: closed
          ? []
          : shifts.map((s) => ({
              startTime: s.startTime,
              endTime: s.endTime,
              locationId: s.locationId as string,
            })),
        reason: reason.trim() === "" ? null : reason.trim(),
      });
      if (!result.success) {
        toast.error(
          "message" in result.error && result.error.message
            ? result.error.message
            : "Failed to save this day",
        );
        return;
      }
      setOpen(false);
      await refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    const result = await deleteAvailabilityOverride(id);
    if (!result.success) {
      toast.error("message" in result.error ? result.error.message : "Failed to remove this day");
      return;
    }
    await refresh();
  }

  function describe(row: AvailabilityOverrideRow): string {
    const parts = [
      format(toDate(row.date), "EEE, MMM d"),
      row.closed
        ? t("hours.overrides.closedLabel")
        : row.shifts.map((s) => `${formatTime(s.startTime)}–${formatTime(s.endTime)}`).join(", "),
    ];
    if (row.reason) parts.push(row.reason);
    return parts.join(" · ");
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{t("hours.overrides.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("hours.overrides.subtitle")}</p>
      </div>

      {overrides.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("hours.overrides.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {overrides.map((row) => (
            <li
              key={row.id}
              data-testid="override-row"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <span className="text-sm">{describe(row)}</span>
              <span className="flex gap-2">
                <Button type="button" variant="outline"  onClick={() => openEdit(row)}>
                  {t("hours.overrides.edit")}
                </Button>
                <Button type="button" variant="ghost"  onClick={() => handleRemove(row.id)}>
                  {t("hours.overrides.remove")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" onClick={openNew}>
        <PlusIcon className="size-4" />
        {t("hours.overrides.add")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("hours.overrides.dialogTitle")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-center" data-testid="override-calendar">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                disabled={{ before: startOfDay(new Date()) }}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="override-closed"
                checked={closed}
                onCheckedChange={handleClosedChange}
              />
              <Label htmlFor="override-closed" className="cursor-pointer">
                {t("hours.overrides.closedAllDay")}
              </Label>
            </div>

            {!closed && <ShiftRows shifts={shifts} locations={locations} onChange={setShifts} />}

            <div className="space-y-2">
              <Label htmlFor="override-reason">{t("hours.overrides.reason")}</Label>
              <Input
                id="override-reason"
                value={reason}
                maxLength={200}
                placeholder={t("hours.overrides.reasonPlaceholder")}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("hours.overrides.cancel")}
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {t("hours.overrides.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
