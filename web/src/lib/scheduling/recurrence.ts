/**
 * Repeating bookings. `materializeRule` books the visits of one series up to 84
 * days ahead and reports the ones that no longer fit as alerts; the nightly cron
 * runs `materializeTenant` for every tenant.
 *
 * Idempotent three ways: `materialized_through` moves past every visit that was
 * created or reported, a unique index stops a visit being booked twice, and
 * alerts use a dedupe key.
 */
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { getEmailT } from "@/lib/terms/email";
import { getMultiServiceDuration } from "@/lib/services/duration";
import { insertAppointmentRows } from "@/lib/booking/write-booking";
import { syncAutoAssistantTasksForAppointment } from "@/lib/services/sync-auto-assistant-tasks";
import { checkBooking, resolveBookingLocation } from "./service";
import { failureCodeFor, type BookingFailureCode } from "./reasons";
import { occurrencesBetween, occurrenceStart } from "./rrule";

/** How far ahead visits are booked. */
export const HORIZON_DAYS = 84;
const DAY_MS = 86_400_000;

export type RecurrenceConflict = { index: number; start: Date; code: BookingFailureCode };

export type MaterializeResult =
  | { skipped: true }
  | { skipped: false; created: string[]; conflicts: RecurrenceConflict[] };

/** The words for why a visit could not be booked (key under `schedule.recurrence.reasons`). */
export function reasonKeyFor(code: BookingFailureCode): "slotTaken" | "blocked" | "closed" | "resource" {
  switch (code) {
    case "BLOCKED":
      return "blocked";
    case "RESOURCE_TAKEN":
      return "resource";
    case "STAFF_UNAVAILABLE":
      return "closed";
    default:
      return "slotTaken";
  }
}

