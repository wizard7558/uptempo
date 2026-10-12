import { z } from "zod";

const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

export const updateBrandingSchema = z.object({
  primaryColor: z
    .string()
    .regex(hexColorRegex, "Must be a valid hex color (#RRGGBB)")
    .optional(),
  accentColor: z
    .string()
    .regex(hexColorRegex, "Must be a valid hex color (#RRGGBB)")
    .optional(),
  logoUrl: z
    .string()
    .url("Must be a valid URL")
    .startsWith("https://", { message: "Logo URL must use HTTPS" })
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  fontPreference: z.enum(["system", "serif", "sans-serif"]).optional(),
  brandColor: z
    .string()
    .regex(hexColorRegex, "Must be a valid hex color (#RRGGBB)")
    .optional(),
  fontPairing: z.enum(["score", "sans"]).optional(),
  cornerStyle: z.enum(["square", "soft", "round"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  colorMode: z.enum(["light", "dark"]).optional(),
  showPoweredBy: z.number().int().min(0).max(1).optional(),
});

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
