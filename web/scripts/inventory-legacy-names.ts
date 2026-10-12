/**
 * Read-only inventory of salon-era names (stylist|salon|beauty_bank) in tenant schemas.
 * SELECT only. Prints the DB host, never DATABASE_URL. Definitions are matched with the
 * schema name stripped, since tenant schema names (tenant_salon-*) would otherwise match.
 *
 *   npx tsx scripts/inventory-legacy-names.ts                    # all tenant_% schemas
 *   npx tsx scripts/inventory-legacy-names.ts --slug test-salon  # one tenant
 *   npx tsx scripts/inventory-legacy-names.ts --fingerprint <slug>  # schema fingerprint lines only
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const P = "(stylist|salon|beauty_bank)";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[inventory] DATABASE_URL is not set (.env.local). Aborting.");
    process.exit(1);
  }
  const { sql } = await import("drizzle-orm");
  const { publicDb } = await import("../src/lib/db");

  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> =>
    Array.from((await publicDb.execute(q)) as Iterable<T>);

  const fpSlug = argValue("--fingerprint");
  if (fpSlug) {
    const { schemaFingerprint } = await import("../src/lib/tenant/schema-fingerprint");
    for (const line of await schemaFingerprint(`tenant_${fpSlug}`)) console.log(line);
    process.exit(0);
  }

  const slug = argValue("--slug");
  console.log(`host: ${new URL(process.env.DATABASE_URL).host}`);
  const [v] = await rows<{ v: string }>(sql`SELECT current_setting('server_version_num') AS v`);
  console.log(`server_version_num: ${v.v}`);

  console.log("\n== tenants (slug, status, schema_version) ==");
  for (const t of await rows(sql`SELECT slug, status, schema_version FROM public.tenants ORDER BY slug`)) {
    console.log(JSON.stringify(t));
  }
  const zero = await rows(
    sql`SELECT slug FROM public.tenants WHERE status = 'active' AND schema_version = 0 ORDER BY slug`,
  );
  console.log(`active tenants with schema_version=0 (must be empty): ${JSON.stringify(zero.map((r) => r.slug))}`);

  const schemas = slug
    ? [`tenant_${slug}`]
    : (
        await rows<{ schema_name: string }>(
          sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant\_%' ORDER BY schema_name`,
        )
      ).map((r) => r.schema_name);

  for (const s of schemas) {
    console.log(`\n==================== ${s} ====================`);

    console.log("\n-- columns (table_name or column_name matches) --");
    const cols = await rows(sql`
      SELECT table_name, column_name, data_type, column_default FROM information_schema.columns
      WHERE table_schema = ${s} AND (table_name ~ ${P} OR column_name ~ ${P})
      ORDER BY table_name, column_name`);
    cols.forEach((r) => console.log(JSON.stringify(r)));
    console.log(`count: ${cols.length}`);

    console.log("\n-- constraints (name, table or definition matches) --");
    const cons = await rows(sql`
      SELECT t.relname AS tbl, c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${s}
        AND (c.conname ~ ${P} OR t.relname ~ ${P} OR replace(pg_get_constraintdef(c.oid), ${s}, '') ~ ${P})
      ORDER BY t.relname, c.conname`);
    cons.forEach((r) => console.log(JSON.stringify(r)));
    console.log(`count: ${cons.length}`);

    console.log("\n-- indexes (name or definition matches) --");
    const idx = await rows(sql`
      SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = ${s} AND (indexname ~ ${P} OR replace(indexdef, ${s}, '') ~ ${P})
      ORDER BY tablename, indexname`);
    idx.forEach((r) => console.log(JSON.stringify(r)));
    console.log(`count: ${idx.length}`);

    console.log("\n-- column defaults matching --");
    const defs = await rows(sql`
      SELECT table_name, column_name, column_default FROM information_schema.columns
      WHERE table_schema = ${s} AND column_default ~ ${P}
      ORDER BY table_name, column_name`);
    defs.forEach((r) => console.log(JSON.stringify(r)));
    console.log(`count: ${defs.length}`);

    console.log("\n-- other objects --");
    const [o] = await rows(sql`
      SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${s} AND c.relkind = 'S')::int AS sequences,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${s} AND c.relkind = 'v')::int AS views,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${s} AND c.relkind = 'm')::int AS matviews,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${s})::int AS functions,
        (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${s} AND NOT g.tgisinternal)::int AS triggers`);
    console.log(JSON.stringify(o));
  }

  console.log("\n==================== public role counts ====================");
  for (const t of ["user", "memberships", "team_invitations"]) {
    const counts = await rows(
      sql.raw(`SELECT role, count(*)::int AS n FROM public."${t}" GROUP BY role ORDER BY role`),
    );
    console.log(`${t}: ${JSON.stringify(counts)}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[inventory] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
