/** Loads a project's charges and computes its ledger. Server-only. */
import { eq } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { computeProjectBalance, type ProjectBalance, type ProjectCharge } from "./balance";

/** Every charge on the project's appointments, joined through appointments.project_id. */
export async function loadProjectCharges(
  db: Pick<TenantDb, "select">,
  { charges, appointments }: TenantTables,
  projectId: string,
): Promise<ProjectCharge[]> {
  return db
    .select({
      reason: charges.reason,
      status: charges.status,
      amountCents: charges.amountCents,
      tipCents: charges.tipCents,
      depositAppliedCents: charges.depositAppliedCents,
    })
    .from(charges)
    .innerJoin(appointments, eq(charges.appointmentId, appointments.id))
    .where(eq(appointments.projectId, projectId));
}

export async function loadProjectLedger(
  db: Pick<TenantDb, "select">,
  tables: TenantTables,
  projectId: string,
  quotedTotalCents: number | null,
): Promise<ProjectBalance> {
  return computeProjectBalance(quotedTotalCents, await loadProjectCharges(db, tables, projectId));
}
