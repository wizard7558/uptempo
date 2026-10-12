import { pgSchema } from "drizzle-orm/pg-core";
import { createTenantTables, type TenantTables } from "./tables";

const MAX_CACHE_SIZE = 100;
const schemaCache = new Map<string, TenantTables>();

/**
 * Returns the Drizzle table definitions for a tenant schema.
 * Results are cached with LRU eviction at MAX_CACHE_SIZE entries.
 */
export function getTenantSchema(slug: string): TenantTables {
  let tables = schemaCache.get(slug);
  if (!tables) {
    if (schemaCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry (first key in Map insertion order)
      const firstKey = schemaCache.keys().next().value;
      if (firstKey) schemaCache.delete(firstKey);
    }
    const schema = pgSchema(`tenant_${slug}`);
    tables = createTenantTables(schema);
    schemaCache.set(slug, tables);
  }
  return tables;
}

/** Clears the schema cache. Primarily for testing. */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

export type { TenantTables };
