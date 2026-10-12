"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { getT } from "@/lib/terms/server";
import { assertModule, hasModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { CreditError } from "@/lib/credits/ledger";
import {
  applyCreditAtCheckoutTx,
  canTakeLateCancelCredit,
  hasRedeemablePackage,
  serviceIdsForAppointment,
  takeLateCancelCreditTx,
  type AppointmentCreditResult,
} from "@/lib/credits/appointment-credits";

type Failure = { success: false; error: string };

const idSchema = z.uuid();

async function messageFor(slug: string, err: unknown): Promise<string | null> {
  const t = await getT("packages", slug);
  if (err instanceof ModuleDisabledError) return err.message;
  if (err instanceof CreditError) return t("insufficient");
  return null;
}

async function failureFor(slug: string, result: Extract<AppointmentCreditResult, { ok: false }>): Promise<Failure> {
  const t = await getT("packages", slug);
  const key = { NOT_FOUND: "errors.appointmentNotFound", NOT_ELIGIBLE: "errors.notEligible", NO_PACKAGE: "errors.noCredit" } as const;
  return { success: false, error: t(key[result.code]) };
}

/**
 * Owner/admin: "Take a credit for this late cancel". The visit must be cancelled or a no-show
 * and not already paid by a credit. Spends one credit from a pack that fits the services.
 */
export async function takeLateCancelCredit(appointmentId: string): Promise<{ success: true } | Failure> {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  try {
    await assertModule(slug, "packages");
    const id = idSchema.parse(appointmentId);
    const result = await withTenantDb(slug, (db, tables) =>
      db.transaction((tx) => takeLateCancelCreditTx(tx, tables, { appointmentId: id, createdBy: auth.userId })),
    );
    if (!result.ok) return failureFor(slug, result);
    revalidatePath("/schedule");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const message = await messageFor(slug, err);
    if (message) return { success: false, error: message };
    throw err;
  }
}

/**
 * Owner/admin: can this appointment show "Take a credit for this late cancel"?
 * True only when the packages module is on, the visit is cancelled or a no-show with no credit,
 * and the client has a pack with a credit that fits.
 */
export async function getLateCancelCreditOption(appointmentId: string): Promise<boolean> {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  if (!(await hasModule(slug, "packages"))) return false;
  const id = idSchema.safeParse(appointmentId);
  if (!id.success) return false;
  return withTenantDb(slug, async (db, tables) => {
    const { appointments } = tables;
    const [appt] = await db
      .select({
        clientId: appointments.clientId,
        serviceId: appointments.serviceId,
        status: appointments.status,
        creditEntryId: appointments.creditEntryId,
      })
      .from(appointments)
      .where(eq(appointments.id, id.data))
      .limit(1);
    if (!appt || !canTakeLateCancelCredit(appt)) return false;
    const serviceIds = await serviceIdsForAppointment(db, tables, id.data, appt.serviceId);
    return hasRedeemablePackage(db, tables, { clientId: appt.clientId, serviceIds });
  });
}

/**
 * Staff checkout: "Use a credit" on a confirmed visit that has none. The caller then reloads
 * the checkout data, whose amounts drop to the tip.
 */
export async function applyCreditAtCheckout(appointmentId: string): Promise<{ success: true } | Failure> {
  // Staff only: the public checkout link cannot spend a client's credits.
  const auth = await requireRole("owner", "admin", "provider");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  try {
    await assertModule(slug, "packages");
    const id = idSchema.parse(appointmentId);
    const result = await withTenantDb(slug, (db, tables) =>
      db.transaction((tx) => applyCreditAtCheckoutTx(tx, tables, { appointmentId: id })),
    );
    if (!result.ok) return failureFor(slug, result);
    revalidatePath("/schedule");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const message = await messageFor(slug, err);
    if (message) return { success: false, error: message };
    throw err;
  }
}
