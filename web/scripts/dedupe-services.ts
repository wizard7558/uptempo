import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Merge duplicate services (e.g. straight vs smart apostrophe: "Men's Haircut"
 * vs "Men’s Haircut") within each tenant. Repoints all FKs to a canonical
 * service, then deletes the duplicates.
 *
 * Canonical rule per normalized-name group:
 *   1. If exactly one member uses a curly apostrophe (the imported variant), keep it.
 *   2. else the member with the most references, tie-break newest created_at.
 *
 * Dry-run by default; pass --apply to execute. Conflict-safe: when repointing
 * would violate a (key, service_id) uniqueness, the duplicate's row is dropped
 * instead (canonical's row wins).
 *
 * Usage:
 *   npx tsx scripts/dedupe-services.ts            # dry-run (all active tenants)
 *   npx tsx scripts/dedupe-services.ts --apply
 */
const APPLY = process.argv.includes("--apply");

function norm(name: string): string {
  return name.replace(/[‘’′]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}
function hasCurly(name: string): boolean {
  return /[‘’]/.test(name);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[dedupe] Missing DATABASE_URL");
    process.exit(1);
  }
  const { publicDb } = await import("../src/lib/db");
  const { sql } = await import("drizzle-orm");

  const tRows = await publicDb.execute(
    sql`SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug`,
  );
  const slugs = Array.from(tRows as Iterable<Record<string, unknown>>).map((r) => String(r.slug));

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no changes) ===");
  let groupsTotal = 0;
  let dupsTotal = 0;

  for (const slug of slugs) {
    const schema = `tenant_${slug}`;
    const svc = Array.from(
      (await publicDb.execute(
        sql.raw(`SELECT id, name, price_cents, default_duration_minutes AS dur, created_at FROM "${schema}".services`),
      )) as Iterable<Record<string, unknown>>,
    );
    if (svc.length === 0) continue;

    // group by normalized name
    const groups = new Map<string, typeof svc>();
    for (const s of svc) {
      const k = norm(String(s.name));
      const arr = groups.get(k) ?? [];
      arr.push(s);
      groups.set(k, arr);
    }

    const refCount = async (id: string): Promise<number> => {
      const q = await publicDb.execute(
        sql.raw(
          `SELECT
             (SELECT count(*) FROM "${schema}".appointments WHERE service_id='${id}') +
             (SELECT count(*) FROM "${schema}".appointment_services WHERE service_id='${id}') +
             (SELECT count(*) FROM "${schema}".staff_services WHERE service_id='${id}') +
             (SELECT count(*) FROM "${schema}".client_service_overrides WHERE service_id='${id}') AS n`,
        ),
      );
      return Number(Array.from(q as Iterable<Record<string, unknown>>)[0].n);
    };

    for (const [, members] of groups) {
      if (members.length < 2) continue;
      groupsTotal++;

      // attach ref counts
      const withRefs = [];
      for (const m of members) withRefs.push({ ...m, refs: await refCount(String(m.id)) });

      // pick canonical
      const curlyOnes = withRefs.filter((m) => hasCurly(String(m.name)));
      let canonical;
      if (curlyOnes.length === 1) {
        canonical = curlyOnes[0];
      } else {
        canonical = withRefs.slice().sort(
          (a, b) => b.refs - a.refs || new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime(),
        )[0];
      }
      const dups = withRefs.filter((m) => m.id !== canonical.id);

      console.log(
        `\n[${slug}] "${canonical.name}" $${Number(canonical.price_cents) / 100}/${canonical.dur}min  ← canonical (refs=${canonical.refs}, id=${canonical.id})`,
      );
      for (const d of dups) {
        dupsTotal++;
        console.log(
          `   merge: "${d.name}" $${Number(d.price_cents) / 100}/${d.dur}min (refs=${d.refs}, id=${d.id})`,
        );
        if (!APPLY) continue;
        const c = String(canonical.id);
        const x = String(d.id);
        // appointments.service_id: plain FK, no unique → safe blanket update
        await publicDb.execute(sql.raw(`UPDATE "${schema}".appointments SET service_id='${c}' WHERE service_id='${x}'`));
        // conflict-safe repoint for (key, service_id)-unique tables
        for (const [tbl, key] of [
          ["appointment_services", "appointment_id"],
          ["staff_services", "staff_id"],
          ["client_service_overrides", "client_id"],
        ] as const) {
          await publicDb.execute(
            sql.raw(
              `UPDATE "${schema}".${tbl} SET service_id='${c}' WHERE service_id='${x}' AND ${key} NOT IN (SELECT ${key} FROM "${schema}".${tbl} WHERE service_id='${c}')`,
            ),
          );
          await publicDb.execute(sql.raw(`DELETE FROM "${schema}".${tbl} WHERE service_id='${x}'`));
        }
        await publicDb.execute(sql.raw(`DELETE FROM "${schema}".services WHERE id='${x}'`));
      }
    }
  }

  console.log(`\n[dedupe] ${APPLY ? "applied" : "found"}: ${groupsTotal} duplicate group(s), ${dupsTotal} duplicate service(s) to merge.`);
  process.exit(0);
}
main();
