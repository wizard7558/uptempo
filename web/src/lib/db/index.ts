import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _publicDb: PostgresJsDatabase<typeof schema>;

/** Lazily-initialized public DB (avoids build-time env var access). */
export function getPublicDb(): PostgresJsDatabase<typeof schema> {
  if (!_publicDb) {
    const client = postgres(process.env.DATABASE_URL!);
    _publicDb = drizzle(client, { schema });
  }
  return _publicDb;
}

/** Public schema database instance. Use for auth, tenant registry, and platform_clients only. */
export const publicDb = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_, prop, receiver) {
    const target = getPublicDb();
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

/**
 * @deprecated Use `publicDb` for public schema queries or `withTenantDb()` for tenant queries.
 * Will be removed after all action files are migrated to tenant context.
 */
export const db = publicDb;
