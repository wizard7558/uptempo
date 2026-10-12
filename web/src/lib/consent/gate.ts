import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { hasModule } from "@/lib/tenant/modules";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { localDay } from "@/lib/scheduling/intervals";
import { ageOn, requiredMinAge } from "./age";

export type AgeGate = { minAge: number; requiresId: boolean };

export type AgeGateResult =
  | { ok: true }
  | { ok: false; code: "DOB_REQUIRED" | "UNDERAGE"; minAge: number };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date between 1900-01-01 and today, or null. */
export function parseDob(input: string | null | undefined): string | null {
  if (!input || !DAY_RE.test(input)) return null;
  const [y, m, d] = input.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || date.getTime() > Date.now()) return null;
  return input;
}

/**
 * The age rule that applies to these services, or null when the consent_id
 * module is off or no active consent template with a minimum age is assigned.
 */
export async function getAgeGate(slug: string, serviceIds: string[]): Promise<AgeGate | null> {
  if (serviceIds.length === 0) return null;
  if (!(await hasModule(slug, "consent_id"))) return null;
  const rows = await withTenantDb(slug, async (db, t) =>
    db
      .select({
        kind: t.formTemplates.kind,
        minAge: t.formTemplates.minAge,
        isActive: t.formTemplates.isActive,
        requiresId: t.formTemplates.requiresId,
      })
      .from(t.serviceFormAssignments)
      .innerJoin(t.formTemplates, eq(t.formTemplates.id, t.serviceFormAssignments.formTemplateId))
      .where(
        and(
          inArray(t.serviceFormAssignments.serviceId, serviceIds),
          eq(t.formTemplates.isActive, 1),
          eq(t.formTemplates.kind, "consent"),
        ),
      ),
  );
  const minAge = requiredMinAge(rows);
  if (minAge === null) return null;
  return { minAge, requiresId: rows.some((r) => r.requiresId === 1) };
}

/**
 * Checks the client's age on the appointment's local day. The birthday on file
 * wins; a typed one is saved only when none is on file (before the check, so it can't be swapped on a retry). With no birthday at
 * all, `strict` callers (public booking) are asked for one and staff are let through.
 */
export async function enforceAgeGate(
  slug: string,
  opts: {
    clientId: string;
    serviceIds: string[];
    start: Date;
    dobInput?: string | null;
    strict: boolean;
  },
): Promise<AgeGateResult> {
  const gate = await getAgeGate(slug, opts.serviceIds);
  if (!gate) return { ok: true };

  const [client] = await withTenantDb(slug, async (db, { clients }) =>
    db.select({ birthday: clients.birthday }).from(clients).where(eq(clients.id, opts.clientId)).limit(1),
  );
  const typed = parseDob(opts.dobInput);
  const dob = client?.birthday ?? typed;

  // Keep what they typed, even when it fails the check: a second try can't swap in a different date.
  if (client && !client.birthday && typed) {
    await withTenantDb(slug, async (db, { clients }) =>
      db
        .update(clients)
        .set({ birthday: typed, updatedAt: new Date() })
        .where(and(eq(clients.id, opts.clientId), isNull(clients.birthday))),
    );
  }

  if (!dob) {
    return opts.strict ? { ok: false, code: "DOB_REQUIRED", minAge: gate.minAge } : { ok: true };
  }

  const tz = (await loadSchedulingSettings(slug)).timezone;
  if (ageOn(dob, localDay(opts.start, tz)) < gate.minAge) {
    return { ok: false, code: "UNDERAGE", minAge: gate.minAge };
  }

  return { ok: true };
}
