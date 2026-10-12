import { z } from "zod";

const cents = z
  .number()
  .int("Must be a whole number of cents")
  .min(0, "Cannot be negative")
  .max(10_000_000, "Must be less than $100,000")
  .nullable()
  .optional();

const minutes = z
  .number()
  .int("Must be a whole number of minutes")
  .min(1, "Must be at least 1 minute")
  .max(480, "Must be 480 minutes or less")
  .nullable()
  .optional();

const baseShape = {
  staffId: z.string().uuid("Invalid staff ID"),
  serviceId: z.string().uuid("Invalid service ID"),
  /** Per-stylist overrides; null clears the override and restores the catalog default. */
  priceCents: cents,
  durationMinutes: z
    .number()
    .int("Duration must be a whole number")
    .min(5, "Duration must be at least 5 minutes")
    .max(480, "Duration must be 480 minutes or less")
    .nullable()
    .optional(),
  activeMinutes: minutes,
  processingMinutes: minutes,
  customName: z
    .string()
    .max(100, "Custom name must be 100 characters or less")
    .nullable()
    .optional(),
  /** Soft-hide. true = visible to clients, false = hidden but link preserved. */
  isOffered: z.boolean().optional(),
};

function validateProcessingPair(data: {
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  durationMinutes?: number | null;
}) {
  const hasActive = data.activeMinutes != null;
  const hasProcessing = data.processingMinutes != null;
  if (hasActive !== hasProcessing) return false;
  if (hasActive && hasProcessing && data.durationMinutes != null) {
    return (
      (data.activeMinutes! + data.processingMinutes!) <= data.durationMinutes
    );
  }
  return true;
}

export const setStaffServiceSchema = z.object(baseShape).refine(
  validateProcessingPair,
  {
    message:
      "If active or processing minutes is set, both must be set and their sum cannot exceed the override duration",
    path: ["activeMinutes"],
  },
);

export const removeStaffServiceSchema = z.object({
  staffId: z.string().uuid("Invalid staff ID"),
  serviceId: z.string().uuid("Invalid service ID"),
});

export const bulkSetStaffOfferingsSchema = z.object({
  staffId: z.string().uuid("Invalid staff ID"),
  serviceIds: z.array(z.string().uuid("Invalid service ID")),
});

export type SetStaffServiceInput = z.infer<typeof setStaffServiceSchema>;
export type RemoveStaffServiceInput = z.infer<typeof removeStaffServiceSchema>;
export type BulkSetStaffOfferingsInput = z.infer<
  typeof bulkSetStaffOfferingsSchema
>;
