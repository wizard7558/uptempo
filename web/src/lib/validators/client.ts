import { z } from "zod";

export const createClientSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
    email: z.string().email("Invalid email address").nullable().optional(),
    phone: z.string().min(7, "Phone must be at least 7 characters").max(20, "Phone must be 20 characters or less").nullable().optional(),
  })
  .refine(
    (data) => {
      const hasEmail = data.email !== null && data.email !== undefined && data.email !== "";
      const hasPhone = data.phone !== null && data.phone !== undefined && data.phone !== "";
      return hasEmail || hasPhone;
    },
    { message: "At least one of email or phone must be provided" }
  );

export const findClientSchema = z
  .object({
    email: z.string().email("Invalid email address").optional(),
    phone: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasEmail = data.email !== undefined && data.email !== "";
      const hasPhone = data.phone !== undefined && data.phone !== "";
      return hasEmail || hasPhone;
    },
    { message: "At least one of email or phone must be provided" }
  );

export const updateClientSchema = z
  .object({
    clientId: z.string().uuid("Invalid client ID"),
    name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
    email: z.string().email("Invalid email address").nullable().optional(),
    phone: z.string().min(7, "Phone must be at least 7 characters").max(20, "Phone must be 20 characters or less").nullable().optional(),
    notes: z.string().max(5000, "Notes must be 5000 characters or less").nullable().optional(),
    updatedAt: z.string(),
  })
  .refine(
    (data) => {
      const hasEmail = data.email !== null && data.email !== undefined && data.email !== "";
      const hasPhone = data.phone !== null && data.phone !== undefined && data.phone !== "";
      return hasEmail || hasPhone;
    },
    { message: "At least one of email or phone must be provided" }
  );

export const serviceNoteSchema = z.object({
  appointmentServiceId: z.string().uuid("Invalid appointment service ID"),
  notes: z.string().max(5000, "Notes must be 5000 characters or less").nullable(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type FindClientInput = z.infer<typeof findClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ServiceNoteInput = z.infer<typeof serviceNoteSchema>;
