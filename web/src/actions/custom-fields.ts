"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/rbac";
import {
  createDefinition,
  ensureCustomFieldDefinitions,
  listDefinitions,
  moveDefinition,
  updateDefinition,
  writeEntityAttributes,
} from "@/lib/custom-fields/service";
import {
  FIELD_ENTITIES,
  FIELD_TYPES,
  type FieldDef,
  type FieldEntity,
  type FieldType,
} from "@/lib/custom-fields/values";
import { getT } from "@/lib/terms/server";

const ADMIN = ["owner", "admin"] as const;
const TEAM = ["owner", "admin", "provider", "assistant"] as const;
const RECORD_EDITORS = ["owner", "admin", "provider"] as const;

const entitySchema = z.enum(FIELD_ENTITIES);
const typeSchema = z.enum(FIELD_TYPES);
const uuidSchema = z.string().uuid();

type Failure = { ok: false; error: string };

const OWNER_PATH: Record<FieldEntity, (id: string) => string> = {
  client: (id) => `/clients/${id}`,
  appointment: (id) => `/appointments/${id}`,
  project: (id) => `/projects/${id}`,
  request: (id) => `/requests/${id}`,
};

async function failure(slug: string, code: "invalid" | "duplicate" | "optionsRequired" | "notFound"): Promise<Failure> {
  const t = await getT("errors", slug);
  return { ok: false, error: t(`customFields.${code}`) };
}

export async function listCustomFieldDefinitions(
  entity?: FieldEntity,
  options?: { includeInactive?: boolean },
): Promise<FieldDef[]> {
  const auth = await requireStaff(...TEAM);
  if (entity !== undefined && !entitySchema.safeParse(entity).success) return [];
  await ensureCustomFieldDefinitions(auth.tenantSlug);
  return listDefinitions(auth.tenantSlug, entity, options);
}

export async function createCustomFieldDefinition(input: {
  entity: FieldEntity;
  label: string;
  type: FieldType;
  options: string[];
  showOnCard: boolean;
  clientEditable: boolean;
}): Promise<{ ok: true; id: string } | Failure> {
  const auth = await requireStaff(...ADMIN);
  const parsed = z
    .object({
      entity: entitySchema,
      label: z.string(),
      type: typeSchema,
      options: z.array(z.string()).max(50),
      showOnCard: z.boolean(),
      clientEditable: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return failure(auth.tenantSlug, "invalid");
  const created = await createDefinition(auth.tenantSlug, parsed.data);
  if (!created.ok) return failure(auth.tenantSlug, created.error);
  revalidatePath("/settings/custom-fields");
  return created;
}

export async function updateCustomFieldDefinition(input: {
  id: string;
  label?: string;
  options?: string[];
  showOnCard?: boolean;
  clientEditable?: boolean;
  isActive?: boolean;
}): Promise<{ ok: true } | Failure> {
  const auth = await requireStaff(...ADMIN);
  const parsed = z
    .object({
      id: uuidSchema,
      label: z.string().optional(),
      options: z.array(z.string()).max(50).optional(),
      showOnCard: z.boolean().optional(),
      clientEditable: z.boolean().optional(),
      isActive: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return failure(auth.tenantSlug, "invalid");
  const updated = await updateDefinition(auth.tenantSlug, parsed.data);
  if (!updated.ok) return failure(auth.tenantSlug, updated.error === "notFound" ? "notFound" : updated.error);
  revalidatePath("/settings/custom-fields");
  return updated;
}

export async function moveCustomFieldDefinition(input: {
  id: string;
  direction: "up" | "down";
}): Promise<{ ok: true } | Failure> {
  const auth = await requireStaff(...ADMIN);
  const parsed = z
    .object({
      id: uuidSchema,
      direction: z.enum(["up", "down"]),
    })
    .safeParse(input);
  if (!parsed.success) return failure(auth.tenantSlug, "invalid");
  const moved = await moveDefinition(auth.tenantSlug, parsed.data);
  if (!moved.ok) return failure(auth.tenantSlug, "notFound");
  revalidatePath("/settings/custom-fields");
  return moved;
}

export async function setEntityAttributes(input: {
  entity: FieldEntity;
  ownerId: string;
  values: Record<string, unknown>;
}): Promise<{ ok: true } | Failure> {
  const entity = entitySchema.safeParse(input?.entity);
  const roles = entity.success && entity.data === "appointment" ? TEAM : RECORD_EDITORS;
  const auth = await requireStaff(...roles);
  const ownerId = uuidSchema.safeParse(input?.ownerId);
  if (!entity.success || !ownerId.success || !input?.values || typeof input.values !== "object" || Array.isArray(input.values)) {
    return failure(auth.tenantSlug, "invalid");
  }
  const written = await writeEntityAttributes(auth.tenantSlug, entity.data, ownerId.data, input.values);
  if (!written.ok) return failure(auth.tenantSlug, written.error === "notFound" ? "notFound" : "invalid");
  revalidatePath(OWNER_PATH[entity.data](ownerId.data));
  return { ok: true };
}
