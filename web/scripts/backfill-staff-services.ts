import "dotenv/config";

/**
 * One-off backfill: link every active service to every active stylist in each
 * tenant, skipping pairs that already exist.
 *
 * Rationale: prior to the auto-assign-on-create fix in `createService`, newly
 * created services had zero rows in `stylist_services`, making them invisible
 * in the new-booking picker (which filters by that join). This script fills in
 * the missing links so pre-existing services become bookable without manually
 * re-assigning each one.
 *
 * Run:
 *   DATABASE_URL="..." npx tsx scripts/backfill-stylist-services.ts
 *
 * Safe to re-run (uses ON CONFLICT DO NOTHING).
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
    let totalInserted = 0;
    for (const { slug } of tenants) {
      const schema = `tenant_${slug}`;
      const inserted = await sql.unsafe(`
        INSERT INTO "${schema}"."staff_services" (staff_id, service_id)
        SELECT sty.id, svc.id
        FROM "${schema}"."staff" sty
        CROSS JOIN "${schema}"."services" svc
        WHERE sty.is_active = 1
          AND svc.is_active = 1
        ON CONFLICT (staff_id, service_id) DO NOTHING
        RETURNING staff_id, service_id
      `);

      if (inserted.length > 0) {
        console.log(`[${slug}] linked ${inserted.length} missing stylist<->service pairs`);
        totalInserted += inserted.length;
      } else {
        console.log(`[${slug}] nothing to backfill`);
      }
    }

    console.log(
      totalInserted === 0
        ? "\nAll active tenants already fully linked."
        : `\nBackfilled ${totalInserted} stylist_service rows across ${tenants.length} tenant(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
