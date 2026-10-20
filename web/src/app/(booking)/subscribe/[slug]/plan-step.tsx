"use client";

import { useT } from "@/lib/terms/client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SubscribePlanRow = {
  id: string;
  name: string;
  monthlyAmountCents: number;
  retailDiscountPercent: number;
  priorityBooking: number;
  priorityBookingDays: number;
  description: string | null;
  allowCustomAmount: number;
};

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const CHIP_DOLLARS = [100, 150, 200, 300];

interface PlanStepProps {
  plans: SubscribePlanRow[];
  businessName: string;
  initialPlanId: string | null;
  /** Passes the chosen plan and, for custom-amount plans, the dollar amount in cents. */
  onContinue: (planId: string, customAmountCents: number | null) => void;
}

export function PlanStep({
  plans,
  businessName,
  initialPlanId,
  onContinue,
}: PlanStepProps) {
  const t = useT("booking");
  const [selectedId, setSelectedId] = useState(
    () => initialPlanId ?? plans[0]?.id ?? "",
  );

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedId) ?? null,
    [plans, selectedId],
  );
  const customEnabled = selectedPlan?.allowCustomAmount === 1;
  const minDollars = selectedPlan
    ? Math.round(selectedPlan.monthlyAmountCents / 100)
    : 0;

  const [amountDollars, setAmountDollars] = useState("");
  // Default / reset the amount to the selected plan's minimum whenever the
  // selected plan changes.
  useEffect(() => {
    if (selectedPlan?.allowCustomAmount === 1) {
      setAmountDollars(String(Math.round(selectedPlan.monthlyAmountCents / 100)));
    }
  }, [selectedPlan]);

  const amountNum = Number(amountDollars);
  const amountValid =
    !customEnabled ||
    (amountDollars !== "" &&
      Number.isInteger(amountNum) &&
      amountNum >= minDollars);
  const chips = CHIP_DOLLARS.filter((c) => c >= minDollars);
  const singlePlan = plans.length === 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="display text-3xl text-[var(--ink)]">
          {customEnabled && singlePlan
            ? "Choose your contribution"
            : "Choose your plan"}
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          {businessName} — {t("subscribeWizard.membershipTitle")}
        </p>
      </div>

      {!singlePlan && (
        <div className="space-y-3" role="radiogroup" aria-label="Membership plan">
          {plans.map((p) => {
            const selected = p.id === selectedId;
            const soft = selected
              ? "text-[var(--ivory)]/70"
              : "text-[var(--ink-soft)]";
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  "w-full border border-[var(--line)] p-4 text-left transition-colors",
                  selected
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--ivory)] shadow-sm"
                    : "hover:bg-[var(--ivory-raised)]",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm font-semibold">
                    {p.allowCustomAmount === 1 ? "From " : ""}
                    {formatMoney(p.monthlyAmountCents)}
                    <span className={cn("font-normal", soft)}>/mo</span>
                  </span>
                </div>
                {p.description && (
                  <p className={cn("text-sm mt-2", soft)}>{p.description}</p>
                )}
                <ul className={cn("mt-2 text-xs space-y-1", soft)}>
                  {p.retailDiscountPercent > 0 && (
                    <li>
                      {t("planStep.discount", { percent: p.retailDiscountPercent })}
                    </li>
                  )}
                  {p.priorityBooking === 1 && (
                    <li>
                      Priority booking — up to {p.priorityBookingDays} extra days
                      of availability
                    </li>
                  )}
                </ul>
              </button>
            );
          })}
        </div>
      )}

      {customEnabled && (
        <div className="space-y-3">
          {!singlePlan && (
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink-soft)]">
              Choose your monthly contribution
            </p>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => {
                const active = amountNum === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAmountDollars(String(c))}
                    className={cn(
                      "border px-4 py-2 text-sm transition-colors",
                      active
                        ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--ivory)]"
                        : "border-[var(--line)] text-[var(--ink)] hover:bg-[var(--ivory-raised)]",
                    )}
                  >
                    ${c}
                  </button>
                );
              })}
            </div>
          )}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]">
              $
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={minDollars}
              step={1}
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              aria-label="Monthly contribution in dollars"
              className="w-full border border-[var(--line)] bg-transparent py-3 pl-7 pr-20 text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--ink-soft)]">
              / month
            </span>
          </div>
          {customEnabled && !amountValid ? (
            <p className="text-sm text-destructive">
              Enter a whole-dollar amount of ${minDollars} or more.
            </p>
          ) : (
            <p className="text-xs text-[var(--ink-soft)]">
              Minimum ${minDollars} · any whole-dollar amount
            </p>
          )}
        </div>
      )}

      <Button
        className="w-full"
        
        variant="default"
        disabled={!selectedId || (customEnabled && !amountValid)}
        onClick={() =>
          onContinue(
            selectedId,
            customEnabled ? Math.round(amountNum * 100) : null,
          )
        }
      >
        Continue
      </Button>
    </div>
  );
}
