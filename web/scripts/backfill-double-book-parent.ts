import "dotenv/config";

/**
 * Optional one-off: list flex (double-book) appointments missing parent linkage.
 *
 * Run when you suspect legacy rows before `double_book_parent_appointment_id` existed:
 *   DATABASE_URL="..." npx tsx scripts/backfill-double-book-parent.ts
 *
 * This script does not mutate data — it only prints counts and IDs for human review.
 * Safe to run anytime.
 */

import postgres from "postgres";
import { listActiveTenants } from "../src/lib/tenant/registry";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 2 });
  const tenants = await listActiveTenants();

  try {
    let totalOrphans = 0;
    for (const { slug } of tenants) {
      const schema = `tenant_${slug}`;
      const rows = await sql.unsafe(`
        SELECT id, staff_id, client_id
        FROM "${schema}"."appointments"
        WHERE is_double_book = 1
          AND double_book_parent_appointment_id IS NULL
          AND status <> 'cancelled'
      `);
      if (rows.length > 0) {
        console.log(`[${slug}] flex rows without parent: ${rows.length}`);
        console.log(rows);
        totalOrphans += rows.length;
      }
    }
    if (totalOrphans === 0) {
      console.log("No orphan flex rows found across active tenants.");
    } else {
      console.log(`\nTotal orphan flex rows: ${totalOrphans}`);
      console.log(
        "Review before any manual UPDATE; automated backfill needs product rules.",
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
