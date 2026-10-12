import { z } from "zod";

export const SLOT_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60] as const;

export const bookingRulesSchema = z.object({
  sameDayBooking: z.union([z.literal(0), z.literal(1)]),
  minNoticeMinutes: z.number().int().min(0).max(20160),
  maxAdvanceDays: z.number().int().min(1).max(730),
  slotIntervalMinutes: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
    z.literal(60),
  ]),
});

export type BookingRules = z.infer<typeof bookingRulesSchema>;
