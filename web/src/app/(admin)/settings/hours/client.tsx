"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/terms/client";
import { WorkingHoursForm } from "@/components/settings/working-hours-form";
import { DateOverrides } from "@/components/settings/date-overrides";
import {
  getWorkingHoursForStaffMember,
  listAvailabilityOverrides,
  type AvailabilityOverrideRow,
} from "@/actions/working-hours";
import type { DaySchedule } from "@/lib/scheduling/week";

interface WorkingHoursPageClientProps {
  staff: Array<{ id: string; name: string }>;
  initialHours: DaySchedule[];
  /** Upcoming days off and special hours. Leave out to hide that section (onboarding). */
  initialOverrides?: AvailabilityOverrideRow[];
  initialStaffId: string;
  locations: Array<{ id: string; name: string; address: string | null }>;
  /** Per-stylist list of location names where they have no hours yet. */
  missingByStaffId?: Record<string, string[]>;
}

export function WorkingHoursPageClient({
  staff,
  initialHours,
  initialOverrides,
  initialStaffId,
  locations,
  missingByStaffId = {},
}: WorkingHoursPageClientProps) {
  const t = useT("settings");
  const [selectedStaffId, setSelectedStaffId] =
    useState(initialStaffId);
  const [hours, setHours] = useState<DaySchedule[]>(initialHours);
  const [overrides, setOverrides] = useState<AvailabilityOverrideRow[]>(initialOverrides ?? []);
  const [isPending, startTransition] = useTransition();

  async function handleStaffChange(staffId: string) {
    setSelectedStaffId(staffId);
    startTransition(async () => {
      const [newHours, newOverrides] = await Promise.all([
        getWorkingHoursForStaffMember(staffId),
        initialOverrides ? listAvailabilityOverrides(staffId) : Promise.resolve([]),
      ]);
      setHours(newHours);
      setOverrides(newOverrides);
    });
  }

  const missing = missingByStaffId[selectedStaffId] ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>{t("hours.selectLabel")}</Label>
        <Select
          value={selectedStaffId}
          onValueChange={handleStaffChange}
        >
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder={t("hours.selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {staff.map((s) => {
              const missCount = missingByStaffId[s.id]?.length ?? 0;
              return (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    {s.name}
                    {missCount > 0 && (
                      <Badge variant="outline" className="text-amber-700">
                        Missing {missCount}
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {missing.length > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            No hours yet at: <strong>{missing.join(", ")}</strong>{t("hours.missingHint")}
          </p>
        )}
      </div>

      {isPending ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          Loading working hours...
        </div>
      ) : (
        <>
          <WorkingHoursForm
            key={selectedStaffId}
            staffId={selectedStaffId}
            initialHours={hours}
            locations={locations}
          />
          {initialOverrides && (
            <DateOverrides
              key={`overrides-${selectedStaffId}`}
              staffId={selectedStaffId}
              locations={locations}
              initialOverrides={overrides}
            />
          )}
        </>
      )}
    </div>
  );
}
