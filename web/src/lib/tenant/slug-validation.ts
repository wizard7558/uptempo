import { z } from "zod";

const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "www",
  "book",
  "booking",
  "dashboard",
  "login",
  "signup",
  "register",
  "settings",
  "account",
  "billing",
  "help",
  "support",
  "docs",
  "blog",
  "status",
  "health",
  "static",
  "assets",
  "public",
  "private",
  "internal",
  "uptempo",
  "bookuptempo",
  // Keep the retired platform brand protected from tenant URL claims.
  "rende",
  "byrende",
  "emme",
  "test",
  "demo",
  "staging",
  "dev",
]);

export const slugSchema = z
  .string()
  .min(3, "Slug must be at least 3 characters")
  .max(50, "Slug must be at most 50 characters")
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "Slug must start with a letter and contain only lowercase letters, numbers, and hyphens",
  )
  .refine((s) => !s.endsWith("-"), "Slug must not end with a hyphen")
  .refine(
    (s) => !s.includes("--"),
    "Slug must not contain consecutive hyphens",
  )
  .refine((s) => !RESERVED_SLUGS.has(s), "This slug is reserved");

export function validateSlug(
  slug: string,
): { valid: boolean; error?: string } {
  const result = slugSchema.safeParse(slug);
  if (result.success) return { valid: true };
  return {
    valid: false,
    error: result.error.issues[0]?.message ?? "Invalid slug",
  };
}
