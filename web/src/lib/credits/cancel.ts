import { eq } from "drizzle-orm";
import type { TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { refundEntry } from "@/lib/credits/ledger";

/** The cancellation window used when a business has no settings row yet (the column default). */
const DEFAULT_WINDOW_HOURS = 24;

/**
 * A cancel is on time only when it happens strictly before `start - window`.
 * Exactly at the edge counts as late.
 */
export function isOnTimeCancel(start: Date, now: Date, cancellationWindowHours: number): boolean {
  return now.getTime() < start.getTime() - cancellationWindowHours * 3_600_000;
}

/**
 * The one rule for what happens to a credit when its booking is cancelled.
 * Call it from every cancel path, inside the transaction that sets the status.
 *
 * - No credit on the appointment, or the credit is not a "redeem" row: nothing happens.
 * - On time: the credit goes back (`refundEntry`, idempotent).
 * - Late (including a cancel that charges a fee): nothing happens, the credit is burned.
 * - `ignoreWindow` (deleting a mistaken booking) skips the time check.
 *
 * `cancellationWindowHours` is read from the business settings when the caller does not pass it.
 * Returns true when a credit was given back.
 */
export async function refundCreditIfOnTime(
  tx: TenantTransaction,
  tables: TenantTables,
  p: {
    appointmentId: string;
    now: Date;
    cancellationWindowHours?: number;
    /** Staff removing a mistaken booking: the credit always goes back, whatever the time. */
    ignoreWindow?: boolean;
  },
): Promise<boolean> {
  const { appointments, creditLedger, businessSettings } = tables;
  const [appt] = await tx
    .select({ creditEntryId: appointments.creditEntryId, during: appointments.during })
    .from(appointments)
    .where(eq(appointments.id, p.appointmentId))
    .limit(1);
  if (!appt?.creditEntryId) return false;
  const [entry] = await tx
    .select({ reason: creditLedger.reason })
    .from(creditLedger)
    .where(eq(creditLedger.id, appt.creditEntryId))
    .limit(1);
  // A late_cancel credit is taken after the fact; a cancel never gives it back.
  if (entry?.reason !== "redeem") return false;

  let windowHours = p.cancellationWindowHours;
  if (!p.ignoreWindow && windowHours === undefined) {
    const [settings] = await tx
      .select({ hours: businessSettings.cancellationWindowHours })
      .from(businessSettings)
      .limit(1);
    windowHours = settings?.hours ?? DEFAULT_WINDOW_HOURS;
  }
  if (!p.ignoreWindow && !isOnTimeCancel(appt.during.start, p.now, windowHours ?? DEFAULT_WINDOW_HOURS)) return false;

  await refundEntry(tx, tables, appt.creditEntryId, "refund");
  return true;
}
