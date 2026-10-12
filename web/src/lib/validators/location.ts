import { z } from "zod";

const locationBaseSchema = z.object({
  name: z
    .string()
    .min(1, "Location name is required")
    .max(120, "Location name must be 120 characters or less"),
  address: z
    .string()
    .max(500, "Address must be 500 characters or less")
    .nullable()
    .optional(),
  isActive: z
    .number()
    .int()
    .refine((value) => value === 0 || value === 1, "isActive must be 0 or 1")
    .optional(),
});

export const createLocationSchema = locationBaseSchema;

export const updateLocationSchema = locationBaseSchema.partial().extend({
  id: z.string().uuid("Invalid location ID"),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
