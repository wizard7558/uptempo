"use client";

import { format, startOfWeek, endOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";
import type { ViewMode } from "@/hooks/use-schedule";
import { useT } from "@/lib/terms/client";

interface DateNavProps {
  currentDate: Date;
  viewMode: ViewMode;
  onNavigate: (direction: "prev" | "next") => void;
  onToday: () => void;
  onDateSelect: (date: Date) => void;
}

export function DateNav({
  currentDate,
  viewMode,
  onNavigate,
  onToday,
  onDateSelect,
}: DateNavProps) {
  const t = useT("schedule");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const dateDisplay =
    viewMode === "day"
      ? format(currentDate, "EEEE, MMM d, yyyy")
      : viewMode === "month"
        ? format(currentDate, "MMMM yyyy")
        : `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d")} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d, yyyy")}`;

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" aria-label={t("previous")} onClick={() => onNavigate("prev")}>
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="min-w-48 text-sm font-medium">
            {dateDisplay}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={currentDate}
            onSelect={(date) => {
              if (date) {
                onDateSelect(date);
                setCalendarOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>

      <Button variant="outline" size="icon" aria-label={t("next")} onClick={() => onNavigate("next")}>
        <ChevronRight className="h-4 w-4" />
      </Button>

      <Button variant="outline"  onClick={onToday}>
        Today
      </Button>
    </div>
  );
}
