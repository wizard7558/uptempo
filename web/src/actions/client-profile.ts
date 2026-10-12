"use server";

import { getT } from "@/lib/terms/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlugForBookingClient } from "@/lib/tenant/registry";
import { getClientServiceHistory } from "@/lib/queries/client-history";
import { createActionToken } from "@/lib/email/tokens";
import { ensureCustomFieldDefinitions, listDefinitions, writeEntityAttributes } from "@/lib/custom-fields/service";
import type { FieldDef } from "@/lib/custom-fields/values";

async function requireBookingSessionClient(clientId: string): Promise<void> {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    throw new Error("Unauthorized");
  }
}

const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.union([z.string().email(), z.literal("")]).optional().nullable(),
  phone: z.string().max(40).optional().nullable().or(z.literal("")),
  birthday: z.string().optional().nullable(),
  gender: z.string().max(100).optional().nullable().or(z.literal("")),
  address: z.string().max(500).optional().nullable().or(z.literal("")),
  city: z.string().max(100).optional().nullable().or(z.literal("")),
  state: z.string().max(50).optional().nullable().or(z.literal("")),
  zip: z.string().max(20).optional().nullable().or(z.literal("")),
});

export type ClientProfileData = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  attributes: Record<string, unknown>;
  clientFields: FieldDef[];
};

export async function getClientProfile(
  clientId: string,
): Promise<{ profile: ClientProfileData | null; error?: string }> {
  await requireBookingSessionClient(clientId);
  try {
    const slug = await getTenantSlugForBookingClient(clientId);
    if (!slug) {
      return { profile: null, error: (await getT("errors"))("clientProfile.placeNotFound") };
    }

    const [row] = await withTenantDb(slug, async (db, { clients }) => {
      return db
        .select({
          id: clients.id,
          name: clients.name,
          email: clients.email,
          phone: clients.phone,
          birthday: clients.birthday,
          gender: clients.gender,
          address: clients.address,
          city: clients.city,
          state: clients.state,
          zip: clients.zip,
          attributes: clients.attributes,
        })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
    });

    if (!row) {
      return { profile: null, error: "Client not found" };
    }

    await ensureCustomFieldDefinitions(slug);
    const clientFields = (await listDefinitions(slug, "client")).filter(
      (def) => def.clientEditable && def.isActive,
    );

    return {
      profile: {
        ...row,
        attributes: row.attributes ?? {},
        clientFields,
        birthday: row.birthday
          ? typeof row.birthday === "string"
            ? row.birthday
            : String(row.birthday).slice(0, 10)
          : null,
      },
    };
  } catch (e) {
    console.error("[client-profile] getClientProfile", e);
    return { profile: null, error: "Failed to load profile" };
  }
}

/** Writes only the fields the client is allowed to edit on their account. */
export async function updateMyClientAttributes(
  clientId: string,
  values: Record<string, unknown>,
): Promise<{ success: true } | { success: false; error: string }> {
  await requireBookingSessionClient(clientId);

  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { success: false, error: (await getT("errors"))("clientProfile.placeNotFound") };
  }
  const invalid = (await getT("errors", slug))("customFields.invalid");
  const editable = new Set(
    (await listDefinitions(slug, "client"))
      .filter((def) => def.clientEditable && def.isActive)
      .map((def) => def.key),
  );
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!editable.has(key)) return { success: false, error: invalid };
    payload[key] = value;
  }

  try {
    const written = await writeEntityAttributes(slug, "client", clientId, payload);
    if (!written.ok) return { success: false, error: invalid };
    return { success: true };
  } catch (e) {
    console.error("[client-profile] updateMyClientAttributes", e);
    return { success: false, error: invalid };
  }
}

export async function updateClientProfile(
  clientId: string,
  data: z.infer<typeof updateProfileSchema>,
): Promise<{ success: true } | { success: false; error: string; fieldErrors?: Record<string, string[]> }> {
  await requireBookingSessionClient(clientId);

  const parsed = updateProfileSchema.safeParse(data);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }

  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { success: false, error: (await getT("errors"))("clientProfile.placeNotFound") };
  }

  const v = parsed.data;
  const email =
    v.email === "" || v.email === undefined || v.email === null
      ? null
      : v.email;
  const phone =
    v.phone === "" || v.phone === undefined || v.phone === null
      ? null
      : v.phone;

  const birthday =
    v.birthday && v.birthday.trim() !== ""
      ? v.birthday.trim().slice(0, 10)
      : null;

  try {
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({
          name: v.name.trim(),
          email,
          phone,
          birthday: birthday ?? null,
          gender:
            v.gender === "" || v.gender === undefined || v.gender === null
              ? null
              : v.gender.trim(),
          address:
            v.address === "" || v.address === undefined || v.address === null
              ? null
              : v.address.trim(),
          city:
            v.city === "" || v.city === undefined || v.city === null
              ? null
              : v.city.trim(),
          state:
            v.state === "" || v.state === undefined || v.state === null
              ? null
              : v.state.trim(),
          zip:
            v.zip === "" || v.zip === undefined || v.zip === null
              ? null
              : v.zip.trim(),
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId));
    });
    revalidatePath("/account");
    return { success: true };
  } catch (e) {
    console.error("[client-profile] updateClientProfile", e);
    return { success: false, error: "Could not save profile" };
  }
}

export type ClientAppointmentListItem = {
  id: string;
  staffName: string;
  serviceNames: string[];
  start: Date;
  end: Date;
  status: string;
  cancelToken: string;
  rescheduleToken: string;
};

export async function getClientAppointments(clientId: string): Promise<{
  upcoming: ClientAppointmentListItem[];
  past: ClientAppointmentListItem[];
  error?: string;
}> {
  await requireBookingSessionClient(clientId);

  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { upcoming: [], past: [], error: (await getT("errors"))("clientProfile.placeNotFound") };
  }

  const now = new Date();

  return withTenantDb(slug, async (db, tables) => {
    const history = await getClientServiceHistory(db, tables, clientId);

    const upcoming: ClientAppointmentListItem[] = [];
    const past: ClientAppointmentListItem[] = [];

    for (const h of history) {
      const item: ClientAppointmentListItem = {
        id: h.appointmentId,
        staffName: h.staffName,
        serviceNames: h.services.map((s) => s.serviceName),
        start: h.startTime,
        end: h.endTime,
        status: h.status,
        cancelToken: createActionToken(h.appointmentId, "cancel"),
        rescheduleToken: createActionToken(h.appointmentId, "reschedule"),
      };

      if (h.endTime > now && h.status !== "cancelled") {
        upcoming.push(item);
      } else if (h.endTime <= now) {
        past.push(item);
      }
    }

    upcoming.sort((a, b) => a.start.getTime() - b.start.getTime());
    past.sort((a, b) => b.start.getTime() - a.start.getTime());

    return {
      upcoming,
      past: past.slice(0, 10),
    };
  });
}
