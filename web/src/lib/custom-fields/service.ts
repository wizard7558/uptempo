import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { withTenantDb, type TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { getVertical } from "@/lib/verticals";
import {
  FIELD_ENTITIES,
  FIELD_TYPES,
  fieldKeyFromLabel,
  normalizeFieldOptions,
  validateAttributeValues,
  type FieldDef,
  type FieldEntity,
  type FieldOption,
  type FieldType,
} from "./values";

type DefinitionTable = TenantTables["customFieldDefinitions"];
type AttributeTable =
  | TenantTables["clients"]
  | TenantTables["appointments"]
  | TenantTables["projects"]
  | TenantTables["bookingRequests"];

function isEntity(value: string): value is FieldEntity {
  return (FIELD_ENTITIES as readonly string[]).includes(value);
}

function isType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

function bit(value: number | null | undefined): boolean {
  return value === 1;
}

function toDef(row: {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  options: unknown;
  isActive: number;
  showOnCard: number;
  clientEditable: number;
  matchProductTags: number;
  sort: number;
}): FieldDef | null {
  if (!isEntity(row.entity) || !isType(row.type)) return null;
  const options = normalizeFieldOptions(
    Array.isArray(row.options) ? (row.options as (string | FieldOption)[]) : [],
  );
  return {
    id: row.id,
    entity: row.entity,
    key: row.key,
    label: row.label,
    type: row.type,
    options,
    isActive: bit(row.isActive),
    showOnCard: bit(row.showOnCard),
    clientEditable: bit(row.clientEditable),
    matchProductTags: bit(row.matchProductTags),
    sort: row.sort,
  };
}

export function attributeColumnFor(tables: TenantTables, entity: FieldEntity): AttributeTable {
  if (entity === "client") return tables.clients;
  if (entity === "appointment") return tables.appointments;
  if (entity === "project") return tables.projects;
  return tables.bookingRequests;
}

export function attributeFilterSql(
  col: AnyColumn,
  def: Pick<FieldDef, "key" | "type">,
  value: string,
): SQL {
  const payload =
    def.type === "multi"
      ? { [def.key]: [value] }
      : def.type === "boolean"
        ? { [def.key]: value === "true" }
        : { [def.key]: value };
  return sql`${col} @> ${JSON.stringify(payload)}::jsonb`;
}

const FILTERABLE_TYPES = new Set<FieldDef["type"]>(["select", "multi", "boolean"]);

/** Select, multi, and boolean fields can narrow a list. Other types do not. */
export function attributeFilterFor(
  defs: FieldDef[],
  column: AnyColumn,
  filter?: { key: string; value: string },
): SQL | undefined {
  if (!filter?.key || filter.value === "") return undefined;
  const def = defs.find((item) => item.isActive && item.key === filter.key && FILTERABLE_TYPES.has(item.type));
  if (!def) return undefined;
  return attributeFilterSql(column, def, filter.value);
}

async function readDefs(
  db: TenantDb,
  table: DefinitionTable,
  entity?: FieldEntity,
  includeInactive = false,
): Promise<FieldDef[]> {
  const filters = [];
  if (entity) filters.push(eq(table.entity, entity));
  if (!includeInactive) filters.push(eq(table.isActive, 1));
  const rows = await db
    .select()
    .from(table)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(table.sort), asc(table.label));
  return rows.flatMap((row) => {
    const def = toDef(row);
    return def ? [def] : [];
  });
}

export async function listDefinitions(
  slug: string,
  entity?: FieldEntity,
  options?: { includeInactive?: boolean },
): Promise<FieldDef[]> {
  return withTenantDb(slug, async (db, tables) =>
    readDefs(db, tables.customFieldDefinitions, entity, options?.includeInactive),
  );
}

export async function ensureCustomFieldDefinitions(slug: string): Promise<void> {
  const [tenant] = await publicDb
    .select({ industry: tenants.industry })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  const fields = getVertical(tenant?.industry).clientFields;
  await withTenantDb(slug, async (db, tables) => {
    const table = tables.customFieldDefinitions;
    const [existing] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.isDefault, 1))
      .limit(1);
    if (existing || fields.length === 0) return;
    await db
      .insert(table)
      .values(
        fields.map((field, index) => ({
          entity: "client" as const,
          key: field.key,
          label: field.label,
          type: field.type,
          options: normalizeFieldOptions(field.options ?? []),
          sort: (index + 1) * 10,
          isDefault: 1,
          isActive: 1,
          showOnCard: field.showOnCard === false ? 0 : 1,
          clientEditable: field.clientEditable ? 1 : 0,
          matchProductTags: field.matchProductTags ? 1 : 0,
        })),
      )
      .onConflictDoUpdate({
        target: [table.entity, table.key],
        set: { isDefault: 1 },
      });
  });
}

function optionValues(labels: string[], existing: FieldOption[]): FieldOption[] {
  const byLabel = new Map(existing.map((option) => [option.label, option]));
  const taken = new Set(existing.map((option) => option.value));
  const out: FieldOption[] = [];
  for (const label of labels) {
    const kept = byLabel.get(label);
    if (kept && !out.some((option) => option.value === kept.value)) {
      out.push(kept);
      continue;
    }
    const value = fieldKeyFromLabel(label, taken);
    taken.add(value);
    out.push({ value, label });
  }
  return out;
}

