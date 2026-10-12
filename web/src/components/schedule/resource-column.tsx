"use client";

import { StaffColumn } from "./staff-column";
import type { AppointmentData } from "./appointment-block";
import type { ExternalBlockData } from "./external-block";
import type { TimeBlockData } from "./time-block";

interface ResourceColumnProps {
  resourceId: string;
  resourceName: string;
  appointments: AppointmentData[];
  onAppointmentSelect: (appointment: AppointmentData) => void;
  currentDate: Date;
}

/** A day-view column for a room, chair, or station. Drops change the time only. */
export function ResourceColumn({
  resourceId,
  resourceName,
  appointments,
  onAppointmentSelect,
  currentDate,
}: ResourceColumnProps) {
  return (
    <StaffColumn
      staffId={resourceId}
      staffName={resourceName}
      portrait={false}
      appointments={appointments}
      externalBlocks={[] as ExternalBlockData[]}
      timeBlocks={[] as TimeBlockData[]}
      onSlotClick={() => {}}
      onAppointmentSelect={onAppointmentSelect}
      currentDate={currentDate}
    />
  );
}
