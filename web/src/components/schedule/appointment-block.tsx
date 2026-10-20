"use client";

import { useDraggable } from "@dnd-kit/core";
import { timeToPixelOffset, SLOT_HEIGHT_PX } from "./schedule-config";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/terms/client";
import { visitWord } from "@/lib/schedule/visit-status";

export interface AppointmentData {
  id: string;
  /** Staff column this appointment belongs to. Used by edit-services to
   * resolve per-staff pricing. */
  staffId: string;
  clientId: string;
  clientName: string;
  services: {
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    isOverride: number;
    /** Price snapshot at booking time falling back to current service price.
     * Used to compute revenue totals on schedule views. */
    priceCents?: number | null;
  }[];
  start: Date;
  end: Date;
  status: string;
  checkedInAt?: Date | string | null;
  notes: string | null;
  attributes?: Record<string, unknown>;
  hasCardOnFile?: boolean;
  calendarSyncStatus?: string | null; // 'pending' | 'pushed' | 'failed' | 'not_applicable'
  isDoubleBook?: boolean;
  doubleBookParentAppointmentId?: string | null;
  doubleBookParentClientName?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  /** Snapshot when booked: first visit vs returning */
  clientStatusAtBooking?: string | null;
  /** Set when this appointment is one visit of a repeating series. */
  recurrenceRuleId?: string | null;
  /** The series rule text, e.g. "FREQ=WEEKLY;INTERVAL=2". */
  rrule?: string | null;
  bookingGroupId?: string | null;
  /** On-site jobs: where to go, the arrival window length (minutes) and when the "On my way" text went out. */
  serviceAddress?: {
    line1: string;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string;
  } | null;
  arrivalWindowMin?: number | null;
  onMyWaySentAt?: Date | null;
  /** Set when this appointment is one session of a multi-session project. */
  project?: { id: string; title: string; designPending: boolean } | null;
}

interface AppointmentBlockProps {
  appointment: AppointmentData;
  onSelect: (appointment: AppointmentData) => void;
  /** 0-indexed lane within an overlap cluster. */
  lane?: number;
  /** Total lanes in the cluster; when > 1, block renders as a vertical slice. */
  lanes?: number;
  dragId?: string;
}

const PROCESSING_HATCH_PATTERN = `repeating-linear-gradient(
  45deg,
  transparent,
  transparent 3px,
  color-mix(in srgb, var(--foreground) 18%, transparent) 3px,
  color-mix(in srgb, var(--foreground) 18%, transparent) 6px
)`;

export function AppointmentBlock({
  appointment,
  onSelect,
  lane,
  lanes,
  dragId,
}: AppointmentBlockProps) {
  const t = useT("schedule");
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: dragId ?? appointment.id,
      data: {
        appointment,
      },
    });

  const top = timeToPixelOffset(appointment.start);
  const durationMinutes =
    (appointment.end.getTime() - appointment.start.getTime()) / 60_000;
  const height = (durationMinutes / 15) * SLOT_HEIGHT_PX;

  const serviceNames = appointment.services
    .map((s) => s.serviceName)
    .join(", ");

  const timeLabel = appointment.start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const statusLabel = t(`status.${visitWord(appointment.status, appointment.checkedInAt)}`);

  // "Flex booking" = double-book that sits inside a parent's processing window.
  // Renders as a right-half overlay of the parent. Generic overlapping
  // appointments (no parent) participate in the lane layout instead.
  const isFlexBooking =
    appointment.isDoubleBook === true &&
    appointment.doubleBookParentAppointmentId != null;
  const hasProcessingTime =
    appointment.activeMinutes != null &&
    appointment.activeMinutes > 0 &&
    appointment.processingMinutes != null &&
    appointment.processingMinutes > 0;

  const useLanes =
    !isFlexBooking && lane != null && lanes != null && lanes > 1;

  const style: React.CSSProperties = {
    top,
    height: Math.max(height, SLOT_HEIGHT_PX),
    ...(transform
      ? {
          transform: `translate(${transform.x}px, ${transform.y}px)`,
        }
      : {}),
    ...(useLanes
      ? {
          left: `calc(${(lane! / lanes!) * 100}% + 2px)`,
          width: `calc(${100 / lanes!}% - 4px)`,
        }
      : {}),
  };

  // Hatched processing band overlay — uses percentage top/height, which behave
  // intuitively for positioned elements (unlike background-position percentages).
  const processingOverlay = hasProcessingTime
    ? (() => {
        const activeStartPct =
          (appointment.activeMinutes! / durationMinutes) * 100;
        const processingHeightPct =
          (appointment.processingMinutes! / durationMinutes) * 100;
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0"
            style={{
              top: `${activeStartPct}%`,
              height: `${processingHeightPct}%`,
              background: PROCESSING_HATCH_PATTERN,
            }}
          />
        );
      })()
    : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      data-target-exempt="duration"
      aria-label={`${appointment.clientName}, ${serviceNames}, ${timeLabel}, ${statusLabel}${isFlexBooking ? " (flex booking)" : ""}`}
      className={cn(
        "absolute z-10 cursor-pointer overflow-hidden rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-sm transition-opacity",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isDragging && "opacity-50",
        !isDragging && "hover:bg-muted",
        // Flex bookings render narrower on the right side (overlay on parent).
        // Multi-lane appointments use inline left/width from `style`; otherwise full width.
        isFlexBooking
          ? "left-[40%] right-1 border-l-2 border-l-border"
          : useLanes
            ? ""
            : "inset-x-1",
      )}
      style={style}
      onClick={() => onSelect(appointment)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(appointment);
        }
      }}
    >
      {processingOverlay}
      <div className="relative flex flex-wrap items-center gap-1 font-medium">
        <span className="min-w-0 truncate">{appointment.clientName}</span>
        {appointment.clientStatusAtBooking === "new" && (
          <Badge
            variant="secondary"
            className="h-4 shrink-0 px-1 py-0 text-xs leading-none text-foreground"
          >
            New
          </Badge>
        )}
        {appointment.clientStatusAtBooking === "repeat" && (
          <Badge
            variant="outline"
            className="h-4 shrink-0 border-border bg-muted px-1 py-0 text-xs leading-none text-muted-foreground"
          >
            Repeat
          </Badge>
        )}
        <span className="min-w-0 truncate">
          {" — "}
          {appointment.services.length > 1
            ? appointment.services.map((s) => s.serviceName).join(" + ")
            : appointment.services[0]?.serviceName ?? ""}
        </span>
      </div>
      <div className="relative truncate text-sm">{timeLabel}</div>
      <div className="relative truncate text-sm">{statusLabel}</div>
      {appointment.locationName && (
        <div className="relative truncate text-xs opacity-80">
          {appointment.locationName}
        </div>
      )}
      {isFlexBooking && (
        <div className="relative text-xs opacity-75">
          (flex
          {appointment.doubleBookParentClientName
            ? ` · ${appointment.doubleBookParentClientName}`
            : ""}
          )
        </div>
      )}
    </div>
  );
}
