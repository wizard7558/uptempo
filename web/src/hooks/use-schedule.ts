"use client";

import { useState, useCallback } from "react";
import {
  addDays,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isSameDay,
} from "date-fns";

export type ViewMode = "day" | "week" | "month";
export type DayAxis = "people" | "rooms";

export function useSchedule(initialDate?: Date) {
  const [currentDate, setCurrentDate] = useState<Date>(
    initialDate ?? new Date(),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [dayAxis, setDayAxis] = useState<DayAxis>("people");

  const navigateDate = useCallback(
    (direction: "prev" | "next") => {
      if (viewMode === "month") {
        setCurrentDate((prev) =>
          direction === "next" ? addMonths(prev, 1) : subMonths(prev, 1),
        );
      } else {
        const days = viewMode === "day" ? 1 : 7;
        setCurrentDate((prev) =>
          direction === "next" ? addDays(prev, days) : addDays(prev, -days),
        );
      }
    },
    [viewMode],
  );

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const setDate = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  const toggleView = useCallback(() => {
    setViewMode((prev) =>
      prev === "day" ? "week" : prev === "week" ? "month" : "day",
    );
  }, []);

  const setView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 }); // Sunday
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  const isToday = isSameDay(currentDate, new Date());

  return {
    currentDate,
    viewMode,
    dayAxis,
    setDayAxis,
    navigateDate,
    goToToday,
    setDate,
    setView,
    toggleView,
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
    isToday,
  };
}
