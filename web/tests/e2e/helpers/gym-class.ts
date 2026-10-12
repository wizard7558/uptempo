import type postgres from "postgres";
import { addDays, localDay, wallClockToDate } from "../../../src/lib/scheduling/intervals";

/**
 * The seeded `test-gym` class, shared by the seed script and the classes e2e so the
 * spec can put the class back the way the seed leaves it.
 */
export const GYM_SLUG = "test-gym";
export const GYM_SCHEMA = `tenant_${GYM_SLUG}`;
export const GYM_TIMEZONE = "America/New_York";
export const GYM_STAFF_ID = "f0e2e200-0000-4000-8000-0000000000e1";
export const GYM_SERVICE_ID = "f0e2e200-0000-4000-8000-0000000000e2";
export const GYM_CLIENT_A_ID = "f0e2e200-0000-4000-8000-000000000301";
export const GYM_CLIENT_B_ID = "f0e2e200-0000-4000-8000-000000000302";
export const GYM_SESSION_ID = "f0e2e200-0000-4000-8000-000000000401";
export const GYM_BLOCK_ID = "f0e2e200-0000-4000-8000-000000000403";
const GYM_ENROLLMENT_A_ID = "f0e2e200-0000-4000-8000-000000000402";
const GYM_PACKAGE_A_ID = "f0e2e200-0000-4000-8000-000000000411";

type Sql = ReturnType<typeof postgres>;

/**
 * Deletes and recreates the Bootcamp session for tomorrow 06:00 (business time), with its
 * time block, Gym A's booked spot, and Gym A's 5-credit pack (one credit used by the spot).
 *
 * "Tomorrow" is worked out on every run. The ledger is append-only, so the pack is deleted
 * (which removes its ledger rows) and rebuilt. `credits_remaining` is never written here: the
 * ledger trigger sets it.
 */
export async function seedGymClass(sql: Sql): Promise<{ start: Date }> {
  const day = addDays(localDay(new Date(), GYM_TIMEZONE), 1);
  const start = wallClockToDate(day, "06:00", GYM_TIMEZONE);
  const end = new Date(start.getTime() + 45 * 60_000);
  const during = `[${start.toISOString()},${end.toISOString()})`;
  const S = `"${GYM_SCHEMA}"`;

  // Packs first: their ledger rows point at enrollments.
  await sql.unsafe(`DELETE FROM ${S}.client_packages WHERE client_id IN ('${GYM_CLIENT_A_ID}', '${GYM_CLIENT_B_ID}')`);
  await sql.unsafe(`DELETE FROM ${S}.class_sessions WHERE id = '${GYM_SESSION_ID}'`);
  await sql.unsafe(`DELETE FROM ${S}.time_blocks WHERE id = '${GYM_BLOCK_ID}'`);

  await sql.unsafe(
    `INSERT INTO ${S}.time_blocks (id, staff_id, during, label)
     VALUES ('${GYM_BLOCK_ID}', '${GYM_STAFF_ID}', '${during}'::tstzrange, 'Class: Bootcamp')`,
  );
  await sql.unsafe(
    `INSERT INTO ${S}.class_sessions (id, service_id, staff_id, during, capacity, waitlist_capacity, status, time_block_id)
     VALUES ('${GYM_SESSION_ID}', '${GYM_SERVICE_ID}', '${GYM_STAFF_ID}', '${during}'::tstzrange, 1, 5, 'scheduled', '${GYM_BLOCK_ID}')`,
  );
  await sql.unsafe(
    `INSERT INTO ${S}.client_packages (id, client_id, name, status)
     VALUES ('${GYM_PACKAGE_A_ID}', '${GYM_CLIENT_A_ID}', '5 class pack', 'active')`,
  );
  await sql.unsafe(
    `INSERT INTO ${S}.credit_ledger (client_package_id, delta, reason, reference_id)
     VALUES ('${GYM_PACKAGE_A_ID}', 5, 'purchase', 'e2e-gym-purchase')`,
  );
  await sql.unsafe(
    `INSERT INTO ${S}.class_enrollments (id, session_id, client_id, status)
     VALUES ('${GYM_ENROLLMENT_A_ID}', '${GYM_SESSION_ID}', '${GYM_CLIENT_A_ID}', 'booked')`,
  );
  const [entry] = await sql.unsafe(
    `INSERT INTO ${S}.credit_ledger (client_package_id, enrollment_id, delta, reason, reference_id)
     VALUES ('${GYM_PACKAGE_A_ID}', '${GYM_ENROLLMENT_A_ID}', -1, 'redeem', 'enroll:${GYM_ENROLLMENT_A_ID}')
     RETURNING id`,
  );
  await sql.unsafe(
    `UPDATE ${S}.class_enrollments SET credit_entry_id = '${entry.id}' WHERE id = '${GYM_ENROLLMENT_A_ID}'`,
  );
  return { start };
}
