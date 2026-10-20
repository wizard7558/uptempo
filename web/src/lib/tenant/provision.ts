import { sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { getShardClient, getShardForSlug, newTenantShard } from "@/lib/db/shards";
import { tenants } from "@/lib/db/schema";
import { hairSalon } from "@/lib/verticals/hair-salon";
import { slugSchema } from "./slug-validation";
import {
  getMigrationsAfterBaseline,
  TENANT_BASELINE_VERSION,
} from "./migrations";
import { buildTenantBaselineStatements } from "./migrations/baseline";

/**
 * Provisions a complete tenant schema with all tables, indexes, constraints,
 * and foreign keys. Uses raw SQL because drizzle-kit cannot handle dynamic
 * schema names.
 *
 * The slug is validated before use in SQL as defense in depth against injection.
 * Everything runs inside a transaction for atomicity.
 */
export async function provisionTenantSchema(data: {
  name: string;
  slug: string;
  timezone?: string;
  /** Test hook: stop after this registry version; default LATEST. */
  throughVersion?: number;
}): Promise<{ tenantId: string; schemaName: string }> {
  // Validate slug to prevent SQL injection in schema names
  slugSchema.parse(data.slug);

  const schemaName = `tenant_${data.slug}`;
  const shardName = newTenantShard();
  // Primary keeps the registry insert on the same transaction as the DDL.
  const ddl = (
    shardName === "primary" ? publicDb : getShardClient(shardName).db
  ) as typeof publicDb;

  const result = await ddl.transaction(async (tx) => {
    // 1. Create the schema
    await tx.execute(
      sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
    );

    // 2. Ensure btree_gist extension is available (needed for exclusion constraint)
    await tx.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS btree_gist`));

    // Execute the tables, indexes, and constraints in the version-6 baseline.
    for (const statement of buildTenantBaselineStatements(schemaName)) {
      await tx.execute(statement);
    }

    // Apply every registry migration above the baseline version so newly
    // provisioned tenants match the latest schema. The list comes from the
    // registry, so new migrations apply here with no edit to this file.
    const pendingMigrations = getMigrationsAfterBaseline().filter(
      (m) => data.throughVersion === undefined || m.version <= data.throughVersion,
    );
    for (const migration of pendingMigrations) {
      for (const statement of migration.up(schemaName)) {
        await tx.execute(statement);
      }
    }
    const appliedVersion =
      pendingMigrations.length > 0
        ? pendingMigrations[pendingMigrations.length - 1].version
        : TENANT_BASELINE_VERSION;

    const registry = {
      name: data.name,
      slug: data.slug,
      timezone: data.timezone ?? "America/New_York",
      schemaVersion: appliedVersion,
      industry: "hair_salon" as const,
      modules: [...hairSalon.modules],
      dbShard: shardName,
    };

    if (shardName === "primary") {
      const [tenant] = await tx
        .insert(tenants)
        .values(registry)
        .onConflictDoUpdate({
          target: tenants.slug,
          set: {
            schemaVersion: appliedVersion,
            dbShard: shardName,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { kind: "primary" as const, id: tenant.id };
    }

    return { kind: "shard" as const, appliedVersion };
  });

  if (result.kind === "primary") {
    return { tenantId: result.id, schemaName };
  }

  const [tenant] = await publicDb
    .insert(tenants)
    .values({
      name: data.name,
      slug: data.slug,
      timezone: data.timezone ?? "America/New_York",
      schemaVersion: result.appliedVersion,
      industry: "hair_salon",
      modules: [...hairSalon.modules],
      dbShard: shardName,
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: {
        schemaVersion: result.appliedVersion,
        dbShard: shardName,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    tenantId: tenant.id,
    schemaName,
  };
}

/**
 * Drops a tenant schema and removes the tenant registry entry.
 * USE WITH EXTREME CAUTION. Primarily for test cleanup.
 */
export async function dropTenantSchema(slug: string): Promise<void> {
  slugSchema.parse(slug);
  const schemaName = `tenant_${slug}`;
  const shard = await getShardForSlug(slug);

  if (shard === "primary") {
    await publicDb.transaction(async (tx) => {
      await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await tx.delete(tenants).where(sql`slug = ${slug}`);
    });
    return;
  }

  await getShardClient(shard).db.execute(
    sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`),
  );
  await publicDb.delete(tenants).where(sql`slug = ${slug}`);
}
