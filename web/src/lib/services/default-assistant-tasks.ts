import { getVertical } from "@/lib/verticals";

export type DefaultAssistantTask = {
  name: string;
  defaultDurationMinutes: number;
};

export function getDefaultAssistantTasksForIndustry(
  industry: string | null | undefined,
): DefaultAssistantTask[] {
  return (getVertical(industry).taskPresets ?? []).map((task) => ({
    name: task.name,
    defaultDurationMinutes: task.minutes,
  }));
}

export const DEFAULT_ASSISTANT_TASKS: DefaultAssistantTask[] =
  getDefaultAssistantTasksForIndustry("hair_salon");