export async function createDefinition(
  slug: string,
  input: {
    entity: FieldEntity;
    label: string;
    type: FieldType;
    options: string[];
    showOnCard: boolean;
    clientEditable: boolean;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: "duplicate" | "invalid" | "optionsRequired" }> {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 60) return { ok: false, error: "invalid" };
  const choiceLabels = input.options.map((option) => option.trim()).filter(Boolean);
  if ((input.type === "select" || input.type === "multi") && choiceLabels.length === 0) {
    return { ok: false, error: "optionsRequired" };
  }
  if (choiceLabels.length > 50) return { ok: false, error: "invalid" };

  try {
    return await withTenantDb(slug, async (db, tables) => {
      const table = tables.customFieldDefinitions;
      const rows = await db
        .select({ key: table.key, sort: table.sort })
        .from(table)
        .where(eq(table.entity, input.entity));
      const taken = new Set(rows.map((row) => row.key));
      const key = fieldKeyFromLabel(label, taken);
      const sort = rows.reduce((max, row) => Math.max(max, row.sort), 0) + 10;
      const [created] = await db
        .insert(table)
        .values({
          entity: input.entity,
          key,
          label,
          type: input.type,
          options: optionValues(choiceLabels, []),
          sort,
          isActive: 1,
          isDefault: 0,
          showOnCard: input.showOnCard ? 1 : 0,
          clientEditable: input.entity === "client" && input.clientEditable ? 1 : 0,
          matchProductTags: 0,
        })
        .returning({ id: table.id });
      return { ok: true as const, id: created.id };
    });
  } catch (err) {
    if (pgErrorInfo(err).code === "23505") return { ok: false, error: "duplicate" };
    throw err;
  }
}

export async function updateDefinition(
  slug: string,
  input: {
    id: string;
    label?: string;
    options?: string[];
    showOnCard?: boolean;
    clientEditable?: boolean;
    isActive?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: "notFound" | "invalid" | "optionsRequired" }> {
  return withTenantDb(slug, async (db, tables) => {
    const table = tables.customFieldDefinitions;
    const [row] = await db.select().from(table).where(eq(table.id, input.id)).limit(1);
    const current = row ? toDef(row) : null;
    if (!current) return { ok: false, error: "notFound" };

    const patch: Partial<typeof table.$inferInsert> = { updatedAt: new Date() };
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (label.length < 1 || label.length > 60) return { ok: false, error: "invalid" };
      patch.label = label;
    }
    if (input.options !== undefined) {
      const choiceLabels = input.options.map((option) => option.trim()).filter(Boolean);
      if ((current.type === "select" || current.type === "multi") && choiceLabels.length === 0) {
        return { ok: false, error: "optionsRequired" };
      }
      if (choiceLabels.length > 50) return { ok: false, error: "invalid" };
      patch.options = optionValues(choiceLabels, current.options);
    }
    if (input.showOnCard !== undefined) patch.showOnCard = input.showOnCard ? 1 : 0;
    if (input.clientEditable !== undefined) {
      patch.clientEditable = current.entity === "client" && input.clientEditable ? 1 : 0;
    }
    if (input.isActive !== undefined) patch.isActive = input.isActive ? 1 : 0;

    await db.update(table).set(patch).where(eq(table.id, input.id));
    return { ok: true };
  });
}

export async function moveDefinition(
  slug: string,
  input: { id: string; direction: "up" | "down" },
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  return withTenantDb(slug, async (db, tables) => {
    const table = tables.customFieldDefinitions;
    const [row] = await db.select().from(table).where(eq(table.id, input.id)).limit(1);
    if (!row || !isEntity(row.entity)) return { ok: false, error: "notFound" };
    const rows = await db
      .select({ id: table.id, sort: table.sort })
      .from(table)
      .where(eq(table.entity, row.entity))
      .orderBy(asc(table.sort), asc(table.label));
    const index = rows.findIndex((item) => item.id === input.id);
    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    const neighbor = rows[neighborIndex];
    if (!neighbor) return { ok: true };
    const current = rows[index];
    const now = new Date();
    if (current.sort === neighbor.sort) {
      const sort = input.direction === "up" ? neighbor.sort - 1 : neighbor.sort + 1;
      await db.update(table).set({ sort, updatedAt: now }).where(eq(table.id, current.id));
      return { ok: true };
    }
    await db.update(table).set({ sort: neighbor.sort, updatedAt: now }).where(eq(table.id, current.id));
    await db.update(table).set({ sort: current.sort, updatedAt: now }).where(eq(table.id, neighbor.id));
    return { ok: true };
  });
}

function mergedAttributes(column: AnyColumn, set: Record<string, unknown>, unset: string[]): SQL {
  const removed =
    unset.length === 0
      ? column
      : sql`${column} - ARRAY[${sql.join(
          unset.map((key) => sql`${key}`),
          sql`, `,
        )}]::text[]`;
  if (Object.keys(set).length === 0) return sql`${removed}`;
  return sql`(${removed}) || ${JSON.stringify(set)}::jsonb`;
}

export async function writeEntityAttributes(
  slug: string,
  entity: FieldEntity,
  ownerId: string,
  values: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: "notFound" | "invalid" | "unknown" }> {
  return withTenantDb(slug, async (db, tables) => {
    const defs = await readDefs(db, tables.customFieldDefinitions, entity, false);
    const parsed = validateAttributeValues(defs, values);
    if (!parsed.ok) {
      const code = Object.values(parsed.errors).includes("unknown") ? "unknown" : "invalid";
      return { ok: false, error: code };
    }
    if (parsed.unset.length === 0 && Object.keys(parsed.set).length === 0) return { ok: true };
    const table = attributeColumnFor(tables, entity);
    const updated = await db
      .update(table)
      .set({
        attributes: mergedAttributes(table.attributes, parsed.set, parsed.unset),
        updatedAt: new Date(),
      })
      .where(eq(table.id, ownerId))
      .returning({ id: table.id });
    if (updated.length === 0) return { ok: false, error: "notFound" };
    return { ok: true };
  });
}
