import { z } from "zod";
import { validateShifts } from "@/lib/scheduling/week";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MAX_SHIFTS_PER_DAY = 4;

const shiftSchema = z.object({
  startTime: z.string().regex(timeRegex, "Start time must be in HH:mm format"),
  endTime: z.string().regex(timeRegex, "End time must be in HH:mm format"),
  locationId: z.string().uuid("Invalid location ID"),
});

const shiftsSchema = z.array(shiftSchema).max(MAX_SHIFTS_PER_DAY, "At most 4 shifts per day");

const daySchema = z
  .object({
    dayOfWeek: z.number().int().min(0, "Day of week must be 0-6").max(6, "Day of week must be 0-6"),
    isEnabled: z.union([z.literal(0), z.literal(1)]),
    shifts: shiftsSchema,
  })
  .superRefine((day, ctx) => {
    if (day.isEnabled !== 1) return;
    if (day.shifts.length === 0) {
      ctx.addIssue({ code: "custom", message: "An open day needs at least one shift", path: ["shifts"] });
      return;
    }
    const problem = validateShifts(day.shifts);
    if (problem) {
      ctx.addIssue({
        code: "custom",
        message:
          problem === "order"
            ? "Each shift must end after it starts"
            : "Shifts on the same day can't overlap",
        path: ["shifts"],
      });
    }
  });

export const weeklyScheduleSchema = z.object({
  staffId: z.string().uuid("Invalid staff ID"),
  days: z
    .array(daySchema)
    .length(7, "Send all 7 days")
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, {
      message: "Each day of the week must appear once",
    }),
});

export const overrideSchema = z
  .object({
    staffId: z.string().uuid("Invalid staff ID"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    closed: z.boolean(),
    shifts: shiftsSchema,
    reason: z.string().max(200, "Note must be 200 characters or less").nullable().optional(),
  })
  .superRefine((o, ctx) => {
    if (o.closed) return;
    if (o.shifts.length === 0) {
      ctx.addIssue({ code: "custom", message: "Add at least one shift or mark the day closed", path: ["shifts"] });
      return;
    }
    if (validateShifts(o.shifts)) {
      ctx.addIssue({ code: "custom", message: "Shifts must end after they start and not overlap", path: ["shifts"] });
    }
  });

export type WeeklyScheduleInput = z.infer<typeof weeklyScheduleSchema>;
export type OverrideInput = z.infer<typeof overrideSchema>;
