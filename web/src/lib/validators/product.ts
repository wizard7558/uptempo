import { z } from "zod";

const MAX_PRICE_CENTS = 1_000_00; // $1,000 sanity cap

/** Empty string → null; otherwise trimmed. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullish()
    .transform((v) => v ?? null);

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  brand: optionalText(100),
  description: optionalText(2000),
  size: optionalText(100),
  priceCents: z
    .number({ message: "Enter a price" })
    .int()
    .min(0)
    .max(MAX_PRICE_CENTS),
  costCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullish(),
  photoUrl: optionalText(2000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export const updateProductSchema = createProductSchema
  .partial()
  .extend({ id: z.string().uuid() });

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;
