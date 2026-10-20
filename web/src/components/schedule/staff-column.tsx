"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useDroppable } from "@dnd-kit/core";
import {
  AppointmentBlock,
  type AppointmentData,
} from "./appointment-block";
import { ExternalBlock, type ExternalBlockData } from "./external-block";
import { TimeBlock, type TimeBlockData } from "./time-block";
import {
  DEFAULT_START_HOUR,
  DEFAULT_END_HOUR,
  HOUR_HEIGHT_PX,
  TOTAL_HEIGHT_PX,
  SLOT_HEIGHT_PX,
  SLOT_DURATION_MINUTES,
  computeOverlapLanes,
} from "./schedule-config";

interface StaffColumnProps {
  staffId: string;
  staffName: string;
  photoUrl?: string | null;
  /** People columns show a photo or initial. Room columns do not. */
  portrait?: boolean;
  appointments: AppointmentData[];
  externalBlocks: ExternalBlockData[];
  timeBlocks?: TimeBlockData[];
  onSlotClick: (staffId: string, time: Date, date: Date) => void;
  onAppointmentSelect: (appointment: AppointmentData) => void;
  onTimeBlockSelect?: (block: TimeBlockData) => void;
  onForceBook?: (staffId: string, time: Date, date: Date) => void;
  currentDate: Date;
}

export function StaffColumn({
  staffId,
  staffName,
  photoUrl,
  portrait = true,
  appointments,
  externalBlocks,
  timeBlocks = [],
  onSlotClick,
  onAppointmentSelect,
  onTimeBlockSelect,
  onForceBook,
  currentDate,
}: StaffColumnProps) {
  const { laidOutAppointments, flexAppointments } = useMemo(() => {
    // Flex bookings (double-book with a parent) render as right-half overlays
    // on top of the parent. Everything else — including admin overrides with
    // isDoubleBook=true but no parent — goes through the lane layout.
    const isFlex = (a: AppointmentData) =>
      a.isDoubleBook === true && a.doubleBookParentAppointmentId != null;
    const regular = appointments.filter((a) => !isFlex(a));
    const flex = appointments.filter(isFlex);
    return {
      laidOutAppointments: computeOverlapLanes(regular),
      flexAppointments: flex,
    };
  }, [appointments]);

  const initial = staffName.trim().charAt(0).toUpperCase() || "?";
  const dragIdFor = portrait ? undefined : (id: string) => `${staffId}:${id}`;

  return (
    <div
      role="region"
      aria-label={staffName}
      data-testid={portrait ? "person-column" : "room-column"}
      className="relative min-w-36 flex-1 border-r last:border-r-0"
    >
      <div className="sticky top-0 z-30 flex h-16 items-center justify-center gap-2 border-b bg-background px-2 text-center text-sm font-medium">
        {portrait &&
          (photoUrl ? (
            <Image
              src={photoUrl}
              alt=""
              width={44}
              height={44}
              sizes="44px"
              unoptimized
              className="size-11 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm">
              {initial}
            </span>
          ))}
        <span className="truncate">{staffName}</span>
      </div>

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

        {/* Droppable slot areas */}
        <SlotGrid
          staffId={staffId}
          staffName={staffName}
          currentDate={currentDate}
          onSlotClick={onSlotClick}
        />

        {/* Appointment blocks — overlapping appointments share lanes */}
        {laidOutAppointments.map(({ item, lane, lanes }) => (
          <AppointmentBlock
            key={item.id}
            appointment={item}
            lane={lane}
            lanes={lanes}
            dragId={dragIdFor?.(item.id)}
            onSelect={onAppointmentSelect}
          />
        ))}
        {/* Flex bookings overlay the right half of their parent */}
        {flexAppointments.map((appt) => (
          <AppointmentBlock
            key={appt.id}
            appointment={appt}
            dragId={dragIdFor?.(appt.id)}
            onSelect={onAppointmentSelect}
          />
        ))}

        {/* Internal time blocks */}
        {timeBlocks.map((block) => (
          <TimeBlock
            key={block.id}
            block={block}
            onSelect={onTimeBlockSelect}
          />
        ))}

        {/* External calendar busy blocks */}
        {externalBlocks.map((block) => (
          <ExternalBlock
            key={block.id}
            block={block}
            onForceBook={(time) => onForceBook?.(staffId, time, currentDate)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotGrid({
  staffId,
  staffName,
  currentDate,
  onSlotClick,
}: {
  staffId: string;
  staffName: string;
  currentDate: Date;
  onSlotClick: (staffId: string, time: Date, date: Date) => void;
}) {
  const totalSlots =
    ((DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 60) / SLOT_DURATION_MINUTES;
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);

  return (
    <div role="grid" aria-label={`Schedule for ${staffName}`}>
      {Array.from({ length: totalSlots }).map((_, i) => {
        const minutes = DEFAULT_START_HOUR * 60 + i * SLOT_DURATION_MINUTES;
        const slotId = `${staffId}-${minutes}`;

        return (
          <DroppableSlot
            key={slotId}
            slotId={slotId}
            index={i}
            staffId={staffId}
            minutes={minutes}
            currentDate={currentDate}
            onSlotClick={onSlotClick}
            totalSlots={totalSlots}
            focusedSlot={focusedSlot}
            setFocusedSlot={setFocusedSlot}
          />
        );
      })}
    </div>
  );
}

function DroppableSlot({
  slotId,
  index,
  staffId,
  minutes,
  currentDate,
  onSlotClick,
  totalSlots,
  focusedSlot,
  setFocusedSlot,
}: {
  slotId: string;
  index: number;
  staffId: string;
  minutes: number;
  currentDate: Date;
  onSlotClick: (staffId: string, time: Date, date: Date) => void;
  totalSlots: number;
  focusedSlot: number | null;
  setFocusedSlot: (index: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: {
      staffId,
      minutes,
    },
  });

  const handleClick = () => {
    const time = new Date(currentDate);
    time.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    onSlotClick(staffId, time, currentDate);
  };

  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const timeLabel = `${displayHour}:${String(min).padStart(2, "0")} ${period}`;

  return (
    <div
      role="row"
      className="absolute left-0 right-0"
      style={{
        top: index * SLOT_HEIGHT_PX,
        height: SLOT_HEIGHT_PX,
      }}
    >
    <div
      ref={setNodeRef}
      role="gridcell"
      id={`slot-${staffId}-${index}`}
      tabIndex={focusedSlot === index ? 0 : -1}
      aria-label={timeLabel}
      className={`h-full cursor-pointer hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:z-20 ${
        isOver ? "bg-primary/10" : ""
      }`}
      onClick={handleClick}
      onFocus={() => setFocusedSlot(index)}
      onKeyDown={(e) => {
        let nextIndex: number | null = null;
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            nextIndex = Math.min(index + 1, totalSlots - 1);
            break;
          case "ArrowUp":
            e.preventDefault();
            nextIndex = Math.max(index - 1, 0);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            handleClick();
            return;
        }
        if (nextIndex !== null) {
          setFocusedSlot(nextIndex);
          document.getElementById(`slot-${staffId}-${nextIndex}`)?.focus();
        }
      }}
    />
    </div>
  );
}