/** Books the visits of one series that fall inside the horizon. */
export async function materializeRule(
  slug: string,
  ruleId: string,
  now: Date = new Date(),
): Promise<MaterializeResult> {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * DAY_MS);

  const result = await withTenantDb(slug, async (db, tables) =>
    db.transaction(async (tx): Promise<MaterializeResult> => {
      const { recurrenceRules, appointments, alerts, staff, clients } = tables;
      const [rule] = await tx
        .select()
        .from(recurrenceRules)
        .where(and(eq(recurrenceRules.id, ruleId), eq(recurrenceRules.isActive, 1)))
        .for("update", { skipLocked: true });
      if (!rule) return { skipped: true };

      const shape = {
        rrule: rule.rrule,
        startsAt: rule.startsAt,
        until: rule.until,
        count: rule.count,
        timezone: rule.timezone,
      };
      const after = rule.materializedThrough ?? new Date(rule.startsAt.getTime() - 1);
      const due = occurrencesBetween(shape, after, horizon);

      const existing = new Set(
        (
          await tx
            .select({ index: appointments.recurrenceIndex })
            .from(appointments)
            .where(eq(appointments.recurrenceRuleId, ruleId))
        ).map((r) => r.index),
      );

      const created: string[] = [];
      const conflicts: RecurrenceConflict[] = [];

      if (due.length > 0) {
        const duration = await getMultiServiceDuration(rule.serviceIds, rule.clientId, rule.staffId, slug);
        for (const occ of due) {
          // Visits in the past are never booked or reported.
          if (existing.has(occ.index) || occ.start < now) continue;

          const location = await resolveBookingLocation(slug, rule.staffId, occ.start, rule.locationId, {
            allowOffShift: true, // series mode
          });
          if (!location) {
            conflicts.push({ index: occ.index, start: occ.start, code: "STAFF_UNAVAILABLE" });
            continue;
          }
          const guard = await checkBooking({
            slug,
            staffId: rule.staffId,
            start: occ.start,
            services: duration.services.map((svc) => ({
              serviceId: svc.serviceId,
              durationMinutes: svc.durationMinutes,
            })),
            totalMinutes: duration.totalMinutes,
            locationId: location.id,
            mode: "series",
            clientId: rule.clientId,
            now,
          });
          if (!guard.ok) {
            conflicts.push({ index: occ.index, start: occ.start, code: failureCodeFor(guard.reasons) });
            continue;
          }
          try {
            const row = await tx.transaction((sp) =>
              insertAppointmentRows(sp, tables, {
                staffId: rule.staffId,
                clientId: rule.clientId,
                locationId: location.id,
                start: occ.start,
                end: new Date(occ.start.getTime() + duration.totalMinutes * 60_000),
                isDoubleBook: false,
                doubleBookParentAppointmentId: null,
                clientStatusAtBooking: "repeat",
                services: duration.services,
                resources: guard.resources,
                recurrenceRuleId: ruleId,
                recurrenceIndex: occ.index,
              }),
            );
            created.push(row.id);
          } catch (err) {
            const info = pgErrorInfo(err);
            if (info.code === "23505" && info.constraint === "appointments_recurrence_unique") continue;
            if (info.code === "23P01") {
              conflicts.push({
                index: occ.index,
                start: occ.start,
                code: info.constraint?.startsWith("appointment_resources_") ? "RESOURCE_TAKEN" : "SLOT_TAKEN",
              });
              continue;
            }
            throw err;
          }
        }
      }

      if (conflicts.length > 0) {
        const t = await getEmailT(slug, "schedule");
        const [[staffRow], [clientRow]] = await Promise.all([
          tx.select({ name: staff.displayName }).from(staff).where(eq(staff.id, rule.staffId)).limit(1),
          tx.select({ name: clients.name }).from(clients).where(eq(clients.id, rule.clientId)).limit(1),
        ]);
        for (const c of conflicts) {
          const local = new TZDate(c.start, rule.timezone);
          await tx
            .insert(alerts)
            .values({
              type: "recurrence_conflict",
              severity: "warning",
              title: t("recurrence.alertTitle"),
              body: t("recurrence.alertBody", {
                client: clientRow?.name ?? "",
                date: format(local, "EEEE, MMMM d"),
                time: format(local, "h:mm a"),
                staff: staffRow?.name ?? "",
                reason: t(`recurrence.reasons.${reasonKeyFor(c.code)}`, {
                  staff: staffRow?.name ?? "",
                }),
              }),
              data: {
                ruleId,
                index: c.index,
                start: c.start.toISOString(),
                staffId: rule.staffId,
                clientId: rule.clientId,
                code: c.code,
              },
              dedupeKey: `recurrence_conflict:${ruleId}:${c.index}`,
            })
            .onConflictDoNothing({ target: alerts.dedupeKey });
        }
      }

      const finished =
        (rule.count != null && occurrenceStart(shape, rule.count - 1) <= horizon) ||
        (rule.until != null && rule.until < horizon);
      await tx
        .update(recurrenceRules)
        .set({ materializedThrough: horizon, isActive: finished ? 0 : 1, updatedAt: new Date() })
        .where(eq(recurrenceRules.id, ruleId));

      return { skipped: false, created, conflicts };
    }),
  );

  if (!result.skipped) {
    for (const id of result.created) {
      try {
        await syncAutoAssistantTasksForAppointment(slug, id);
      } catch (err) {
        console.error("[Recurrence] Assistant task sync failed for", id, err);
      }
    }
  }
  return result;
}

export type MaterializeTenantResult = {
  slug: string;
  rules: number;
  created: number;
  conflicts: number;
};

/** Books the next stretch of every active series of one tenant. */
export async function materializeTenant(
  slug: string,
  now: Date = new Date(),
): Promise<MaterializeTenantResult> {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * DAY_MS);
  const due = await withTenantDb(slug, async (db, { recurrenceRules }) =>
    db
      .select({ id: recurrenceRules.id })
      .from(recurrenceRules)
      .where(
        and(
          eq(recurrenceRules.isActive, 1),
          or(isNull(recurrenceRules.materializedThrough), lt(recurrenceRules.materializedThrough, horizon)),
        ),
      ),
  );
  let created = 0;
  let conflicts = 0;
  for (const { id } of due) {
    const r = await materializeRule(slug, id, now);
    if (!r.skipped) {
      created += r.created.length;
      conflicts += r.conflicts.length;
    }
  }
  return { slug, rules: due.length, created, conflicts };
}
