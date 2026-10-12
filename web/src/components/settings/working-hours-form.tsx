"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { saveWeeklySchedule } from "@/actions/working-hours";
import { useT } from "@/lib/terms/client";
import { validateShifts, type DaySchedule, type Shift } from "@/lib/scheduling/week";
import { ShiftRows, nextShift, type LocationOption } from "./shift-rows";

interface WorkingHoursFormProps {
  staffId: string;
  initialHours: DaySchedule[];
  locations: LocationOption[];
}

export function WorkingHoursForm({ staffId, initialHours, locations }: WorkingHoursFormProps) {
  const t = useT("settings");
  const [days, setDays] = useState<DaySchedule[]>(initialHours);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const defaultLocationId = locations[0]?.id ?? null;

  function updateDay(dayOfWeek: number, patch: Partial<DaySchedule>) {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  function handleEnabledChange(day: DaySchedule, checked: boolean) {
    if (!checked) {
      updateDay(day.dayOfWeek, { isEnabled: 0 });
      return;
    }
    const shifts: Shift[] =
      day.shifts.length > 0 ? day.shifts : [nextShift([], defaultLocationId)];
    updateDay(day.dayOfWeek, {
      isEnabled: 1,
      shifts: shifts.map((s) => ({ ...s, locationId: s.locationId ?? defaultLocationId })),
    });
  }

  async function handleSubmit() {
    const open = days.filter((d) => d.isEnabled === 1);
    for (const day of open) {
      const problem = validateShifts(day.shifts);
      if (problem) {
        toast.error(problem === "overlap" ? t("hours.overlapError") : t("hours.orderError"));
        return;
      }
      if (day.shifts.some((s) => !s.locationId)) {
        toast.error(t("hours.locationPlaceholder"));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await saveWeeklySchedule({
        staffId,
        days: days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isEnabled: d.isEnabled,
          shifts:
            d.isEnabled === 1
              ? d.shifts.map((s) => ({
                  startTime: s.startTime,
                  endTime: s.endTime,
                  locationId: s.locationId as string,
                }))
              : [],
        })),
      });

      if (!result.success) {
        toast.error(
          "message" in result.error && result.error.message
            ? result.error.message
            : "Failed to save working hours",
        );
        return;
      }
      toast.success(t("hours.saved"));
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {days.map((day) => (
          <div
            key={day.dayOfWeek}
            data-testid={`hours-day-${day.dayOfWeek}`}
            className="flex items-start gap-4 rounded-lg border p-3"
          >
            <div className="w-24 shrink-0 pt-2">
              <Label className="text-sm font-medium">{day.dayName}</Label>
            </div>

            <div className="flex w-24 shrink-0 items-center gap-2 pt-1.5">
              <Switch
                checked={day.isEnabled === 1}
                aria-label={t("hours.openOn", { day: day.dayName })}
                onCheckedChange={(checked) => handleEnabledChange(day, checked)}
              />
              <span className="text-muted-foreground text-sm">
                {day.isEnabled === 1 ? t("hours.open") : t("hours.closed")}
              </span>
            </div>

            {day.isEnabled === 1 && (
              <ShiftRows
                shifts={day.shifts}
                locations={locations}
                onChange={(shifts) => updateDay(day.dayOfWeek, { shifts })}
              />
            )}
          </div>
        ))}
      </div>

      <Button onClick={handleSubmit} disabled={isSubmitting}>
        {isSubmitting ? t("hours.saving") : t("hours.save")}
      </Button>
    </div>
  );
}
