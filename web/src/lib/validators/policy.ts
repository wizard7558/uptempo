import { z } from "zod";
import { isValidTimeZone } from "@/lib/utils/timezone";

export const updatePolicySchema = z.object({
  timezone: z
    .string()
    .min(1, "Timezone is required")
    .refine(isValidTimeZone, "Timezone must be a valid IANA timezone")
    .optional(),
  cancellationWindowHours: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .max(168, "Must be 168 hours or less")
    .optional(),
  cancellationFeePercent: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .max(100, "Must be 100 or less")
    .optional(),
  noShowFeePercent: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .max(100, "Must be 100 or less")
    .optional(),
  requireCardOnFile: z
    .number()
    .int()
    .min(0)
    .max(1)
    .optional(),
  policyText: z
    .string()
    .max(20_000, "Policies are limited to 20,000 characters")
    .nullable()
    .optional(),
  onlineBookingAudience: z
    .enum(["both", "existing_only", "new_only"])
    .optional(),
  depositEnabled: z.number().int().min(0).max(1).optional(),
  depositDefaultType: z.enum(["percent", "fixed"]).optional(),
  depositDefaultAmount: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .max(10_000_000, "Must be less than $100,000")
    .optional(),
  depositDurationThresholdMinutes: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .max(1440, "Must be 1440 minutes or less")
    .nullable()
    .optional(),
});

export const updatePaymentMethodsSchema = z.object({
  applePayEnabled: z.number().int().min(0).max(1).optional(),
  googlePayEnabled: z.number().int().min(0).max(1).optional(),
  afterpayEnabled: z.number().int().min(0).max(1).optional(),
  cashappEnabled: z.number().int().min(0).max(1).optional(),
});

export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type UpdatePaymentMethodsInput = z.infer<typeof updatePaymentMethodsSchema>;
