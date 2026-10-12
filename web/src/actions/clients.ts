"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { getUserRole, requireStaff } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/permissions";
import {
  toClientSearchResult,
  type ClientSearchResult,
} from "@/lib/clients/search-result";
import { updateClientSchema, serviceNoteSchema } from "@/lib/validators/client";
import { getClientServiceHistory as queryClientHistory } from "@/lib/queries/client-history";
import {
  normalizeClientSort,
  type ClientSortDirection,
  type ClientSortKey,
} from "@/lib/clients/sorting";
import {
  eq,
  and,
  ne,
  ilike,
  sql,
  or,
  inArray,
  isNull,
  type SQL,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { differenceInDays, addDays } from "date-fns";
import { trackEvent } from "@/lib/analytics/events";
import { normalizePhone } from "@/lib/phone";
import { createClientForTenant, findClientByEmailForTenant, findClientByPhoneForTenant } from "@/lib/clients/for-tenant";
import { attributeFilterFor, listDefinitions } from "@/lib/custom-fields/service";

export async function createClient(data: {
  name: string;
  email?: string | null;
  phone?: string | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  return createClientForTenant(slug, data);
}

export async function findClientByEmail(email: string) {
  const { tenantSlug: slug } = await requireStaff();
  return findClientByEmailForTenant(slug, email);
}

export async function findClientByPhone(phone: string) {
  const { tenantSlug: slug } = await requireStaff();
  return findClientByPhoneForTenant(slug, phone);
}

/**
 * Archive (soft-delete) one or more clients. Sets `deleted_at` so they disappear
 * from listings while preserving all linked history (appointments, charges, texts,
 * forms, signatures). Returns how many rows were newly archived.
 */
export async function archiveClients(
  clientIds: string[],
): Promise<{ success: boolean; archived: number }> {
  const { tenantSlug: slug } = await requireStaff();
  const ids = Array.from(new Set(clientIds)).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) {
    return { success: true, archived: 0 };
  }

  try {
    const archived = await withTenantDb(slug, async (db, { clients }) => {
      const rows = await db
        .update(clients)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(clients.id, ids), isNull(clients.deletedAt)))
        .returning({ id: clients.id });
      return rows.length;
    });

    revalidatePath("/clients");
    return { success: true, archived };
  } catch (error) {
    console.error("[Clients] Failed to archive clients:", error);
    return { success: false, archived: 0 };
  }
}

interface ListClientsOptions {
  q?: string;
  page?: number;
  pageSize?: number;
  sortBy?: ClientSortKey;
  sortDir?: ClientSortDirection;
  attributeFilter?: { key: string; value: string };
}

export async function listClients(options: ListClientsOptions = {}) {
  const { tenantSlug: slug } = await requireStaff();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const query = options.q?.trim();
  const { sortBy, sortDir } = normalizeClientSort({
    sortBy: options.sortBy,
    sortDir: options.sortDir,
  });

  const filterDefs = options.attributeFilter
    ? await listDefinitions(slug, "client")
    : [];

  return withTenantDb(slug, async (db, { clients, storedValueBalances }) => {
    const search = query
      ? or(
          ilike(clients.name, `%${query}%`),
          ilike(clients.email, `%${query}%`),
          ilike(clients.phone, `%${query}%`),
        )
      : undefined;

    // Exclude archived (soft-deleted) clients from all listings.
    const filters = and(
      isNull(clients.deletedAt),
      search,
      attributeFilterFor(filterDefs, clients.attributes, options.attributeFilter),
    );

    const [totalRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(clients)
      .where(filters);

    const direction = sql.raw(sortDir);
    const firstNameOrder = sql<string>`lower(split_part(trim(${clients.name}), ' ', 1))`;
    const lastNameOrder =
      sql<string>`lower(regexp_replace(trim(${clients.name}), '^\\S+\\s*', ''))`;
    const emailPresenceOrder =
      sql<number>`case when ${clients.email} is null or btrim(${clients.email}) = '' then 1 else 0 end`;
    const emailOrder = sql<string>`lower(trim(${clients.email}))`;
    const phonePresenceOrder =
      sql<number>`case when ${clients.phone} is null or btrim(${clients.phone}) = '' then 1 else 0 end`;
    const phoneOrder =
      sql<string>`regexp_replace(coalesce(${clients.phone}, ''), '\\D', '', 'g')`;
    const customerSincePresenceOrder =
      sql<number>`case when ${clients.customerSince} is null then 1 else 0 end`;
    const nameTieBreakers: SQL[] = [
      sql`${firstNameOrder} asc`,
      sql`${lastNameOrder} asc`,
      sql`${clients.createdAt} desc`,
    ];

    let orderBy: SQL[];
    switch (sortBy) {
      case "lastName":
        orderBy = [
          sql`${lastNameOrder} ${direction}`,
          sql`${firstNameOrder} ${direction}`,
          sql`${clients.createdAt} desc`,
        ];
        break;
      case "email":
        orderBy = [
          sql`${emailPresenceOrder} asc`,
          sql`${emailOrder} ${direction}`,
          ...nameTieBreakers,
        ];
        break;
      case "phone":
        orderBy = [
          sql`${phonePresenceOrder} asc`,
          sql`${phoneOrder} ${direction}`,
          ...nameTieBreakers,
        ];
        break;
      case "appointmentsBooked":
        orderBy = [
          sql`${clients.appointmentsBooked} ${direction}`,
          ...nameTieBreakers,
        ];
        break;
      case "customerSince":
        orderBy = [
          sql`${customerSincePresenceOrder} asc`,
          sql`${clients.customerSince} ${direction}`,
          ...nameTieBreakers,
        ];
        break;
      case "firstName":
      default:
        orderBy = [
          sql`${firstNameOrder} ${direction}`,
          sql`${lastNameOrder} ${direction}`,
          sql`${clients.createdAt} desc`,
        ];
        break;
    }

    const rows = await db
      .select()
      .from(clients)
      .where(filters)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const ids = rows.map((r) => r.id);
    const balanceRows =
      ids.length > 0
        ? await db
            .select({
              clientId: storedValueBalances.clientId,
              balanceCents: storedValueBalances.balanceCents,
            })
            .from(storedValueBalances)
            .where(inArray(storedValueBalances.clientId, ids))
        : [];
    const balanceByClient = new Map(
      balanceRows.map((b) => [b.clientId, b.balanceCents]),
    );
    const clientsWithBank = rows.map((c) => ({
      ...c,
      storedValueBalanceCents: balanceByClient.get(c.id) ?? 0,
    }));

    const total = totalRow?.count ?? 0;

    return {
      clients: clientsWithBank,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      query: query ?? "",
      sortBy,
      sortDir,
    };
  });
}

/**
 * Fast, tenant-scoped client lookup for the admin header global search.
 * Matches name/email/phone case-insensitively and returns a compact shape.
 * Permission-gated: callers without `manage_clients` get an empty list rather
 * than an error, so the palette can degrade gracefully.
 */
export async function searchClients(
  query: string,
): Promise<ClientSearchResult[]> {
  const { tenantSlug: slug } = await requireStaff();
  const q = query.trim();
  if (q.length === 0) return [];

  const role = await getUserRole();
  if (!role || !hasPermission(role, "manage_clients")) return [];

  const rows = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        phone: clients.phone,
      })
      .from(clients)
      .where(
        and(
          or(
            ilike(clients.name, `%${q}%`),
            ilike(clients.email, `%${q}%`),
            ilike(clients.phone, `%${q}%`),
          ),
          isNull(clients.deletedAt),
        ),
      )
      .orderBy(sql`lower(${clients.name})`)
      .limit(8);
  });

  return rows.map(toClientSearchResult);
}

