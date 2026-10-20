"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  addDays,
  endOfDay,
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { getScheduleData } from "@/actions/appointments";
import {
  AppointmentBlock,
  type AppointmentData,
} from "./appointment-block";
import { CurrentTimeMarker } from "./current-time-marker";
import {
  DEFAULT_END_HOUR,
  DEFAULT_START_HOUR,
  HOUR_HEIGHT_PX,
  SLOT_DURATION_MINUTES,
  SLOT_HEIGHT_PX,
  TOTAL_HEIGHT_PX,
  computeOverlapLanes,
} from "./schedule-config";
import { cn } from "@/lib/utils";

interface StaffMember {
  id: string;
  displayName: string;
}

interface WeekViewProps {
  staff: StaffMember[];
  currentDate: Date;
  /** Tap day header / empty slot → switch to day view (optionally at a time). */
  onDayClick: (date: Date) => void;
  /** Tap an appointment block → open the existing detail dialog. */
  onAppointmentSelect: (appointment: AppointmentData) => void;
  /** Drag an appointment to a new day + minute-of-day. Staff member stays the same. */
  onDragReschedule: (
    appointmentId: string,
    appointment: AppointmentData,
    newDate: Date,
    newMinutes: number,
  ) => void;
}

interface DailyTotals {
  count: number;
  durationMinutes: number;
  revenueCents: number;
}

