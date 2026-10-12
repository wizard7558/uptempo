"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rescheduleBooking } from "@/actions/appointments";
import { toast } from "sonner";
import type { AppointmentData } from "@/components/schedule/appointment-block";
import { MapPin } from "lucide-react";
import { useT } from "@/lib/terms/client";

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentData;
  /** Pre-filled from drag-and-drop */
  newTime?: Date | null;
  newStaffId?: string | null;
  onComplete: () => void;
}

export function RescheduleDialog({
  open,
  onOpenChange,
  appointment,
  newTime,
  newStaffId,
  onComplete,
}: RescheduleDialogProps) {
  const t = useT("schedule");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  // If newTime is provided (drag-and-drop), show confirmation mode
  // Otherwise, show edit form mode
  const isDragDrop = !!newTime;

  const displayOldTime = format(appointment.start, "EEEE, MMM d 'at' h:mm a");
  const displayNewTime = newTime
    ? format(newTime, "EEEE, MMM d 'at' h:mm a")
    : null;

  async function handleConfirm(notifyClient?: boolean) {
    setIsSubmitting(true);

    let targetTime: string;
    if (isDragDrop && newTime) {
      targetTime = newTime.toISOString();
    } else {
      // Build from form inputs
      if (!editDate || !editTime) {
        toast.error("Please select a date and time");
        setIsSubmitting(false);
        return;
      }
      targetTime = new Date(`${editDate}T${editTime}`).toISOString();
    }

    const result = await rescheduleBooking({
      appointmentId: appointment.id,
      newStartTime: targetTime,
      newStaffId: newStaffId ?? undefined,
      ...(isDragDrop ? { notifyClient: notifyClient === true } : {}),
    });

    setIsSubmitting(false);

    if (result.success) {
      toast.success("Appointment rescheduled");
      onComplete();
    } else {
      const errorMsg =
        "message" in result.error
          ? (result.error as { message: string }).message
          : "Failed to reschedule";
      toast.error(errorMsg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isDragDrop ? t("move.title") : "Reschedule Appointment"}</DialogTitle>
          <DialogDescription>
            {appointment.clientName} -{" "}
            {appointment.services.map((s) => s.serviceName).join(", ")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(appointment.locationName || appointment.locationAddress) && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {[appointment.locationName, appointment.locationAddress]
                  .filter(Boolean)
                  .join(" — ")}
              </span>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-muted-foreground">Current Time</Label>
            <p className="text-sm font-medium">{displayOldTime}</p>
          </div>

          {isDragDrop ? (
            <div className="space-y-1">
              <Label className="text-muted-foreground">New Time</Label>
              <p className="text-sm font-medium">{displayNewTime}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="reschedule-date">New Date</Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reschedule-time">New Time</Label>
                <Input
                  id="reschedule-time"
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  step={900}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className={isDragDrop ? "flex-col gap-2 sm:flex-col" : undefined}>
          {isDragDrop ? (
            <>
              <Button className="min-h-11 w-full" onClick={() => handleConfirm(true)} disabled={isSubmitting}>
                {t("move.notify")}
              </Button>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => handleConfirm(false)}
                disabled={isSubmitting}
              >
                {t("move.silent")}
              </Button>
              <Button variant="ghost" className="min-h-11 w-full" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                {t("move.dont")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => handleConfirm()} disabled={isSubmitting}>
                {isSubmitting ? "Rescheduling..." : "Confirm Reschedule"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
