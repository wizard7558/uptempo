"use client";

import { useState, useEffect } from "react";
import { isSameDay } from "date-fns";
import { COLUMN_HEADER_HEIGHT_PX, timeToPixelOffset } from "./schedule-config";

interface CurrentTimeMarkerProps {
  currentDate: Date;
  /** Override the header offset when used inside a view with a taller
   * sticky header than the default day-view column header. */
  headerOffsetPx?: number;
}

export function CurrentTimeMarker({
  currentDate,
  headerOffsetPx = COLUMN_HEADER_HEIGHT_PX,
}: CurrentTimeMarkerProps) {
  const [now, setNow] = useState(new Date());
  const isToday = isSameDay(currentDate, now);

  useEffect(() => {
    if (!isToday) return;

    const interval = setInterval(() => {
      setNow(new Date());
    }, 60_000); // Update every minute

    return () => clearInterval(interval);
  }, [isToday]);

  if (!isToday) return null;

  // The marker is mounted as a sibling of the stylist columns, so its
  // coordinate space starts at the top of the column headers. Offset by the
  // header height so the marker lines up with each column's grid (where
  // appointments and hour gridlines actually live).
  const top = headerOffsetPx + timeToPixelOffset(now);

  return (
    <div
      data-testid="current-time-marker"
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{ top }}
    >
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
        <div className="h-0.5 w-full bg-accent" />
      </div>
    </div>
  );
}