function formatHours(minutes: number): string {
  if (minutes === 0) return "0h";
  const hours = minutes / 60;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

function formatRevenue(cents: number): string {
  if (cents === 0) return "";
  if (cents >= 100_00) {
    return `$${Math.round(cents / 100).toLocaleString()}`;
  }
  return `$${(cents / 100).toFixed(0)}`;
}

function computeTotals(appointments: AppointmentData[]): DailyTotals {
  let durationMinutes = 0;
  let revenueCents = 0;
  for (const appt of appointments) {
    durationMinutes += (appt.end.getTime() - appt.start.getTime()) / 60_000;
    for (const svc of appt.services) {
      if (typeof svc.priceCents === "number") {
        revenueCents += svc.priceCents;
      }
    }
  }
  return {
    count: appointments.length,
    durationMinutes,
    revenueCents,
  };
}

export function WeekView({
  staff,
  currentDate,
  onDayClick,
  onAppointmentSelect,
  onDragReschedule,
}: WeekViewProps) {
  const [appointmentsByDay, setAppointmentsByDay] = useState<
    Record<string, AppointmentData[]>
  >({});
  const [isPending, startTransition] = useTransition();

  const weekStart = useMemo(
    () => startOfWeek(currentDate, { weekStartsOn: 1 }),
    [currentDate],
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 5 },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const fetchWeekAppointments = useCallback(() => {
    const wkStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(wkStart, i));
    const rangeStart = startOfDay(weekDays[0]);
    const rangeEnd = endOfDay(weekDays[6]);

    startTransition(async () => {
      const staffIds = staff.map((s) => s.id);
      if (staffIds.length === 0) {
        setAppointmentsByDay({});
        return;
      }

      const data = await getScheduleData(staffIds, rangeStart, rangeEnd);

      const all: AppointmentData[] = [];
      for (const appts of Object.values(data.appointments)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const a of appts as any[]) {
          all.push({
            ...a,
            start: new Date(a.start),
            end: new Date(a.end),
          });
        }
      }

      const grouped: Record<string, AppointmentData[]> = {};
      for (const day of weekDays) {
        const key = format(day, "yyyy-MM-dd");
        grouped[key] = all
          .filter((a) => isSameDay(a.start, day))
          .sort((a, b) => a.start.getTime() - b.start.getTime());
      }

      setAppointmentsByDay(grouped);
    });
  }, [currentDate, staff]);

  useEffect(() => {
    fetchWeekAppointments();
  }, [fetchWeekAppointments]);

  const weekTotals = useMemo(() => {
    let count = 0;
    let durationMinutes = 0;
    let revenueCents = 0;
    for (const appts of Object.values(appointmentsByDay)) {
      const t = computeTotals(appts);
      count += t.count;
      durationMinutes += t.durationMinutes;
      revenueCents += t.revenueCents;
    }
    return { count, durationMinutes, revenueCents };
  }, [appointmentsByDay]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !active.data.current) return;

    const appointment = active.data.current.appointment as AppointmentData;
    const dropData = over.data.current as
      | { date: string; minutes: number }
      | undefined;
    if (!dropData) return;

    const targetDate = new Date(`${dropData.date}T00:00:00`);
    onDragReschedule(
      appointment.id,
      appointment,
      targetDate,
      dropData.minutes,
    );
  }

  return (
    <div
      data-calendar-view="week"
      aria-busy={isPending}
      className={cn("flex h-full min-h-0 flex-col")}
    >
      {/* Week summary header */}
      <div className="flex shrink-0 items-baseline justify-between gap-3 border-b bg-background px-4 py-2 text-xs">
        <span className="uppercase tracking-wide text-muted-foreground">
          This week
        </span>
        <span className="tabular-nums">
          <span className="font-medium">
            {weekTotals.count}{" "}
            {weekTotals.count === 1 ? "appt" : "appts"}
          </span>{" "}
          <span className="text-muted-foreground">·</span>{" "}
          {formatHours(weekTotals.durationMinutes)} booked
          {weekTotals.revenueCents > 0 && (
            <>
              {" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="font-medium">
                {formatRevenue(weekTotals.revenueCents)}
              </span>
            </>
          )}
        </span>
      </div>

      {/* Time-grid */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 overflow-auto">
          <WeekTimeGutter />
          <div className="relative flex flex-1">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayAppts = appointmentsByDay[key] ?? [];
              const totals = computeTotals(dayAppts);
              return (
                <DayColumn
                  key={key}
                  date={day}
                  dateKey={key}
                  appointments={dayAppts}
                  totals={totals}
                  isToday={isSameDay(day, new Date())}
                  onAppointmentSelect={onAppointmentSelect}
                  onHeaderClick={() => onDayClick(day)}
                  onEmptySlotClick={() => onDayClick(day)}
                />
              );
            })}
            {/* Current-time marker spans across — uses our taller week
                header for offset so it lands on the correct hour. */}
            <CurrentTimeMarker
              currentDate={currentDate}
              headerOffsetPx={WEEK_HEADER_HEIGHT_PX}
            />
          </div>
        </div>
      </DndContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time gutter (mirrors day-view's TimeColumn, but with a header that matches
// our taller day-column header).
// ---------------------------------------------------------------------------

const WEEK_HEADER_HEIGHT_PX = 68; // day-name + date + totals line

function WeekTimeGutter() {
  const hours: number[] = [];
  for (let h = DEFAULT_START_HOUR; h < DEFAULT_END_HOUR; h++) {
    hours.push(h);
  }

  return (
    <div className="relative w-16 shrink-0 border-r text-xs text-muted-foreground">
      <div
        aria-hidden
        className="sticky top-0 z-30 border-b bg-background"
        style={{ height: WEEK_HEADER_HEIGHT_PX }}
      />
      <div className="relative" style={{ height: TOTAL_HEIGHT_PX }}>
        {hours.map((hour) => {
          const top = (hour - DEFAULT_START_HOUR) * HOUR_HEIGHT_PX;
          const label = formatHour(hour);
          return (
            <div
              key={hour}
              className="absolute right-2 -translate-y-1/2 bg-background leading-none"
              style={{ top }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

// ---------------------------------------------------------------------------
// Day column
// ---------------------------------------------------------------------------

interface DayColumnProps {
  date: Date;
  dateKey: string;
  appointments: AppointmentData[];
  totals: DailyTotals;
  isToday: boolean;
  onAppointmentSelect: (appointment: AppointmentData) => void;
  onHeaderClick: () => void;
  onEmptySlotClick: (time: Date) => void;
}

function DayColumn({
  date,
  dateKey,
  appointments,
  totals,
  isToday,
  onAppointmentSelect,
  onHeaderClick,
  onEmptySlotClick,
}: DayColumnProps) {
  // Flex bookings (double-book inside a parent's processing window) overlay
  // on the right half of the parent; everything else participates in lanes.
  const { laidOut, flex } = useMemo(() => {
    const isFlex = (a: AppointmentData) =>
      a.isDoubleBook === true && a.doubleBookParentAppointmentId != null;
    const regular = appointments.filter((a) => !isFlex(a));
    return {
      laidOut: computeOverlapLanes(regular),
      flex: appointments.filter(isFlex),
    };
  }, [appointments]);

  return (
    <div
      role="region"
      aria-label={format(date, "EEEE, MMMM d")}
      className="relative min-w-0 flex-1 border-r last:border-r-0"
    >
      {/* Column header — day name, date, daily totals. */}
      <button
        type="button"
        onClick={onHeaderClick}
        aria-current={isToday ? "date" : undefined}
        className={cn(
          "sticky top-0 z-30 flex w-full flex-col items-center gap-0.5 border-b bg-background px-2 py-1.5 text-center transition-none hover:bg-muted/50",
          isToday && "bg-accent/5",
        )}
        style={{ height: WEEK_HEADER_HEIGHT_PX }}
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {format(date, "EEE")}
        </span>
        <span
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-medium leading-none",
            isToday && "bg-accent text-accent-foreground",
          )}
        >
          {format(date, "d")}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {totals.count === 0 ? (
            "—"
          ) : (
            <>
              {totals.count} · {formatHours(totals.durationMinutes)}
              {totals.revenueCents > 0 ? (
                <> · {formatRevenue(totals.revenueCents)}</>
              ) : null}
            </>
          )}
        </span>
      </button>

      {/* Time grid */}
      <div className="relative" style={{ height: TOTAL_HEIGHT_PX }}>
        {/* Hour grid lines */}
        {Array.from({ length: DEFAULT_END_HOUR - DEFAULT_START_HOUR }).map(
          (_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-t border-border/50"
              style={{ top: i * HOUR_HEIGHT_PX }}
            />
          ),
        )}

        {/* Droppable slot grid */}
        <DaySlotGrid
          dateKey={dateKey}
          date={date}
          onEmptySlotClick={onEmptySlotClick}
        />

        {/* Appointment blocks */}
        {laidOut.map(({ item, lane, lanes }) => (
          <AppointmentBlock
            key={item.id}
            appointment={item}
            lane={lane}
            lanes={lanes}
            onSelect={onAppointmentSelect}
          />
        ))}
        {flex.map((appt) => (
          <AppointmentBlock
            key={appt.id}
            appointment={appt}
            onSelect={onAppointmentSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot grid + droppable cells (15-min granularity)
// ---------------------------------------------------------------------------

function DaySlotGrid({
  dateKey,
  date,
  onEmptySlotClick,
}: {
  dateKey: string;
  date: Date;
  onEmptySlotClick: (time: Date) => void;
}) {
  const totalSlots =
    ((DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 60) / SLOT_DURATION_MINUTES;

  return (
    <div role="grid" aria-label={`Week slots for ${dateKey}`}>
      {Array.from({ length: totalSlots }).map((_, i) => {
        const minutes = DEFAULT_START_HOUR * 60 + i * SLOT_DURATION_MINUTES;
        return (
          <WeekDroppableSlot
            key={`${dateKey}-${minutes}`}
            dateKey={dateKey}
            date={date}
            minutes={minutes}
            slotIndex={i}
            onEmptySlotClick={onEmptySlotClick}
          />
        );
      })}
    </div>
  );
}

function WeekDroppableSlot({
  dateKey,
  date,
  minutes,
  slotIndex,
  onEmptySlotClick,
}: {
  dateKey: string;
  date: Date;
  minutes: number;
  slotIndex: number;
  onEmptySlotClick: (time: Date) => void;
}) {
  const slotId = `week-slot-${dateKey}-${minutes}`;
  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: { date: dateKey, minutes },
  });

  const handleClick = () => {
    const time = new Date(date);
    time.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    onEmptySlotClick(time);
  };

  return (
    <div
      role="row"
      className="absolute left-0 right-0"
      style={{
        top: slotIndex * SLOT_HEIGHT_PX,
        height: SLOT_HEIGHT_PX,
      }}
    >
      <div
        ref={setNodeRef}
        role="gridcell"
        className={cn(
          "h-full cursor-pointer hover:bg-primary/5",
          isOver && "bg-primary/10",
        )}
        onClick={handleClick}
      />
    </div>
  );
}

