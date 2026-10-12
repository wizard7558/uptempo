import { z } from "zod";

/**
 * Empty strings from form inputs should resolve to null (clear the field),
 * not fail email validation. Preprocess catches "" before validation runs.
 */
const emailField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .max(254, "Email must be 254 characters or less")
    .email("Invalid email address")
    .nullable()
    .optional(),
);

const phoneField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .max(50, "Phone must be 50 characters or less")
    .nullable()
    .optional(),
);

export const createStaffSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name must be 100 characters or less"),
  email: emailField,
  phone: phoneField,
  serviceIds: z.array(z.string().uuid("Invalid service ID")).optional(),
});

export const updateStaffSchema = z.object({
  id: z.string().uuid("Invalid staff ID"),
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name must be 100 characters or less")
    .optional(),
  email: emailField,
  phone: phoneField,
  photoUrl: z.string().url("Invalid photo URL").nullable().optional(),
  defaultAssistantId: z.string().uuid("Invalid assistant").nullable().optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
