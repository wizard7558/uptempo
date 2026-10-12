"use client";

import { timeToPixelOffset, SLOT_HEIGHT_PX } from "./schedule-config";
import { cn } from "@/lib/utils";

export interface TimeBlockData {
  id: string;
  startTime: Date;
  endTime: Date;
  label: string | null;
}

interface TimeBlockProps {
  block: TimeBlockData;
  onSelect?: (block: TimeBlockData) => void;
}

export function TimeBlock({ block, onSelect }: TimeBlockProps) {
  const top = timeToPixelOffset(block.startTime);
  const durationMinutes =
    (block.endTime.getTime() - block.startTime.getTime()) / 60_000;
  const height = (durationMinutes / 15) * SLOT_HEIGHT_PX;

  return (
    <button
      type="button"
      data-target-exempt="duration"
      className={cn(
        "absolute inset-x-1 z-[6] overflow-hidden rounded-md px-2 py-1 text-left text-xs",
        "border border-amber-600/40 bg-amber-100/90 text-amber-950",
        "cursor-pointer hover:bg-amber-200/90 dark:bg-amber-950/50 dark:text-amber-50 dark:hover:bg-amber-900/60",
      )}
      style={{
        top,
        height: Math.max(height, SLOT_HEIGHT_PX),
      }}
      title={block.label ? `${block.label} — click to remove` : "Time block — click to remove"}
      onClick={() => onSelect?.(block)}
    >
      <div className="truncate font-medium">
        {block.label?.trim() || "Blocked"}
      </div>
      <div className="truncate text-xs opacity-80">
        {block.startTime.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}{" "}
        –{" "}
        {block.endTime.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}
      </div>
    </button>
  );
}
