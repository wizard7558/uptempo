import { z } from "zod";

// Field type definitions for form builder
export const formFieldSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "checkbox", "signature", "date"]),
  label: z.string().min(1),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const FORM_KINDS = ["intake", "waiver", "consent", "health_history", "par_q"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/** How long uploaded ID photos are kept (matches the CHECK on business_settings.id_retention_days). */
export const ID_RETENTION_DAYS = [30, 90, 180, 365, 730] as const;
export const idRetentionSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.literal(365),
  z.literal(730),
]);

// Form template create/update
export const createFormTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  fields: z.array(formFieldSchema).min(1, "At least one field is required"),
  serviceIds: z.array(z.string().uuid()).optional(),
  kind: z.enum(FORM_KINDS).optional(),
  /** Consent forms: minimum age, 13 to 99. Null means no age gate. */
  minAge: z.number().int().min(13).max(99).nullable().optional(),
  /** 1 when the client must add a photo ID. */
  requiresId: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const updateFormTemplateSchema = createFormTemplateSchema
  .partial()
  .extend({
    id: z.string().uuid(),
    isActive: z.number().min(0).max(1).optional(),
  });

// Form response submission (from client)
export const formSubmissionSchema = z.object({
  formResponseId: z.string().uuid(),
  /** HMAC link token. The action checks it matches formResponseId. */
  token: z.string().min(1),
  responses: z.record(
    z.string(),
    z.union([z.string(), z.boolean(), z.null()]),
  ),
  /** Consent forms: "YYYY-MM-DD". */
  dob: z.string().max(10).optional(),
});

// Aftercare template create/update
export const createAftercareTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  productRecommendations: z.string().max(2000).optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
});

export const updateAftercareTemplateSchema = createAftercareTemplateSchema
  .partial()
  .extend({
    id: z.string().uuid(),
    isActive: z.number().min(0).max(1).optional(),
  });
