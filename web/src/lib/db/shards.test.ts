import { afterEach, expect, it } from "vitest";
import postgres from "postgres";
import { getShardClient } from "@/lib/db/shards";

const previousUrls = process.env.DATABASE_SHARD_URLS;

afterEach(() => {
  if (previousUrls === undefined) delete process.env.DATABASE_SHARD_URLS;
  else process.env.DATABASE_SHARD_URLS = previousUrls;
});

it("rejects a shard map that names primary", () => {
  process.env.DATABASE_SHARD_URLS =
    '{"primary":"postgres://shard.invalid/db"}';
  expect(() => getShardClient("s2")).toThrow(
    "DATABASE_SHARD_URLS must not contain primary",
  );
});

it("rejects an unknown shard name", () => {
  process.env.DATABASE_SHARD_URLS =
    '{"other":"postgres://shard.invalid/db"}';
  expect(() => getShardClient("s2")).toThrow('Unknown shard "s2"');
});

const shardTestUrl = process.env.DATABASE_SHARD_TEST_URL;
const itShard = shardTestUrl && process.env.DATABASE_URL ? it : it.skip;

itShard(
  "stores shard-e2e on s2 and leaves the primary database without that schema",
  async () => {
    const previousShard = process.env.NEW_TENANT_SHARD;
    process.env.NEW_TENANT_SHARD = "s2";
    process.env.DATABASE_SHARD_URLS = JSON.stringify({ s2: shardTestUrl });

    const primary = postgres(process.env.DATABASE_URL!, { max: 1 });
    const shard = postgres(shardTestUrl!, { max: 1 });
    try {
      await primary`DELETE FROM tenants WHERE slug = 'shard-e2e'`;
      await primary`DROP SCHEMA IF EXISTS "tenant_shard-e2e" CASCADE`;
      await shard`DROP SCHEMA IF EXISTS "tenant_shard-e2e" CASCADE`;

      const { provisionTenantSchema, dropTenantSchema } = await import(
        "@/lib/tenant/provision"
      );
      const { withTenantDb } = await import("@/lib/db/tenant");
      const { applyPendingMigrations } = await import(
        "@/lib/tenant/migrations/runner"
      );

      await provisionTenantSchema({ name: "Shard E2E", slug: "shard-e2e" });
      await withTenantDb("shard-e2e", async (db, tables) => {
        await db.insert(tables.clients).values({
          name: "Shard Client",
          email: "shard@test.com",
        });
      });

      const clients = await shard<{ name: string }[]>`
        SELECT name FROM "tenant_shard-e2e".clients
      `;
      expect(clients.map((row) => row.name)).toEqual(["Shard Client"]);

      const namespaces = await primary<{ ns: string | null }[]>`
        SELECT to_regnamespace('tenant_shard-e2e') AS ns
      `;
      expect(namespaces[0]?.ns).toBeNull();

      const [meta] = await primary<{ db_shard: string; schema_version: number }[]>`
        SELECT db_shard, schema_version FROM tenants WHERE slug = 'shard-e2e'
      `;
      expect(meta.db_shard).toBe("s2");

      const results = await applyPendingMigrations();
      const own = results.find((result) => result.slug === "shard-e2e");
      expect(own).toEqual({
        slug: "shard-e2e",
        fromVersion: Number(meta.schema_version),
        toVersion: Number(meta.schema_version),
        applied: 0,
      });

      await dropTenantSchema("shard-e2e");
      const left = await shard<{ name: string | null }[]>`
        SELECT to_regnamespace('tenant_shard-e2e') AS name
      `;
      expect(left[0]?.name).toBeNull();
    } finally {
      await shard`DROP SCHEMA IF EXISTS "tenant_shard-e2e" CASCADE`.catch(
        () => undefined,
      );
      await primary`DROP SCHEMA IF EXISTS "tenant_shard-e2e" CASCADE`.catch(
        () => undefined,
      );
      await primary`DELETE FROM tenants WHERE slug = 'shard-e2e'`.catch(() => undefined);
      await primary.end();
      await shard.end();
      if (previousShard === undefined) delete process.env.NEW_TENANT_SHARD;
      else process.env.NEW_TENANT_SHARD = previousShard;
    }
  },
  120_000,
);
