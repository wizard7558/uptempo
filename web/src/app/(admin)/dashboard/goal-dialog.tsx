"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMonthlyRevenueGoal } from "@/actions/revenue-goal";

interface GoalDialogProps {
  /** Current goal in cents, or null when unset — seeds the input. */
  currentGoalCents: number | null;
}

/**
 * Quiet entry point for owners/admins to set the business's monthly revenue goal.
 * Only rendered for users who can manage settings. Revalidates the dashboard on
 * save so the goal line and business score pick up the new target.
 */
export function GoalDialog({ currentGoalCents }: GoalDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(
    currentGoalCents != null ? String(Math.round(currentGoalCents / 100)) : "",
  );
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const dollars = Number(value);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error("Enter a whole, non-negative amount.");
      return;
    }
    const cents = Math.round(dollars) * 100;
    startTransition(async () => {
      const result = await setMonthlyRevenueGoal(cents);
      if (result.success) {
        toast.success("Monthly goal updated.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not update revenue goal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" >
          {currentGoalCents != null ? "Edit goal" : "Set a monthly goal"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-light">
            Monthly revenue goal
          </DialogTitle>
          <DialogDescription>
            Set the service-revenue target the dashboard measures against.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="goal-amount">Goal (USD)</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <Input
              id="goal-amount"
              inputMode="numeric"
              className="pl-7"
              placeholder="10,000"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="default"
            
            disabled={isPending}
            onClick={handleSave}
          >
            {isPending ? "Saving…" : "Save goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
