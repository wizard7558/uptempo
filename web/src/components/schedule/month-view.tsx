"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
} from "date-fns";
import { getScheduleData } from "@/actions/appointments";
import { getServiceColor } from "@/lib/utils/service-colors";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/terms/client";
import { visitWord } from "@/lib/schedule/visit-status";

interface StaffMember {
  id: string;
  displayName: string;
}

interface MonthViewProps {
  staff: StaffMember[];
  currentDate: Date;
  onDayClick: (date: Date) => void;
}

interface DayAppointment {
  id: string;
  clientName: string;
  serviceName: string;
  status: string;
  checkedInAt?: string | Date | null;
  start: Date;
  serviceColor: string;
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({
  staff,
  currentDate,
  onDayClick,
}: MonthViewProps) {
  const [appointmentsByDay, setAppointmentsByDay] = useState<
    Record<string, DayAppointment[]>
  >({});
  const [isPending, startTransition] = useTransition();
  const t = useT("schedule");

  const today = new Date();
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const fetchMonthAppointments = useCallback(() => {
    startTransition(async () => {
      const staffIds = staff.map((s) => s.id);
      if (staffIds.length === 0) {
        setAppointmentsByDay({});
        return;
      }

      const data = await getScheduleData(staffIds, gridStart, gridEnd);

      // Flatten all staff appointments into a single array
      const allAppointments: DayAppointment[] = [];
      for (const appts of Object.values(data.appointments)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const d of appts as any[]) {
          allAppointments.push({
            id: d.id,
            clientName: d.clientName,
            serviceName: d.services[0]?.serviceName ?? "",
            status: d.status,
            checkedInAt: d.checkedInAt,
            start: new Date(d.start),
            serviceColor: getServiceColor(
              d.services[0]?.serviceId ?? "default",
            ),
          });
        }
      }

      // Group by day
      const grouped: Record<string, DayAppointment[]> = {};
      for (const day of days) {
        const key = format(day, "yyyy-MM-dd");
        grouped[key] = allAppointments
          .filter((a) => isSameDay(a.start, day))
          .sort((a, b) => a.start.getTime() - b.start.getTime());
      }

      setAppointmentsByDay(grouped);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, staff]);

  useEffect(() => {
    fetchMonthAppointments();
  }, [fetchMonthAppointments]);

  return (
    <div
      data-calendar-view="month"
      aria-busy={isPending}
      className={cn("flex h-full min-h-0 flex-col")}
    >
      {/* Day headers */}
      <div className="grid shrink-0 grid-cols-7 border-b bg-muted/30">
        {DAY_HEADERS.map((header) => (
          <div
            key={header}
            className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {header}
          </div>
        ))}
      </div>

      {/* Day grid — auto-rows-fr stretches each row to fill the available
          vertical space, so the grid uses the full viewport instead of
          leaving dead space at the bottom. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-px bg-border">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayAppts = appointmentsByDay[key] ?? [];
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isSameDay(day, today);
          const MAX_DOTS = 4;
          const visibleAppts = dayAppts.slice(0, MAX_DOTS);
          const extraCount = dayAppts.length - MAX_DOTS;

          return (
            <button
              key={key}
              type="button"
              aria-label={format(day, "EEEE, MMMM d, yyyy")}
              aria-current={isCurrentDay ? "date" : undefined}
              className={cn(
                "group flex h-full min-h-0 w-full flex-col overflow-hidden bg-background p-2 text-left transition-none hover:bg-muted focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !isCurrentMonth && "text-muted-foreground",
                isCurrentDay && "ring-2 ring-inset ring-accent/30",
              )}
              onClick={() => onDayClick(day)}
            >
              {/* Day number */}
              <div className="mb-1 shrink-0">
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium",
                    isCurrentDay && "bg-accent text-accent-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>

              {/* Appointment indicators */}
              <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {visibleAppts.map((appt) => {
                  const timeLabel = appt.start.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  const statusLabel = t(`status.${visitWord(appt.status, appt.checkedInAt)}`);
                  return (
                    <div
                      key={appt.id}
                      className="truncate rounded px-1 py-0.5 text-xs leading-tight text-white"
                      style={{ backgroundColor: appt.serviceColor }}
                      title={`${appt.clientName}, ${appt.serviceName}, ${timeLabel}, ${statusLabel}`}
                    >
                      {timeLabel} {appt.clientName} {statusLabel}
                    </div>
                  );
                })}
                {extraCount > 0 && (
                  <div className="px-1 text-xs font-medium text-muted-foreground">
                    +{extraCount} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
