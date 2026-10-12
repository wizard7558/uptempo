import { z } from "zod";

const serviceBaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  description: z
    .string()
    .max(2000, "Description must be 2000 characters or less")
    .nullable()
    .optional(),
  defaultDurationMinutes: z
    .number()
    .int("Duration must be a whole number")
    .min(5, "Duration must be at least 5 minutes")
    .max(480, "Duration must be 480 minutes or less"),
  activeMinutes: z
    .number()
    .int("Active minutes must be a whole number")
    .min(1, "Active minutes must be at least 1")
    .max(480, "Active minutes must be 480 or less")
    .nullable()
    .optional(),
  processingMinutes: z
    .number()
    .int("Processing minutes must be a whole number")
    .min(1, "Processing minutes must be at least 1")
    .max(480, "Processing minutes must be 480 or less")
    .nullable()
    .optional(),
  priceCents: z
    .number()
    .int("Price must be a whole number of cents")
    .min(0, "Price cannot be negative")
    .max(10_000_000, "Price must be less than $100,000")
    .nullable()
    .optional(),
  costCents: z
    .number()
    .int("Cost must be a whole number of cents")
    .min(0, "Cost cannot be negative")
    .max(10_000_000, "Cost must be less than $100,000")
    .nullable()
    .optional(),
  // Category is a slug referencing a (default or salon-defined) service category.
  category: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Invalid category")
    .default("other"),
  /** 1 = clients can self-book online; 0 = internal-only (staff books it). */
  onlineBookable: z.number().int().min(0).max(1).optional(),
  /** Who may self-book online: everyone, first-time clients, or returning clients. */
  bookingAudience: z.enum(["all", "new", "returning"]).optional(),
  /** How the price renders on the public booking page. */
  priceDisplay: z.enum(["show", "starting", "hidden"]).default("show"),
  /** Per-service deposit override. null = inherit the salon's global deposit rule. */
  depositType: z.enum(["none", "percent", "fixed"]).nullable().optional(),
  depositAmount: z
    .number()
    .int("Deposit must be a whole number")
    .min(0, "Deposit cannot be negative")
    .max(10_000_000, "Deposit must be less than $100,000")
    .nullable()
    .optional(),
  assistantWorkflow: z
    .number()
    .int()
    .min(0)
    .max(1)
    .optional(),
  assistantTaskTypeId: z.string().uuid("Invalid task type").nullable().optional(),
  /** Prep time kept free before the service (minutes). */
  bufferBeforeMin: z.number().int("Prep time must be a whole number").min(0).max(240).optional(),
  /** Cleanup time kept free after the service (minutes). */
  bufferAfterMin: z.number().int("Cleanup time must be a whole number").min(0).max(240).optional(),
  /** Minimum notice in minutes. null = use the business setting. */
  minNoticeMin: z.number().int().min(0).max(20160).nullable().optional(),
  /** How many days ahead this can be booked. null = use the business setting. */
  maxAdvanceDays: z.number().int().min(1).max(730).nullable().optional(),
  /** Start times every N minutes. null = use the business setting. */
  slotIntervalMin: z
    .union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(20),
      z.literal(30),
      z.literal(60),
    ])
    .nullable()
    .optional(),
  locationType: z.enum(["in_studio", "virtual", "on_site"]).optional(),
  /** This service is a version of another service. */
  variantOfServiceId: z.string().uuid("Invalid service").nullable().optional(),
  /** 1 = runs as a group class (the classes module). */
  isClass: z.number().int().min(0).max(1).optional(),
  /** Default spots per class, 1-100. Required when isClass is 1. */
  classCapacity: z
    .number()
    .int("Spots must be a whole number")
    .min(1, "Spots per class must be at least 1")
    .max(100, "Spots per class must be 100 or fewer")
    .nullable()
    .optional(),
});

function validateClass(data: { isClass?: number; classCapacity?: number | null }) {
  return data.isClass !== 1 || data.classCapacity != null;
}

const classMessage = {
  message: "Spots per class is required for a class",
  path: ["classCapacity"] as string[],
};

function validateDeposit(data: {
  depositType?: "none" | "percent" | "fixed" | null;
  depositAmount?: number | null;
}) {
  if (data.depositType === "percent") {
    return data.depositAmount != null && data.depositAmount >= 1 && data.depositAmount <= 100;
  }
  if (data.depositType === "fixed") {
    return data.depositAmount != null && data.depositAmount >= 1;
  }
  // 'none' or null (inherit) — no amount required
  return true;
}

const depositMessage = {
  message:
    "Percent deposits must be 1–100; fixed deposits need an amount in cents",
  path: ["depositAmount"] as string[],
};

function validateProcessingTime(data: {
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  defaultDurationMinutes?: number;
}) {
  const hasActive = data.activeMinutes != null;
  const hasProcessing = data.processingMinutes != null;
  // Both must be set or both must be unset
  if (hasActive !== hasProcessing) return false;
  // If both set, their sum must not exceed total duration
  if (hasActive && hasProcessing && data.defaultDurationMinutes != null) {
    return (data.activeMinutes! + data.processingMinutes!) <= data.defaultDurationMinutes;
  }
  return true;
}

const processingTimeMessage = {
  message: "If active or processing time is set, both must be set and their sum must not exceed total duration",
  path: ["activeMinutes"] as string[],
};

export const createServiceSchema = serviceBaseSchema
  .refine(validateProcessingTime, processingTimeMessage)
  .refine(validateDeposit, depositMessage)
  .refine(validateClass, classMessage);

export const updateServiceSchema = serviceBaseSchema
  .partial()
  .extend({
    id: z.string().uuid("Invalid service ID"),
  })
  .refine(validateProcessingTime, processingTimeMessage)
  .refine(validateDeposit, depositMessage)
  .refine(validateClass, classMessage)
  .refine((data) => data.variantOfServiceId == null || data.variantOfServiceId !== data.id, {
    message: "A service can't be a version of itself",
    path: ["variantOfServiceId"],
  });

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
