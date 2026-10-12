"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/terms/client";
import { CheckIcon } from "lucide-react";

interface ProgressBarProps {
  steps: string[];
  currentStep: number;
  completedSteps: Set<string>;
  onStepClick: (stepIndex: number) => void;
  /** Keys that `completedSteps` uses, one per step. Defaults to the booking wizard's. */
  stepKeys?: string[];
}

const STEP_KEYS = ["service", "time", "details", "confirm"];

export function ProgressBar({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  stepKeys = STEP_KEYS,
}: ProgressBarProps) {
  const t = useT("booking");
  return (
    <nav aria-label="Booking progress" className="w-full">
      <p aria-live="polite" className="mb-3 text-center text-[13px] text-[var(--ink)]">
        {t("progress.step", { current: currentStep + 1, total: steps.length })}
      </p>
      <ol className="flex items-start justify-between gap-1 sm:gap-3">
        {steps.map((label, index) => {
          const stepKey = stepKeys[index];
          const isCompleted = completedSteps.has(stepKey);
          const isCurrent = index === currentStep;
          const isClickable = isCompleted || isCurrent;
          const hasPreviousComplete =
            index > 0 && completedSteps.has(stepKeys[index - 1]);

          return (
            <li key={stepKey} className="relative flex flex-1 flex-col items-center gap-2">
              {/* Always render both line segments so the button stays
                  centered in its column. At the edges the spacer is
                  invisible but still takes space. */}
              <div className="flex w-full items-center pt-1">
                <div
                  aria-hidden
                  className={cn(
                    "h-px flex-1",
                    index === 0
                      ? "bg-transparent"
                      : hasPreviousComplete || isCompleted || isCurrent
                        ? "bg-[var(--ink)]"
                        : "bg-[var(--line)]",
                  )}
                />

                <button
                  type="button"
                  onClick={() => isClickable && onStepClick(index)}
                  disabled={!isClickable}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={label}
                  className={cn(
                    "relative z-10 inline-flex size-11 shrink-0 items-center justify-center bg-transparent p-0",
                    isClickable ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full border text-[13px] font-medium transition-colors",
                      isCompleted && !isCurrent &&
                        "border-[var(--ink)] bg-[var(--ink)] text-[var(--ivory)]",
                      isCurrent &&
                        "border-[var(--ink)] bg-[var(--ivory-raised)] text-[var(--ink)]",
                      !isCompleted && !isCurrent &&
                        "border-[var(--line)] bg-[var(--ivory-raised)] text-[var(--ink-soft)]",
                    )}
                  >
                    {isCompleted && !isCurrent ? (
                      <CheckIcon className="size-3.5" />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>
                </button>

                <div
                  aria-hidden
                  className={cn(
                    "h-px flex-1",
                    index === steps.length - 1
                      ? "bg-transparent"
                      : isCompleted || isCurrent
                        ? "bg-[var(--ink)]"
                        : "bg-[var(--line)]",
                  )}
                />
              </div>

              {/* Step labels hidden on mobile to prevent overflow; current
                  step label is rendered once below the row instead. */}
              <span
                className={cn(
                  "hidden sm:inline text-[13px] uppercase tracking-[0.18em]",
                  isCurrent
                    ? "font-medium text-[var(--ink)]"
                    : "text-[var(--ink-soft)]",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Mobile: single current-step label centered below the dots. */}
      <p className="mt-3 text-center text-[13px] text-[var(--ink)] sm:hidden">
        <span className="font-medium">{steps[currentStep]}</span>
      </p>
    </nav>
  );
}
