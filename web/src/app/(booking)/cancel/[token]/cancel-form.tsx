"use client";

import { useT } from "@/lib/terms/client";
import { useState, useTransition } from "react";
import { cancelBookingWithFee } from "@/actions/appointments";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface CancelFormProps {
  appointmentId: string;
  isLateCancellation: boolean;
  potentialFeeCents: number;
  salonName: string;
}

export function CancelForm({
  appointmentId,
  isLateCancellation,
  potentialFeeCents,
  salonName,
}: CancelFormProps) {
  const t = useT("booking");
  const [isPending, startTransition] = useTransition();
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelBookingWithFee({
        appointmentId,
        reason: "Cancelled by client via email link",
      });

      if (result.success) {
        setCancelled(true);
      } else {
        setError("Failed to cancel appointment. Please try again.");
      }
    });
  }

  if (cancelled) {
    return (
      <div className="text-center py-4">
        <h2 className="display text-3xl text-[var(--ink)] mb-2">
          Appointment Cancelled
        </h2>
        <p className="text-[var(--ink-soft)]">
          Your appointment has been successfully cancelled. You can close this
          page.
        </p>
      </div>
    );
  }

  const feeDisplay = (potentialFeeCents / 100).toFixed(2);

  return (
    <div className="space-y-3">
      {isLateCancellation && potentialFeeCents > 0 && (
        <div className="border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-[var(--ink-soft)] mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-[var(--ink)]">Late Cancellation</p>
              <p className="text-sm text-[var(--ink-soft)] mt-1">
                This is a late cancellation. {salonName} may charge a fee of $
                {feeDisplay}.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        variant="default"
        
        className="w-full"
        onClick={handleCancel}
        disabled={isPending}
      >
        {isPending ? "Cancelling..." : "Confirm Cancellation"}
      </Button>

      <p className="text-xs text-[var(--ink-soft)] text-center">
        {isLateCancellation
          ? t("cancelForm.lateFeeAck")
          : "This action cannot be undone."}
      </p>
    </div>
  );
}
