import { hairSalon } from "@/lib/verticals/hair-salon";

export const DEFAULT_ASSISTANT_TASKS: Array<{
  name: string;
  defaultDurationMinutes: number;
}> = (hairSalon.taskPresets ?? []).map((t) => ({
  name: t.name,
  defaultDurationMinutes: t.minutes,
}));
