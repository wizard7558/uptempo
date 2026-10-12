"use client";

import { timeToPixelOffset, SLOT_HEIGHT_PX } from "./schedule-config";
import { cn } from "@/lib/utils";

export interface ExternalBlockData {
  id: string;
  startTime: Date;
  endTime: Date;
  isAllDay: number;
  freeBusyStatus: string; // 'busy' | 'tentative'
}

interface ExternalBlockProps {
  block: ExternalBlockData;
  onForceBook?: (startTime: Date) => void;
}

export function ExternalBlock({ block, onForceBook }: ExternalBlockProps) {
  const top = timeToPixelOffset(block.startTime);
  const durationMinutes =
    (block.endTime.getTime() - block.startTime.getTime()) / 60_000;
  const height = (durationMinutes / 15) * SLOT_HEIGHT_PX;

  return (
    <div
      className={cn(
        "absolute inset-x-1 z-[5] overflow-hidden rounded-md px-2 py-1 text-xs",
        "bg-muted/60 border border-dashed border-muted-foreground/30",
        "cursor-pointer hover:bg-muted/80",
      )}
      style={{
        top,
        height: Math.max(height, SLOT_HEIGHT_PX),
        // Gray hatched pattern via repeating linear gradient
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 8px)",
      }}
      onClick={() => onForceBook?.(block.startTime)}
      title="External calendar event - Click to force book"
    >
      <div className="truncate font-medium text-muted-foreground">
        {block.isAllDay ? "Busy (All Day)" : "Busy"}
        {block.freeBusyStatus === "tentative" && " (Tentative)"}
      </div>
    </div>
  );
}
