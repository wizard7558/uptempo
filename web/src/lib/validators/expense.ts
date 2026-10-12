import { z } from "zod";

/** Categories are per tenant (slug stored on the expense); existence is checked in the action. */
export const expenseCategorySchema = z.string().trim().min(1).max(80);

export const expenseBaseSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expense date is required"),
  vendorName: z
    .string()
    .trim()
    .min(1, "Vendor name is required")
    .max(200, "Vendor name must be 200 characters or less"),
  category: expenseCategorySchema,
  amountCents: z
    .number()
    .int("Amount must be a whole number of cents")
    .min(0, "Amount cannot be negative")
    .max(10_000_000, "Amount must be less than $100,000"),
});

export const createExpenseSchema = expenseBaseSchema;

export const updateExpenseSchema = expenseBaseSchema.extend({
  id: z.string().uuid("Invalid expense ID"),
});

export const expenseFiltersSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date")
    .optional(),
  category: expenseCategorySchema.or(z.literal("all")).optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseFiltersInput = z.infer<typeof expenseFiltersSchema>;
