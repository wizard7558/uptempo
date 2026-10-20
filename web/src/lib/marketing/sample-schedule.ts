export const DEMO_INDUSTRIES = ["barber", "nail_salon", "home_services"] as const;
export type DemoIndustry = (typeof DEMO_INDUSTRIES)[number];

export const DEMO_SERVICE_NAMES: Record<DemoIndustry, string> = {
  barber: "Skin fade",
  nail_salon: "Gel pedicure",
  home_services: "Deep clean",
};

const SLOT_TIMES: Record<DemoIndustry, string[]> = {
  barber: ["09:00", "09:45", "10:30", "13:15", "14:00", "16:30"],
  nail_salon: ["10:00", "11:15", "13:00", "14:30", "16:00"],
  home_services: ["08:00", "13:00"],
};

const DAYS_SHOWN = 21;

export type SampleSchedule = {
  today: string;
  dates: { date: string; hasSlots: boolean }[];
  slots: { time: string; isDoubleBook: false; doubleBookParentAppointmentId: null }[];
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fixed sample times for the marketing booking demo. Dates count forward from
 * `now` (UTC) so the month never looks stale; times are UTC wall-clock values,
 * which the demo renders with `businessTimezone="UTC"`.
 */
export function buildSampleSchedule(industry: DemoIndustry, now: Date): SampleSchedule {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dates = Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index + 1);
    const closed = day.getUTCDay() === 0 || index % 6 === 4;
    return { date: isoDate(day), hasSlots: !closed };
  });
  const first = dates.find((entry) => entry.hasSlots)!.date;
  return {
    today: isoDate(start),
    dates,
    slots: SLOT_TIMES[industry].map((time) => ({
      time: `${first}T${time}:00.000Z`,
      isDoubleBook: false,
      doubleBookParentAppointmentId: null,
    })),
  };
}
