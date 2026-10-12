"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cancelBookingWithFee } from "@/actions/appointments";
import { getBusinessSettings } from "@/actions/policies";
import { isWithinCancellationWindow } from "@/lib/services/policy-engine";
import { toast } from "sonner";
import type { AppointmentData } from "@/components/schedule/appointment-block";
import { AlertTriangle, MapPin } from "lucide-react";

interface CancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentData;
  onComplete: () => void;
}

export function CancelDialog({
  open,
  onOpenChange,
  appointment,
  onComplete,
}: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [waiveFee, setWaiveFee] = useState(false);
  const [feeInfo, setFeeInfo] = useState<{
    inWindow: boolean;
    feePercent: number;
    windowHours: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setWaiveFee(false);
      getBusinessSettings().then((policy) => {
        const inWindow = isWithinCancellationWindow(
          appointment.start,
          policy.cancellationWindowHours,
        );
        setFeeInfo({
          inWindow,
          feePercent: policy.cancellationFeePercent,
          windowHours: policy.cancellationWindowHours,
        });
      });
    }
  }, [open, appointment.start]);

  async function handleCancel() {
    setIsSubmitting(true);

    const result = await cancelBookingWithFee({
      appointmentId: appointment.id,
      reason: reason.trim() || undefined,
      skipFee: waiveFee,
    });

    setIsSubmitting(false);

    if (result.success) {
      if ("feeResult" in result && result.feeResult) {
        const fr = result.feeResult;
        if ("feeCharged" in fr && fr.feeCharged && "amountCents" in fr && fr.amountCents != null) {
          const amount = (fr.amountCents / 100).toFixed(2);
          if ("status" in fr && fr.status === "completed") {
            toast.success(
              `Appointment cancelled. Late cancellation fee of $${amount} charged.`,
            );
          } else {
            toast.warning(
              `Appointment cancelled. Fee charge of $${amount} failed.`,
            );
          }
        } else {
          toast.success("Appointment cancelled");
        }
      } else {
        toast.success("Appointment cancelled");
      }
      setReason("");
      onComplete();
    } else {
      const errorMsg =
        "error" in result && typeof result.error === "string"
          ? result.error
          : "Failed to cancel appointment";
      toast.error(errorMsg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            This action cannot be undone. The appointment will be marked as
            cancelled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Appointment summary */}
          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <div className="font-medium">{appointment.clientName}</div>
            <div className="text-muted-foreground">
              {format(appointment.start, "EEEE, MMM d 'at' h:mm a")}
            </div>
            <div className="text-muted-foreground">
              {appointment.services.map((s) => s.serviceName).join(", ")}
            </div>
            {(appointment.locationName || appointment.locationAddress) && (
              <div className="mt-2 flex items-start gap-1.5 text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {[appointment.locationName, appointment.locationAddress]
                    .filter(Boolean)
                    .join(" — ")}
                </span>
              </div>
            )}
          </div>

          {/* Fee warning */}
          {feeInfo && feeInfo.inWindow && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950 p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 font-medium text-yellow-800 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4" />
                Late Cancellation Fee
              </div>
              <p className="text-yellow-700 dark:text-yellow-300">
                This cancellation is within the {feeInfo.windowHours}-hour
                policy window. A fee of {feeInfo.feePercent}% of the service
                cost will be charged to the client&apos;s card on file.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={waiveFee}
                  onChange={(e) => setWaiveFee(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-yellow-800 dark:text-yellow-200">
                  Waive fee for this cancellation
                </span>
              </label>
            </div>
          )}

          {feeInfo && !feeInfo.inWindow && (
            <div className="rounded-md border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950 p-3 text-sm">
              <p className="text-green-700 dark:text-green-300">
                This cancellation is outside the {feeInfo.windowHours}-hour
                policy window. No fee will be charged.
              </p>
            </div>
          )}

          {/* Optional reason */}
          <div className="space-y-1">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this appointment being cancelled?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep Appointment
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Cancelling..." : "Cancel Appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
