"use client";

import {
  DEFAULT_START_HOUR,
  DEFAULT_END_HOUR,
  HOUR_HEIGHT_PX,
  TOTAL_HEIGHT_PX,
} from "./schedule-config";

export function TimeColumn() {
  const hours: number[] = [];
  for (let h = DEFAULT_START_HOUR; h < DEFAULT_END_HOUR; h++) {
    hours.push(h);
  }

  return (
    <div className="relative w-16 shrink-0 border-r text-xs text-muted-foreground">
      {/* Spacer matching StylistColumn's sticky header so labels align with grid lines */}
      <div
        aria-hidden
        className="sticky top-0 z-30 h-16 border-b bg-background"
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
