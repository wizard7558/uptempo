import { z } from "zod";

export const taskCatalogSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  defaultDurationMinutes: z
    .number()
    .min(5, "Duration must be at least 5 minutes")
    .max(120, "Duration cannot exceed 120 minutes"),
});

export const assignTaskSchema = z
  .object({
    /** Null/omitted = standalone task (no client appointment context). */
    appointmentId: z
      .string()
      .uuid("Invalid appointment ID")
      .nullable()
      .optional(),
    assignedTo: z.string().uuid("Invalid assistant ID"),
    taskTypeId: z.string().uuid("Invalid task type ID").optional(),
    taskName: z.string().min(1, "Task name is required").max(100, "Task name too long"),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    notes: z.string().optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

export const updateTaskSchema = z.object({
  id: z.string().uuid("Invalid task ID"),
  taskName: z.string().min(1).max(100).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  status: z
    .enum(["pending", "in-progress", "completed", "cancelled"])
    .optional(),
  notes: z.string().optional(),
});
