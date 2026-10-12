"use client";

import { useEffect, useState } from "react";
import { endOfDay, startOfDay } from "date-fns";
import { getScheduleData } from "@/actions/appointments";
import { useT } from "@/lib/terms/client";
import { visitWord } from "@/lib/schedule/visit-status";
import type { AppointmentData } from "./appointment-block";

interface AgendaListProps {
  staff: { id: string }[];
  currentDate: Date;
  refreshKey: number;
  onSelect: (appointment: AppointmentData) => void;
}

export function AgendaList({
  staff,
  currentDate,
  refreshKey,
  onSelect,
}: AgendaListProps) {
  const t = useT("schedule");
  const [items, setItems] = useState<AppointmentData[]>([]);

  useEffect(() => {
    let cancelled = false;
    const staffIds = staff.map((member) => member.id);
    if (staffIds.length === 0) {
      setItems([]);
      return;
    }

    (async () => {
      const data = await getScheduleData(
        staffIds,
        startOfDay(currentDate),
        endOfDay(currentDate),
      );
      if (cancelled) return;
      const flat: AppointmentData[] = [];
      for (const appts of Object.values(data.appointments)) {
        for (const raw of appts) {
          const row = raw as AppointmentData & { start: string | Date; end: string | Date };
          flat.push({
            ...row,
            start: new Date(row.start),
            end: new Date(row.end),
          });
        }
      }
      flat.sort((a, b) => a.start.getTime() - b.start.getTime());
      setItems(flat);
    })();

    return () => {
      cancelled = true;
    };
  }, [staff, currentDate, refreshKey]);

  return (
    <section data-testid="agenda-list" className="flex flex-col gap-2 p-4" aria-label={t("agenda.heading")}>
      <h2 className="text-base font-medium">{t("agenda.heading")}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("agenda.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((appointment) => {
            const serviceNames = appointment.services.map((service) => service.serviceName).join(", ");
            const timeLabel = appointment.start.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });
            const statusLabel = t(
              `status.${visitWord(appointment.status, appointment.checkedInAt)}`,
            );
            return (
              <li key={appointment.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-col items-start justify-center rounded-md border px-3 py-2 text-left text-sm"
                  onClick={() => onSelect(appointment)}
                >
                  <span className="font-medium">
                    {timeLabel} {appointment.clientName}
                  </span>
                  <span>
                    {serviceNames} · {statusLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
