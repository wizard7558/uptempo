import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Read-only diagnostic: for a client name, dump their client_service_overrides
 * (with service names + base price/duration) so we can see whether overrides
 * exist and differ from the catalog. Usage:
 *   npx tsx scripts/diagnose-overrides.ts "Riley Sorenson"
 */
async function main() {
  const name = process.argv[2] ?? "Riley Sorenson";
  const { publicDb } = await import("../src/lib/db");
  const { withTenantDb } = await import("../src/lib/db/tenant");
  const { sql, eq, ilike, inArray } = await import("drizzle-orm");

  const tRows = await publicDb.execute(
    sql`SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug`,
  );
  const slugs = Array.from(tRows as Iterable<Record<string, unknown>>).map((r) => String(r.slug));

  for (const slug of slugs) {
    await withTenantDb(slug, async (db, { clients, clientServiceOverrides, services }) => {
      const matched = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(ilike(clients.name, `%${name}%`));
      if (matched.length === 0) return;

      // Dump the catalog so we can spot duplicate/renamed services.
      const allSvcs = await db
        .select({ id: services.id, name: services.name, priceCents: services.priceCents, dur: services.defaultDurationMinutes })
        .from(services);
      console.log(`\n[${slug}] services (${allSvcs.length}):`);
      for (const s of allSvcs) {
        console.log(`   ${s.name}  $${(s.priceCents ?? 0) / 100} / ${s.dur}min   id=${s.id}`);
      }

      for (const c of matched) {
        const ov = await db
          .select({
            serviceId: clientServiceOverrides.serviceId,
            durationMinutes: clientServiceOverrides.durationMinutes,
            priceCents: clientServiceOverrides.priceCents,
          })
          .from(clientServiceOverrides)
          .where(eq(clientServiceOverrides.clientId, c.id));

        console.log(`\n[${slug}] client "${c.name}" id=${c.id} → ${ov.length} override(s)`);
        if (ov.length === 0) continue;
        const svcIds = ov.map((o) => o.serviceId);
        const svcs = await db
          .select({ id: services.id, name: services.name, priceCents: services.priceCents, dur: services.defaultDurationMinutes })
          .from(services)
          .where(inArray(services.id, svcIds));
        const byId = new Map(svcs.map((s) => [s.id, s]));
        for (const o of ov) {
          const s = byId.get(o.serviceId);
          console.log(
            `   • ${s?.name ?? o.serviceId}: override price=${o.priceCents ?? "—"} dur=${o.durationMinutes ?? "—"}  | base price=${s?.priceCents ?? "—"} dur=${s?.dur ?? "—"}`,
          );
        }
      }
    });
  }
  process.exit(0);
}
main();
