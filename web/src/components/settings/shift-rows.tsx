"use client";

import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import { validateShifts, type Shift } from "@/lib/scheduling/week";
import { MAX_SHIFTS_PER_DAY } from "@/lib/validators/working-hours";

export type LocationOption = { id: string; name: string; address: string | null };

const LAST_TIME = "22:00";

/** 15-minute options from 6:00 AM to 10:00 PM. */
export const TIME_OPTIONS: string[] = (() => {
  const times: string[] = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 22 && m > 0) break;
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
})();

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${suffix}`;
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + hours * 60, 22 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The shift added by "Add another shift": starts where the last one ends, runs 3 hours (to 10 PM at most). */
export function nextShift(shifts: Shift[], fallbackLocationId: string | null): Shift {
  const prev = shifts[shifts.length - 1];
  const startTime = prev?.endTime ?? "09:00";
  return {
    startTime,
    endTime: addHours(startTime, 3),
    locationId: prev?.locationId ?? fallbackLocationId,
  };
}

interface ShiftRowsProps {
  shifts: Shift[];
  locations: LocationOption[];
  onChange: (shifts: Shift[]) => void;
}

export function ShiftRows({ shifts, locations, onChange }: ShiftRowsProps) {
  const t = useT("settings");
  const problem = validateShifts(shifts);
  const lastEnd = shifts.reduce((max, s) => (s.endTime > max ? s.endTime : max), "00:00");
  const canAdd = shifts.length < MAX_SHIFTS_PER_DAY && lastEnd < LAST_TIME;

  function update(index: number, patch: Partial<Shift>) {
    onChange(shifts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      {shifts.map((shift, index) => (
        <div
          key={index}
          data-testid="shift-row"
          className="flex flex-col gap-2 md:flex-row md:items-center"
        >
          {locations.length !== 1 && (
            <Select
              value={shift.locationId ?? ""}
              onValueChange={(val) => update(index, { locationId: val })}
            >
              <SelectTrigger className="w-full md:w-[220px]" aria-label={t("hours.locationPlaceholder")}>
                <SelectValue placeholder={t("hours.locationPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex items-center gap-2">
            <Select value={shift.startTime} onValueChange={(val) => update(index, { startTime: val })}>
              <SelectTrigger className="w-[120px]" aria-label="Start time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((time) => (
                  <SelectItem key={time} value={time}>
                    {formatTime(time)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground text-sm">{t("hours.shiftTo")}</span>

            <Select value={shift.endTime} onValueChange={(val) => update(index, { endTime: val })}>
              <SelectTrigger className="w-[120px]" aria-label="End time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((time) => (
                  <SelectItem key={time} value={time}>
                    {formatTime(time)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {shifts.length >= 2 && (
              <Button
                type="button"
                variant="ghost"
                
                onClick={() => onChange(shifts.filter((_, i) => i !== index))}
              >
                {t("hours.removeShift")}
              </Button>
            )}
          </div>
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          
          disabled={!canAdd}
          onClick={() =>
            onChange([...shifts, nextShift(shifts, locations[0]?.id ?? null)])
          }
        >
          <PlusIcon className="size-4" />
          {t("hours.addShift")}
        </Button>
      </div>

      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem === "overlap" ? t("hours.overlapError") : t("hours.orderError")}
        </p>
      )}
    </div>
  );
}