export async function getClient(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();
  const result = await withTenantDb(slug, async (db, { clients }) => {
    return db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  });
  return result[0] ?? null;
}

export async function updateClient(data: {
  clientId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  updatedAt: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateClientSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const updated = await withTenantDb(slug, async (db, { clients }) => {
      return db
        .update(clients)
        .set({
          name: parsed.data.name,
          email: parsed.data.email ?? null,
          phone: normalizePhone(parsed.data.phone),
          notes: parsed.data.notes ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clients.id, parsed.data.clientId),
            eq(clients.updatedAt, new Date(parsed.data.updatedAt)),
          )
        )
        .returning({ id: clients.id });
    });

    if (updated.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Client was modified by another user. Please refresh and try again.",
        },
      };
    }

    revalidatePath("/clients");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    trackEvent("client.updated", {}, { tenantSlug: slug });
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to update client" },
    };
  }
}

export async function getClientServiceHistoryAction(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, tables) => {
    return queryClientHistory(db, tables, clientId);
  });
}

export interface ServiceFrequency {
  serviceId: string;
  serviceName: string;
  lastPerformed: Date;
  averageIntervalDays: number;
  nextDueDate: Date;
  status: "overdue" | "due_soon" | "on_track";
}

export async function getServiceFrequency(clientId: string): Promise<ServiceFrequency[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { appointments, appointmentServices, services }) => {
    // Fetch all non-cancelled appointments for this client with their services
    const rows = await db
      .select({
        serviceId: appointmentServices.serviceId,
        serviceName: services.name,
        appointmentStart: sql<string>`lower(${appointments.during})`,
      })
      .from(appointmentServices)
      .innerJoin(appointments, eq(appointmentServices.appointmentId, appointments.id))
      .innerJoin(services, eq(appointmentServices.serviceId, services.id))
      .where(and(
        eq(appointments.clientId, clientId),
        ne(appointments.status, "cancelled"),
      ))
      .orderBy(sql`lower(${appointments.during})`);

    // Group by serviceId
    const serviceGroups = new Map<string, { serviceName: string; dates: Date[] }>();
    for (const row of rows) {
      const group = serviceGroups.get(row.serviceId) ?? { serviceName: row.serviceName, dates: [] };
      group.dates.push(new Date(row.appointmentStart));
      serviceGroups.set(row.serviceId, group);
    }

    // Calculate frequency for services with 2+ appointments
    const frequencies: ServiceFrequency[] = [];
    const now = new Date();

    for (const [serviceId, group] of serviceGroups) {
      if (group.dates.length < 2) continue;

      const sorted = group.dates.sort((a, b) => a.getTime() - b.getTime());
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(differenceInDays(sorted[i], sorted[i - 1]));
      }

      const avgInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
      const lastDate = sorted[sorted.length - 1];
      const nextDue = addDays(lastDate, avgInterval);
      const daysUntilDue = differenceInDays(nextDue, now);

      frequencies.push({
        serviceId,
        serviceName: group.serviceName,
        lastPerformed: lastDate,
        averageIntervalDays: avgInterval,
        nextDueDate: nextDue,
        status: daysUntilDue < 0 ? "overdue" : daysUntilDue < 14 ? "due_soon" : "on_track",
      });
    }

    return frequencies;
  });
}

export async function updateServiceNote(data: {
  appointmentServiceId: string;
  notes: string | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = serviceNoteSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    await withTenantDb(slug, async (db, { appointmentServices }) => {
      await db
        .update(appointmentServices)
        .set({ notes: parsed.data.notes })
        .where(eq(appointmentServices.id, parsed.data.appointmentServiceId));
    });

    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to update service note" },
    };
  }
}
