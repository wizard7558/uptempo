import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Backfill: rewrite existing clients.phone values to the canonical E.164 form
 * produced by src/lib/phone.ts, so the clients_phone_unique index and
 * find-by-phone lookups dedupe consistently with newly-created clients.
 *
 * SAFE BY DEFAULT: dry-run unless `--apply` is passed. Only NON-deleted rows are
 * considered for collisions (the unique index is partial on deleted_at IS NULL).
 * Any two non-deleted clients that normalize to the SAME number are reported as
 * a collision and left untouched — those are real duplicates that need a human
 * merge decision, not something this script should guess at.
 *
 *   npx tsx scripts/backfill-normalize-phones.ts            # dry run
 *   npx tsx scripts/backfill-normalize-phones.ts --apply    # write changes
 *
 * Phones are masked in output (last 4 digits only) to avoid logging PII.
 */
const APPLY = process.argv.includes("--apply");

function mask(phone: string | null): string {
  if (!phone) return "(none)";
  const d = phone.replace(/\D/g, "");
  return d.length >= 4 ? `***${d.slice(-4)}` : "***";
}

async function main() {
  const { normalizePhone } = await import("../src/lib/phone");
  const { publicDb } = await import("../src/lib/db");
  const { withTenantDb } = await import("../src/lib/db/tenant");
  const { sql, eq } = await import("drizzle-orm");

  const tRows = await publicDb.execute(
    sql`SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug`,
  );
  const slugs = Array.from(tRows as Iterable<Record<string, unknown>>).map((r) =>
    String(r.slug),
  );

  let totalChanged = 0;
  let totalCollisions = 0;

  for (const slug of slugs) {
    await withTenantDb(slug, async (db, { clients }) => {
      const rows = await db
        .select({
          id: clients.id,
          phone: clients.phone,
          deletedAt: clients.deletedAt,
        })
        .from(clients);

      // Plan changes; group active (non-deleted) target values to find collisions.
      const changes: { id: string; from: string; to: string }[] = [];
      const activeByTarget = new Map<string, string[]>();

      for (const r of rows) {
        if (!r.phone) continue;
        const norm = normalizePhone(r.phone);
        if (!norm) continue; // too short to canonicalize — leave as-is
        if (!r.deletedAt) {
          const ids = activeByTarget.get(norm) ?? [];
          ids.push(r.id);
          activeByTarget.set(norm, ids);
        }
        if (norm !== r.phone) changes.push({ id: r.id, from: r.phone, to: norm });
      }

      const collisionTargets = new Set(
        Array.from(activeByTarget.entries())
          .filter(([, ids]) => ids.length > 1)
          .map(([target]) => target),
      );

      const safeChanges = changes.filter((c) => !collisionTargets.has(c.to));
      const blocked = changes.filter((c) => collisionTargets.has(c.to));

      console.log(
        `\n[${slug}] ${rows.length} clients · ${changes.length} need reformat · ` +
          `${safeChanges.length} safe · ${collisionTargets.size} collision group(s)`,
      );
      for (const target of collisionTargets) {
        console.log(
          `   ⚠ collision ${mask(target)} → clients ${activeByTarget
            .get(target)!
            .join(", ")} (left untouched)`,
        );
      }
      totalCollisions += collisionTargets.size;

      if (APPLY) {
        for (const c of safeChanges) {
          await db.update(clients).set({ phone: c.to }).where(eq(clients.id, c.id));
        }
        console.log(`   ✓ applied ${safeChanges.length} update(s)`);
      } else if (safeChanges.length) {
        console.log(`   would update ${safeChanges.length} (dry run):`);
        for (const c of safeChanges.slice(0, 5)) {
          console.log(`     ${mask(c.from)} → ${mask(c.to)}`);
        }
        if (safeChanges.length > 5) console.log(`     … +${safeChanges.length - 5} more`);
      }
      void blocked;
      totalChanged += APPLY ? safeChanges.length : 0;
    });
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"} · ${totalChanged} updated · ` +
      `${totalCollisions} collision group(s) need manual merge`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
