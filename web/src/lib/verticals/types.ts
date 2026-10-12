import { z } from "zod";

export const VERTICAL_IDS = [
  "hair_salon",
  "barber",
  "nail_salon",
  "tattoo",
  "massage_wellness",
  "personal_training",
  "home_services",
  "general",
] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];

export const MODULE_IDS = [
  "resources",
  "booking_groups",
  "processing_time",
  "assistant_tasks",
  "requests",
  "on_site",
  "projects",
  "consent_id",
  "classes",
  "packages",
  "memberships",
  "recurring",
  "walk_in_queue",
  "slot_waitlist",
  "gift_cards",
  "attachments",
  "storefront",
  "aftercare",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const BOOKING_FLOWS = ["book", "request", "class", "queue"] as const;
export type BookingFlow = (typeof BOOKING_FLOWS)[number];

export type Term = { one: string; other: string };

export type VerticalTerms = {
  staff: Term;
  customer: Term;
  booking: Term;
  offering: Term;
  place: Term;
  prepaidBalance: string;
};

export type ServiceTemplate = {
  name: string;
  /** Category slug; must exist in the pack's `categories`. */
  category: string;
  minutes: number;
  /** USD cents. */
  priceCents: number;
  activeMinutes?: number;
  processingMinutes?: number;
  deposit?: { type: "fixed" | "percent"; amount: number };
  description?: string;
  isAddon?: boolean;
  isClass?: boolean;
  capacity?: number;
};

export type ClientField = {
  key: string;
  label: string;
  type: "text" | "select" | "multi" | "date" | "number" | "boolean";
  options?: (string | { value: string; label: string })[];
  clientEditable?: boolean;
  matchProductTags?: boolean;
  showOnCard?: boolean;
};

export type Vertical = {
  id: VerticalId;
  label: string;
  description: string;
  terms: VerticalTerms;
  modules: ModuleId[];
  bookingFlow: BookingFlow;
  categories: { slug: string; name: string }[];
  serviceTemplates: ServiceTemplate[];
  expenseCategories: string[];
  taskPresets?: { name: string; minutes: number }[];
  requestFields?: string[];
  clientFields: ClientField[];
  defaults: {
    bufferAfterMinutes: number;
    minNoticeHours: number;
    maxAdvanceDays: number;
    slotIntervalMinutes: number;
  };
};

const termSchema = z.object({ one: z.string().min(1), other: z.string().min(1) });

export const serviceTemplateSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  minutes: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  activeMinutes: z.number().int().positive().optional(),
  processingMinutes: z.number().int().positive().optional(),
  deposit: z
    .object({
      type: z.enum(["fixed", "percent"]),
      amount: z.number().nonnegative(),
    })
    .optional(),
  description: z.string().optional(),
  isAddon: z.boolean().optional(),
  isClass: z.boolean().optional(),
  capacity: z.number().int().positive().optional(),
});

export const clientFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "select", "multi", "date", "number", "boolean"]),
  options: z
    .array(z.union([z.string().min(1), z.object({ value: z.string().min(1), label: z.string().min(1) })]))
    .optional(),
  clientEditable: z.boolean().optional(),
  matchProductTags: z.boolean().optional(),
  showOnCard: z.boolean().optional(),
});

export const verticalSchema = z.object({
  id: z.enum(VERTICAL_IDS),
  label: z.string().min(1),
  description: z.string().min(1),
  terms: z.object({
    staff: termSchema,
    customer: termSchema,
    booking: termSchema,
    offering: termSchema,
    place: termSchema,
    prepaidBalance: z.string().min(1),
  }),
  modules: z.array(z.enum(MODULE_IDS)),
  bookingFlow: z.enum(BOOKING_FLOWS),
  categories: z.array(z.object({ slug: z.string().min(1), name: z.string().min(1) })).min(1),
  serviceTemplates: z.array(serviceTemplateSchema),
  expenseCategories: z.array(z.string().min(1)).min(1),
  taskPresets: z
    .array(z.object({ name: z.string().min(1), minutes: z.number().int().positive() }))
    .optional(),
  requestFields: z.array(z.string().min(1)).optional(),
  clientFields: z.array(clientFieldSchema),
  defaults: z.object({
    bufferAfterMinutes: z.number().int().nonnegative(),
    minNoticeHours: z.number().int().nonnegative(),
    maxAdvanceDays: z.number().int().positive(),
    slotIntervalMinutes: z.number().int().positive(),
  }),
});

/** Validates a vertical definition at module load and returns it typed. */
export function defineVertical(v: Vertical): Vertical {
  verticalSchema.parse(v);
  return v;
}
