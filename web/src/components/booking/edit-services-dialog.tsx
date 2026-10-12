"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ServiceSelector } from "./service-selector";
import { listServices } from "@/actions/services";
import { fetchMultiServiceDuration } from "@/actions/services";
import { updateAppointmentServices } from "@/actions/appointments";
import { toast } from "sonner";
import type { AppointmentData } from "@/components/schedule/appointment-block";
import type { ServiceDurationInfo } from "@/lib/services/duration";

interface EditServicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentData;
  onComplete: () => void;
}

export function EditServicesDialog({
  open,
  onOpenChange,
  appointment,
  onComplete,
}: EditServicesDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allServices, setAllServices] = useState<
    { id: string; name: string; defaultDurationMinutes: number }[]
  >([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [durationInfo, setDurationInfo] = useState<{
    services: ServiceDurationInfo[];
    totalMinutes: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      listServices().then(setAllServices);
      setSelectedServiceIds(appointment.services.map((s) => s.serviceId));
      setDurationInfo(null);
    }
  }, [open, appointment.services]);

  useEffect(() => {
    if (!open || selectedServiceIds.length === 0) {
      setDurationInfo(null);
      return;
    }

    let cancelled = false;
    fetchMultiServiceDuration(
      selectedServiceIds,
      appointment.clientId,
      appointment.staffId,
    ).then((info) => {
      if (!cancelled) setDurationInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedServiceIds, appointment.clientId, appointment.staffId]);

  const toggleService = useCallback((serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId],
    );
  }, []);

  async function handleSave() {
    setIsSubmitting(true);

    const result = await updateAppointmentServices({
      appointmentId: appointment.id,
      serviceIds: selectedServiceIds,
    });

    setIsSubmitting(false);

    if (result.success) {
      toast.success("Services updated");
      onComplete();
    } else {
      const errorMsg =
        "message" in result.error
          ? (result.error as { message: string }).message
          : "Failed to update services";
      toast.error(errorMsg);
    }
  }

  const hasChanges =
    selectedServiceIds.length > 0 &&
    (selectedServiceIds.length !== appointment.services.length ||
      selectedServiceIds.some(
        (id) => !appointment.services.find((s) => s.serviceId === id),
      ));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Services</DialogTitle>
          <DialogDescription>
            {appointment.clientName}
          </DialogDescription>
        </DialogHeader>

        <ServiceSelector
          services={allServices}
          selectedServiceIds={selectedServiceIds}
          onToggle={toggleService}
          durationInfo={durationInfo}
          hasClient={true}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSubmitting || !hasChanges || selectedServiceIds.length === 0}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
