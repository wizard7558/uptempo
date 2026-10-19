"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/terms/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { updateStaffGoals } from "@/actions/staff";

export interface StaffGoalRow {
  id: string;
  displayName: string;
  targetHoursPerWeek: number | null;
  targetHourlyEarningsCents: number | null;
}

function centsToDollarString(cents: number | null): string {
  return cents == null ? "" : String(Math.round(cents / 100));
}

function StaffGoalRowEditor({ staffMember }: { staffMember: StaffGoalRow }) {
  const router = useRouter();
  const [hours, setHours] = useState(
    staffMember.targetHoursPerWeek == null ? "" : String(staffMember.targetHoursPerWeek),
  );
  const [rate, setRate] = useState(
    centsToDollarString(staffMember.targetHourlyEarningsCents),
  );
  const [isPending, startTransition] = useTransition();

  function save() {
    const hoursTrim = hours.trim();
    const rateTrim = rate.trim();

    const targetHoursPerWeek = hoursTrim === "" ? null : Number(hoursTrim);
    const dollars = rateTrim === "" ? null : Number(rateTrim);

    if (
      (targetHoursPerWeek !== null &&
        (!Number.isFinite(targetHoursPerWeek) ||
          targetHoursPerWeek < 1 ||
          targetHoursPerWeek > 168)) ||
      (dollars !== null && (!Number.isFinite(dollars) || dollars < 0))
    ) {
      toast.error("Enter valid goal values (hours 1–168).");
      return;
    }

    const targetHourlyEarningsCents =
      dollars === null ? null : Math.round(dollars * 100);

    startTransition(async () => {
      const result = await updateStaffGoals({
        id: staffMember.id,
        targetHoursPerWeek:
          targetHoursPerWeek === null ? null : Math.round(targetHoursPerWeek),
        targetHourlyEarningsCents,
      });
      if (result.success) {
        toast.success(`Saved goals for ${staffMember.displayName}.`);
        router.refresh();
      } else {
        toast.error(result.message ?? "Failed to save goals.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-end">
      <div className="flex-1 text-sm font-medium">{staffMember.displayName}</div>
      <Field label="Hours / week" className="w-full sm:w-32">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={168}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="e.g. 30"
        />
      </Field>
      <Field label="Goal $/hour" className="w-full sm:w-32">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="e.g. 100"
        />
      </Field>
      <Button
        type="button"
        variant="outline"
        onClick={save}
        disabled={isPending}
        className="w-full sm:w-auto"
      >
        Save
      </Button>
    </div>
  );
}

/**
 * Capacity Coach goals for each staff member. When both hours/week and $/hour are set,
 * the weekly evaluator compares actuals and raises a dashboard alert when a
 * staff member's actual rate falls below their target.
 */
export function CapacityGoalsCard({
  staff,
}: {
  staff: StaffGoalRow[];
}) {
  const t = useT("settings");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Capacity Coach goals</CardTitle>
        <CardDescription>
          {t("capacityGoals.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("capacityGoals.empty")}</p>
        ) : (
          <div className="flex flex-col">
            {staff.map((staffMember) => (
              <StaffGoalRowEditor key={staffMember.id} staffMember={staffMember} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
