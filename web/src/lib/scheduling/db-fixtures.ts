/**
 * Test-only helpers for integration tests that need a real tenant schema.
 * Imports are dynamic so a test file can still load (and skip) without DATABASE_URL.
 */
export type ScratchTenant = {
  slug: string;
  schema: string;
  /** Run raw SQL against the database and return the rows. */
  run: (sqlText: string) => Promise<Record<string, unknown>[]>;
  drop: () => Promise<void>;
};

/** Provisions a throwaway tenant at the latest schema version. */
export async function scratchTenant(tag: string): Promise<ScratchTenant> {
  const { provisionTenantSchema, dropTenantSchema } = await import("@/lib/tenant/provision");
  const { publicDb } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const slug = `${tag.toLowerCase().replace(/[^a-z0-9]/g, "")}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await provisionTenantSchema({ name: `Scratch ${tag}`, slug });
  return {
    slug,
    schema: `tenant_${slug}`,
    run: async (sqlText) =>
      Array.from((await publicDb.execute(sql.raw(sqlText))) as Iterable<Record<string, unknown>>),
    drop: async () => {
      try {
        await dropTenantSchema(slug);
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}
