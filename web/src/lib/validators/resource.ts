import { z } from "zod";

export const RESOURCE_KINDS = ["room", "chair", "station", "equipment", "vehicle"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const kindSchema = z.enum(RESOURCE_KINDS);
const flag = z
  .number()
  .int()
  .refine((v) => v === 0 || v === 1, "Must be 0 or 1");

export const createResourcesSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or less"),
  kind: kindSchema,
  locationId: z.string().uuid("Invalid location ID").nullable(),
  capacity: z.number().int().min(1).max(500),
  /** How many copies to add. Several are numbered "Name 1", "Name 2", ... */
  count: z.number().int().min(1).max(20),
});

export const updateResourceSchema = z.object({
  id: z.string().uuid("Invalid resource ID"),
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  kind: kindSchema.optional(),
  locationId: z.string().uuid("Invalid location ID").nullable().optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  isActive: flag.optional(),
});

/** One thing a service needs: a type of resource or one specific resource. */
export const serviceNeedSchema = z
  .object({
    resourceKind: kindSchema.nullable(),
    resourceId: z.string().uuid("Invalid resource ID").nullable(),
    quantity: z.number().int().min(1).max(20),
    /** Minutes after the start of the service. */
    offsetMin: z.number().int().min(0).max(1440),
    /** null = for the whole service. */
    durationMin: z.number().int().min(1).max(1440).nullable(),
  })
  .refine((n) => (n.resourceKind === null) !== (n.resourceId === null), {
    message: "A need is either a type or one specific resource",
  });

export const setServiceNeedsSchema = z.object({
  serviceId: z.string().uuid("Invalid service ID"),
  needs: z.array(serviceNeedSchema).max(20),
});

export type CreateResourcesInput = z.infer<typeof createResourcesSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
export type ServiceNeedInput = z.infer<typeof serviceNeedSchema>;
