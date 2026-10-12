import { z } from "zod";

export const setOverrideSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  serviceId: z.string().uuid("Invalid service ID"),
  durationMinutes: z
    .number()
    .int("Duration must be a whole number")
    .min(5, "Duration must be at least 5 minutes")
    .max(480, "Duration must be 480 minutes or less"),
  priceCents: z
    .number()
    .int("Price must be a whole number of cents")
    .min(0, "Price cannot be negative")
    .max(10_000_000, "Price must be less than $100,000")
    .nullable()
    .optional(),
}).partial({ durationMinutes: true }).refine(
  (data) => data.durationMinutes != null || data.priceCents != null,
  {
    message: "Add a custom duration or custom price",
    path: ["durationMinutes"],
  },
);

export const removeOverrideSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  serviceId: z.string().uuid("Invalid service ID"),
});

export type SetOverrideInput = z.infer<typeof setOverrideSchema>;
export type RemoveOverrideInput = z.infer<typeof removeOverrideSchema>;
