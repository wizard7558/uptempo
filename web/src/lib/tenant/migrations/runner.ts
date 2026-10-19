import { eq, sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { getShardClient, getShardForSlug } from "@/lib/db/shards";
import { tenants } from "@/lib/db/schema";
import { listActiveTenants } from "@/lib/tenant/registry";
import { migrations } from "./index";

/**
 * Result of running migrations against a single tenant.
 */
export interface MigrationResult {
  slug: string;
  fromVersion: number;
  toVersion: number;
  applied: number;
  error?: string;
}

/**
 * Apply pending schema migrations to a single tenant.
 * Uses row-level locking (SELECT ... FOR UPDATE) and chooses each migration
 * from the schema version read under that lock. `currentVersion` remains the
 * caller's hint and is returned as `fromVersion` for API compatibility.
 *
 * Each migration runs in its own transaction so a failure
 * mid-sequence stops further migrations for this tenant but
 * does not roll back already-applied ones.
 */
export async function migrateTenant(
  slug: string,
  currentVersion: number,
  untilVersion?: number,
): Promise<MigrationResult> {
  const schemaName = `tenant_${slug}`;
  const ceiling = untilVersion ?? Number.POSITIVE_INFINITY;
  let applied = 0;
  let lastVersion = currentVersion;
  const shard = await getShardForSlug(slug);

  for (;;) {
    try {
      const outcome = await publicDb.transaction(async (tx) => {
        const lockedRows = Array.from(
          (await tx.execute(
            sql`SELECT ${tenants.schemaVersion} AS v FROM ${tenants} WHERE ${tenants.slug} = ${slug} FOR UPDATE`,
          )) as Iterable<{ v: number | string | null }>,
        );
        const lockedRow = lockedRows[0];
        if (!lockedRow) {
          throw new Error(`tenant "${slug}" not found in public.tenants`);
        }

        const lockedVersion = Number(lockedRow.v);
        if (!Number.isInteger(lockedVersion)) {
          throw new Error(`tenant "${slug}" has invalid schema_version ${String(lockedRow.v)}`);
        }
        // Keep failures and no-work results anchored to the value observed under lock.
        lastVersion = lockedVersion;

        const migration = migrations
          .filter((m) => m.version > lockedVersion && m.version <= ceiling)
          .sort((a, b) => a.version - b.version)[0];
        if (!migration) {
          return { version: lockedVersion, appliedMigration: false };
        }

        // DDL for another shard cannot share this transaction.
        const statements = migration.up(schemaName);
        if (shard === "primary") {
          for (const stmt of statements) {
            await tx.execute(stmt);
          }
        } else {
          const shardDb = getShardClient(shard).db;
          for (const stmt of statements) {
            await shardDb.execute(stmt);
          }
        }

        // Atomically update schema version
        await tx
          .update(tenants)
          .set({ schemaVersion: migration.version, updatedAt: new Date() })
          .where(eq(tenants.slug, slug));

        return { version: migration.version, appliedMigration: true };
      });

      lastVersion = outcome.version;
      if (!outcome.appliedMigration) {
        return {
          slug,
          fromVersion: currentVersion,
          toVersion: outcome.version,
          applied,
        };
      }

      applied++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        slug,
        fromVersion: currentVersion,
        toVersion: lastVersion,
        applied,
        error: errorMessage,
      };
    }
  }

  return { slug, fromVersion: currentVersion, toVersion: lastVersion, applied };
}

/**
 * Apply `down` for versions in (targetVersion, currentVersion], newest first.
 * One transaction per version. Executes nothing if any migration in range lacks `down`.
 */
export async function rollbackTenant(
  slug: string,
  currentVersion: number,
  targetVersion: number,
): Promise<MigrationResult> {
  const schemaName = `tenant_${slug}`;
  const toRevert = migrations
    .filter((m) => m.version > targetVersion && m.version <= currentVersion)
    .sort((a, b) => b.version - a.version);
  const noDown = toRevert.find((m) => !m.down);
  if (noDown) {
    return {
      slug,
      fromVersion: currentVersion,
      toVersion: currentVersion,
      applied: 0,
      error: `migration ${noDown.version} has no down`,
    };
  }

  let applied = 0;
  let lastVersion = currentVersion;
  const shard = await getShardForSlug(slug);
  for (const m of toRevert) {
    try {
      await publicDb.transaction(async (tx) => {
        const locked = Array.from(
          (await tx.execute(
            sql`SELECT ${tenants.schemaVersion} AS v FROM ${tenants} WHERE ${tenants.slug} = ${slug} FOR UPDATE`,
          )) as Iterable<{ v: number }>,
        );
        if (Number(locked[0]?.v) !== m.version) {
          throw new Error(`expected schema_version ${m.version}, found ${locked[0]?.v}`);
        }
        const statements = m.down!(schemaName);
        if (shard === "primary") {
          for (const stmt of statements) {
            await tx.execute(stmt);
          }
        } else {
          const shardDb = getShardClient(shard).db;
          for (const stmt of statements) {
            await shardDb.execute(stmt);
          }
        }
        await tx
          .update(tenants)
          .set({ schemaVersion: m.version - 1, updatedAt: new Date() })
          .where(eq(tenants.slug, slug));
      });
      applied++;
      lastVersion = m.version - 1;
    } catch (err) {
      return {
        slug,
        fromVersion: currentVersion,
        toVersion: lastVersion,
        applied,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { slug, fromVersion: currentVersion, toVersion: lastVersion, applied };
}

/**
 * Apply pending migrations to all active tenants, sequentially.
 * Sequential execution avoids DDL lock contention.
 * A failure for one tenant does not prevent other tenants from migrating.
 */
export async function applyPendingMigrations(): Promise<MigrationResult[]> {
  const activeTenants = await listActiveTenants();
  const results: MigrationResult[] = [];

  for (const tenant of activeTenants) {
    try {
      const result = await migrateTenant(tenant.slug, tenant.schemaVersion);
      results.push(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      results.push({
        slug: tenant.slug,
        fromVersion: tenant.schemaVersion,
        toVersion: tenant.schemaVersion,
        applied: 0,
        error: errorMessage,
      });
    }
  }

  return results;
}
