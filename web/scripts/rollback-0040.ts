/**
 * Roll back the Phase 1.4-1.6 renames: public migration 0026 (role 'provider' -> 'stylist') and
 * tenant migration 0040 (schema_version 40 -> 39).
 *
 * Usage (from web/, on the RELEASE commit; it needs 0040.down and the 0026 down file):
 *   npx tsx scripts/rollback-0040.ts                                   # dry run (default)
 *   npx tsx scripts/rollback-0040.ts --apply --confirm-host=<db host>  # execute
 *   --scope=all|public|tenants   (default all)
 *
 * Prints only the DB host (never the URL or credentials), counts and slugs.
 * Dotenv never overrides an existing DATABASE_URL, so a pinned URL wins over .env files.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const ROOT = join(__dirname, "..");

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

async function main() {
  const lib = await import("../src/lib/tenant/rollback-0040");
  const apply = process.argv.includes("--apply");

  let host: string;
  let scope: import("../src/lib/tenant/rollback-0040").Scope;
  try {
    host = lib.parseHost(process.env.DATABASE_URL);
    scope = lib.parseScope(argValue("--scope"));
  } catch (err) {
    console.error(`[rollback-0040] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`[rollback-0040] host = ${host}`);
  console.log(`[rollback-0040] mode = ${apply ? "APPLY" : "dry run"}, scope = ${scope}`);

  const refusal = lib.checkHostConfirmation({ apply, host, confirmHost: argValue("--confirm-host") });
  if (refusal) {
    console.error(`[rollback-0040] ${refusal}`);
    process.exit(1);
  }

  const { sql } = await import("drizzle-orm");
  const { publicDb } = await import("../src/lib/db");
  const { rollbackTenant } = await import("../src/lib/tenant/migrations/runner");

  const journal = JSON.parse(readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"));
  const entry = lib.findJournalEntry(journal, "0026_");
  const downStatements = lib.splitStatementBreakpoints(
    readFileSync(join(ROOT, "drizzle/rollback/0026_staff_role_provider.down.sql"), "utf8"),
  );

  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> =>
    Array.from((await publicDb.execute(q)) as Iterable<T>);

  type Report = {
    tenants: { slug: string; status: string; version: number; renamed: boolean | null }[];
    roles: Record<string, { provider: number; stylist: number }>;
    journalRowPresent: boolean;
  };

  async function report(label: string): Promise<Report> {
    console.log(`\n== ${label} ==`);
    const ts = await rows<{ slug: string; status: string; schema_version: number }>(
      sql`SELECT slug, status, schema_version FROM public.tenants ORDER BY slug`,
    );
    const tenants: Report["tenants"] = [];
    for (const t of ts) {
      let renamed: boolean | null = null;
      if (Number(t.schema_version) === 40) {
        const [r] = await rows<{ staff: boolean; stylists: boolean }>(sql`
          SELECT
            to_regclass(format('%I.staff', ${`tenant_${t.slug}`}::text)) IS NOT NULL AS staff,
            to_regclass(format('%I.stylists', ${`tenant_${t.slug}`}::text)) IS NOT NULL AS stylists`);
        renamed = r.staff && !r.stylists;
      }
      tenants.push({ slug: t.slug, status: t.status, version: Number(t.schema_version), renamed });
      console.log(
        `tenant ${t.slug} status=${t.status} schema_version=${t.schema_version}` +
          (renamed === null ? "" : ` staff-present-stylists-absent=${renamed}`),
      );
    }
    const roles: Report["roles"] = {};
    for (const table of ["user", "memberships", "team_invitations"] as const) {
      const [c] = await rows<{ provider: number; stylist: number }>(
        sql`SELECT count(*) FILTER (WHERE role = 'provider')::int AS provider,
                   count(*) FILTER (WHERE role = 'stylist')::int AS stylist
            FROM ${sql.identifier(table)}`,
      );
      roles[table] = c;
      console.log(`roles ${table}: provider=${c.provider} stylist=${c.stylist}`);
    }
    const [j] = await rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}`,
    );
    console.log(`journal 0026 row (created_at=${entry.when}) present=${j.n > 0}`);
    return { tenants, roles, journalRowPresent: j.n > 0 };
  }

  const before = await report("report (before)");
  const doPublic = scope === "all" || scope === "public";
  const doTenants = scope === "all" || scope === "tenants";
  const at40 = before.tenants.filter((t) => t.version === 40);

  if (!apply) {
    console.log("\n[rollback-0040] dry run, nothing changed. Would run:");
    if (doPublic) {
      console.log(`  public: ${downStatements.length} down statements + DELETE journal row, one transaction`);
    }
    if (doTenants) {
      console.log(`  tenants (${at40.length}): ${at40.map((t) => t.slug).join(", ") || "(none)"}`);
    }
    process.exit(0);
  }

  let errors = 0;

  if (doPublic) {
    try {
      await publicDb.transaction(async (tx) => {
        for (const stmt of downStatements) await tx.execute(sql.raw(stmt));
        await tx.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}`);
      });
      console.log("\n[rollback-0040] public: rolled back 0026 and removed its journal row");
    } catch (err) {
      errors++;
      console.error(`\n[rollback-0040] public rollback FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (doTenants) {
    for (const t of at40) {
      const r = await rollbackTenant(t.slug, 40, 39);
      if (r.error) {
        errors++;
        console.error(`[rollback-0040] tenant ${t.slug} FAILED: ${r.error}`);
      } else {
        console.log(`[rollback-0040] tenant ${t.slug}: ${r.fromVersion} -> ${r.toVersion}`);
      }
    }
  }

  const after = await report("report (post-check)");
  const leftovers: string[] = [];
  if (doTenants) {
    for (const t of after.tenants) if (t.version === 40) leftovers.push(`tenant ${t.slug} still at 40`);
  }
  if (doPublic) {
    for (const [table, c] of Object.entries(after.roles)) {
      if (c.provider > 0) leftovers.push(`${table} has ${c.provider} 'provider' row(s)`);
    }
    if (after.journalRowPresent) leftovers.push("0026 journal row still present");
  }
  if (errors > 0) leftovers.push(`${errors} error(s) occurred`);

  if (leftovers.length > 0) {
    console.error(`\n[rollback-0040] POST-CHECK FAILED:\n  - ${leftovers.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\n[rollback-0040] post-check passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[rollback-0040] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
