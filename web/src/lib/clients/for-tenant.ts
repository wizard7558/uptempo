import { withTenantDb } from "@/lib/db/tenant";
import { createClientSchema } from "@/lib/validators/client";
import { eq, and, ilike, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { normalizePhone } from "@/lib/phone";

function duplicateClientError(
  error: unknown,
): { field?: "email" | "phone"; message: string } | null {
  for (const c of [error, (error as { cause?: unknown })?.cause]) {
    if ((c as { code?: string })?.code !== "23505") continue;
    const constraint =
      (c as { constraint_name?: string })?.constraint_name ??
      (c as { constraint?: string })?.constraint ??
      "";
    const field = constraint.includes("phone")
      ? ("phone" as const)
      : constraint.includes("email")
        ? ("email" as const)
        : undefined;
    const message =
      field === "phone"
        ? "A client with this phone number already exists."
        : field === "email"
          ? "A client with this email already exists."
          : "A client with this email or phone number already exists.";
    return { field, message };
  }
  return null;
}

function describeDbError(error: unknown): string | null {
  for (const c of [error, (error as { cause?: unknown })?.cause]) {
    const code = (c as { code?: string })?.code;
    if (!code) continue;
    switch (code) {
      case "23505":
        return "that contact info is already in use";
      case "23502":
        return "a required field was missing";
      case "22001":
        return "one of the fields is too long";
      case "23514":
        return "a value failed a validation rule";
      case "42P01":
      case "42703":
        return "the database is mid-migration — try again shortly";
      default:
        return `database error ${code}`;
    }
  }
  return null;
}

export async function createClientForTenant(
  tenantSlug: string,
  data: {
    name: string;
    email?: string | null;
    phone?: string | null;
  },
) {
  const parsed = createClientSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const [client] = await withTenantDb(tenantSlug, async (db, { clients }) => {
      return db
        .insert(clients)
        .values({
          name: parsed.data.name,
          email: parsed.data.email ?? null,
          phone: normalizePhone(parsed.data.phone),
        })
        .returning({ id: clients.id });
    });

    revalidatePath("/clients");
    trackEvent("client.created", {}, { tenantSlug });
    return { success: true as const, id: client.id };
  } catch (error) {
    const dup = duplicateClientError(error);
    if (dup) {
      // Look up the conflicting client so staff can jump straight to it — but
      // keep the message itself PII-free (the id only powers an "Open" action).
      const existing =
        dup.field === "phone" && parsed.data.phone
          ? await findClientByPhoneForTenant(tenantSlug, parsed.data.phone)
          : dup.field === "email" && parsed.data.email
            ? await findClientByEmailForTenant(tenantSlug, parsed.data.email)
            : null;
      const message =
        dup.field === "phone"
          ? "That phone number already belongs to a current client."
          : dup.field === "email"
            ? "That email already belongs to a current client."
            : dup.message;
      return {
        success: false as const,
        duplicate: dup.field ?? true,
        existingClientId: existing?.id,
        error: {
          formErrors: [],
          fieldErrors: dup.field ? { [dup.field]: [message] } : {},
          message,
        },
      };
    }
    console.error("[Clients] Failed to create client:", error);
    const reason = describeDbError(error);
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: reason
          ? `Couldn't save client: ${reason}`
          : "Failed to create client",
      },
    };
  }
}

export async function findClientByEmailForTenant(
  tenantSlug: string,
  email: string,
) {
  const result = await withTenantDb(tenantSlug, async (db, { clients }) => {
    return db
      .select()
      .from(clients)
      .where(and(ilike(clients.email, email), isNull(clients.deletedAt)))
      .limit(1);
  });

  return result[0] ?? null;
}

export async function findClientByPhoneForTenant(
  tenantSlug: string,
  phone: string,
) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const result = await withTenantDb(tenantSlug, async (db, { clients }) => {
    return db
      .select()
      .from(clients)
      .where(and(eq(clients.phone, normalized), isNull(clients.deletedAt)))
      .limit(1);
  });

  return result[0] ?? null;
}
