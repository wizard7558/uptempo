import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { withTenantDb } from "@/lib/db/tenant";
import { normalizeChecklistItems, type ChecklistTemplateItem } from "./items";

export type { ChecklistTemplateItem };
export { normalizeChecklistItems };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type ChecklistTemplateRow = {
  serviceId: string;
  serviceName: string;
  items: ChecklistTemplateItem[];
};

export type AppointmentChecklistItem = {
  id: string;
  label: string;
  sortOrder: number;
  sourceKey: string | null;
  doneAt: Date | null;
  doneBy: string | null;
};

function schemaName(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error("Invalid tenant slug");
  return `tenant_${slug}`;
}

/**
 * Copy missing template steps onto the appointment. Running it again does not
 * add rows that are already there, and a new template step is inserted later
 * without changing the rows that already exist.
 */
export async function ensureAppointmentChecklist(
  slug: string,
  appointmentId: string,
): Promise<void> {
  const schema = schemaName(slug);
  await publicDb.execute(sql`
    INSERT INTO ${sql.identifier(schema)}.appointment_checklist_items
      (appointment_id, label, sort_order, source_key)
    SELECT ${appointmentId}::uuid,
           item->>'label',
           (svc.rn * 100 + item_idx)::int,
           ct.id::text || ':' || (item->>'id')
    FROM (
      SELECT service_id, (row_number() OVER (ORDER BY created_at, id))::int AS rn
      FROM ${sql.identifier(schema)}.appointment_services
      WHERE appointment_id = ${appointmentId}::uuid
    ) svc
    JOIN ${sql.identifier(schema)}.checklist_templates ct ON ct.service_id = svc.service_id
    CROSS JOIN LATERAL jsonb_array_elements(ct.items) WITH ORDINALITY AS e(item, item_idx)
    ON CONFLICT (appointment_id, source_key) WHERE source_key IS NOT NULL DO NOTHING
  `);
}

export async function listChecklistTemplates(slug: string): Promise<ChecklistTemplateRow[]> {
  return withTenantDb(slug, async (db, { services, checklistTemplates }) => {
    const rows = await db
      .select({
        serviceId: services.id,
        serviceName: services.name,
        items: checklistTemplates.items,
      })
      .from(services)
      .leftJoin(checklistTemplates, eq(checklistTemplates.serviceId, services.id))
      .where(eq(services.isActive, 1))
      .orderBy(asc(services.name));
    return rows.map((row) => ({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      items: Array.isArray(row.items) ? row.items : [],
    }));
  });
}

export async function saveChecklistTemplate(
  slug: string,
  serviceId: string,
  rawItems: { id?: string; label: string }[],
): Promise<
  | { ok: true; items: ChecklistTemplateItem[] }
  | { ok: false; error: "tooMany" | "label" | "notFound" }
> {
  const normalized = normalizeChecklistItems(rawItems);
  if (!normalized.ok) return normalized;
  const saved = await withTenantDb(slug, async (db, { services, checklistTemplates }) => {
    const [service] = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.isActive, 1)))
      .limit(1);
    if (!service) return false;
    await db
      .insert(checklistTemplates)
      .values({ serviceId, items: normalized.items })
      .onConflictDoUpdate({
        target: checklistTemplates.serviceId,
        set: { items: normalized.items, updatedAt: new Date() },
      });
    return true;
  });
  if (!saved) return { ok: false, error: "notFound" };
  return { ok: true, items: normalized.items };
}

export async function listAppointmentChecklist(
  slug: string,
  appointmentId: string,
): Promise<AppointmentChecklistItem[]> {
  await ensureAppointmentChecklist(slug, appointmentId);
  return withTenantDb(slug, async (db, { appointmentChecklistItems }) =>
    db
      .select({
        id: appointmentChecklistItems.id,
        label: appointmentChecklistItems.label,
        sortOrder: appointmentChecklistItems.sortOrder,
        sourceKey: appointmentChecklistItems.sourceKey,
        doneAt: appointmentChecklistItems.doneAt,
        doneBy: appointmentChecklistItems.doneBy,
      })
      .from(appointmentChecklistItems)
      .where(eq(appointmentChecklistItems.appointmentId, appointmentId))
      .orderBy(asc(appointmentChecklistItems.sortOrder), asc(appointmentChecklistItems.createdAt)),
  );
}

export async function setChecklistItemDone(
  slug: string,
  itemId: string,
  done: boolean,
  userId: string,
): Promise<boolean> {
  const rows = await withTenantDb(slug, async (db, { appointmentChecklistItems }) =>
    db
      .update(appointmentChecklistItems)
      .set({
        doneAt: done ? new Date() : null,
        doneBy: done ? userId : null,
        updatedAt: new Date(),
      })
      .where(eq(appointmentChecklistItems.id, itemId))
      .returning({ id: appointmentChecklistItems.id }),
  );
  return rows.length === 1;
}

export async function addChecklistItem(
  slug: string,
  appointmentId: string,
  label: string,
): Promise<{ ok: true; item: AppointmentChecklistItem } | { ok: false; error: "label" }> {
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > 120) return { ok: false, error: "label" };
  const item = await withTenantDb(slug, async (db, { appointmentChecklistItems }) => {
    const [maxRow] = await db
      .select({
        maxSort: sql<number>`coalesce(max(${appointmentChecklistItems.sortOrder}), 0)::int`,
      })
      .from(appointmentChecklistItems)
      .where(eq(appointmentChecklistItems.appointmentId, appointmentId));
    const [row] = await db
      .insert(appointmentChecklistItems)
      .values({
        appointmentId,
        label: trimmed,
        sortOrder: (maxRow?.maxSort ?? 0) + 1,
      })
      .returning({
        id: appointmentChecklistItems.id,
        label: appointmentChecklistItems.label,
        sortOrder: appointmentChecklistItems.sortOrder,
        sourceKey: appointmentChecklistItems.sourceKey,
        doneAt: appointmentChecklistItems.doneAt,
        doneBy: appointmentChecklistItems.doneBy,
      });
    return row;
  });
  return { ok: true, item };
}

/** Template steps stay. Staff can remove a step they added for this appointment only. */
export async function removeChecklistItem(slug: string, itemId: string): Promise<boolean> {
  const rows = await withTenantDb(slug, async (db, { appointmentChecklistItems }) =>
    db
      .delete(appointmentChecklistItems)
      .where(
        and(eq(appointmentChecklistItems.id, itemId), isNull(appointmentChecklistItems.sourceKey)),
      )
      .returning({ id: appointmentChecklistItems.id }),
  );
  return rows.length === 1;
}
