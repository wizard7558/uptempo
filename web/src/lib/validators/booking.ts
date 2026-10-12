import { z } from "zod";

export const createBookingSchema = z
  .object({
    staffId: z.string().uuid("Invalid staff ID"),
    clientId: z.string().uuid("Invalid client ID"),
    serviceIds: z.array(z.string().uuid("Invalid service ID")),
    startTime: z.string().datetime("Invalid start time"),
    locationId: z.string().uuid("Invalid location ID").nullable().optional(),
    isDoubleBook: z.boolean().optional(),
    doubleBookParentAppointmentId: z
      .string()
      .uuid("Invalid host appointment ID")
      .optional()
      .nullable(),
    /** Admin-only: bypass availability check and write isDoubleBook=1 with no parent. */
    allowOverlap: z.boolean().optional(),
    /** On-site jobs: one of the client's saved addresses. */
    serviceAddressId: z.string().uuid("Invalid address ID").nullable().optional(),
    /** Multi-session projects: the project this booking is a session of. */
    projectId: z.string().uuid("Invalid project ID").nullable().optional(),
    /** Claiming a waitlist offer ignores that offer's hold. */
    waitlistHoldId: z.string().uuid().optional(),
  })
  .refine((data) => data.serviceIds.length > 0, {
    message: "At least one service must be selected",
    path: ["serviceIds"],
  })
  .superRefine((data, ctx) => {
    if (data.isDoubleBook && !data.doubleBookParentAppointmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Flex booking requires a host appointment",
        path: ["doubleBookParentAppointmentId"],
      });
    }
    if (data.doubleBookParentAppointmentId && !data.isDoubleBook) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Host appointment is only valid for flex bookings",
        path: ["doubleBookParentAppointmentId"],
      });
    }
  });

export const rescheduleBookingSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointment ID"),
  newStartTime: z.string().datetime("Invalid start time"),
  newStaffId: z.string().uuid("Invalid staff ID").optional(),
  newLocationId: z.string().uuid("Invalid location ID").nullable().optional(),
  notifyClient: z.boolean().optional(),
});

export const cancelBookingSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointment ID"),
  reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
});

export const updateAppointmentServicesSchema = z
  .object({
    appointmentId: z.string().uuid("Invalid appointment ID"),
    serviceIds: z.array(z.string().uuid("Invalid service ID")),
  })
  .refine((data) => data.serviceIds.length > 0, {
    message: "At least one service must be selected",
    path: ["serviceIds"],
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type UpdateAppointmentServicesInput = z.infer<typeof updateAppointmentServicesSchema>;
