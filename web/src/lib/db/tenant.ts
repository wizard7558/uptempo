import { drizzle } from "drizzle-orm/postgres-js";
import { getShardClient, getShardForSlug } from "@/lib/db/shards";
import { getTenantSchema, type TenantTables } from "./tenant-schema";

export type TenantDb = ReturnType<typeof drizzle>;

/** Drizzle transaction handle passed to `db.transaction(...)` callbacks */
export type TenantTransaction = Parameters<
  Parameters<TenantDb["transaction"]>[0]
>[0];

/**
 * Executes a callback with a drizzle instance and schema-qualified table references
 * for the specified tenant. Uses the query builder pattern (not relational queries)
 * since relational queries are not compatible with dynamic schemas.
 *
 * @example
 * const clients = await withTenantDb("acme", async (db, tables) => {
 *   return db.select().from(tables.clients);
 * });
 */
export async function withTenantDb<T>(
  slug: string,
  callback: (db: TenantDb, tables: TenantTables) => Promise<T>,
): Promise<T> {
  const tables = getTenantSchema(slug);
  const shard = await getShardForSlug(slug);
  const tenantDb = getShardClient(shard).db;
  return callback(tenantDb, tables);
}
