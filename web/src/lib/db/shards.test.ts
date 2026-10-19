import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import postgres from "postgres";
import { getShardClient } from "@/lib/db/shards";
import * as tenantRegistry from "@/lib/tenant/registry";

const previousUrls = process.env.DATABASE_SHARD_URLS;

afterEach(() => {
  vi.restoreAllMocks();
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
    const slug = `shard-e2e-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const schema = `tenant_${slug}`;
    const previousShard = process.env.NEW_TENANT_SHARD;
    process.env.NEW_TENANT_SHARD = "s2";
    process.env.DATABASE_SHARD_URLS = JSON.stringify({ s2: shardTestUrl });

    const primary = postgres(process.env.DATABASE_URL!, { max: 1 });
    const shard = postgres(shardTestUrl!, { max: 1 });
    let restoreInventory: (() => void) | undefined;
    try {
      const { provisionTenantSchema, dropTenantSchema } = await import(
        "@/lib/tenant/provision"
      );
      const { withTenantDb } = await import("@/lib/db/tenant");
      const { applyPendingMigrations } = await import(
        "@/lib/tenant/migrations/runner"
      );

      await provisionTenantSchema({ name: "Shard E2E", slug });
      await withTenantDb(slug, async (db, tables) => {
        await db.insert(tables.clients).values({
          name: "Shard Client",
          email: `${slug}@test.com`,
        });
      });

      const clients = await shard<{ name: string }[]>`
        SELECT name FROM ${shard(schema)}.clients
      `;
      expect(clients.map((row) => row.name)).toEqual(["Shard Client"]);

      const namespaces = await primary<{ ns: string | null }[]>`
        SELECT to_regnamespace(${schema}) AS ns
      `;
      expect(namespaces[0]?.ns).toBeNull();

      const [meta] = await primary<{ db_shard: string; schema_version: number }[]>`
        SELECT db_shard, schema_version FROM tenants WHERE slug = ${slug}
      `;
      expect(meta.db_shard).toBe("s2");

      const inventorySpy = vi.spyOn(tenantRegistry, "listActiveTenants").mockResolvedValue([
        { slug, schemaVersion: Number(meta.schema_version) } as Awaited<
          ReturnType<typeof tenantRegistry.listActiveTenants>
        >[number],
      ]);
      restoreInventory = () => inventorySpy.mockRestore();

      const results = await applyPendingMigrations();
      const own = results.find((result) => result.slug === slug);
      expect(own).toEqual({
        slug,
        fromVersion: Number(meta.schema_version),
        toVersion: Number(meta.schema_version),
        applied: 0,
      });

      await dropTenantSchema(slug);
      const left = await shard<{ name: string | null }[]>`
        SELECT to_regnamespace(${schema}) AS name
      `;
      expect(left[0]?.name).toBeNull();
    } finally {
      restoreInventory?.();
      await shard`DROP SCHEMA IF EXISTS ${shard(schema)} CASCADE`.catch(
        () => undefined,
      );
      await primary`DROP SCHEMA IF EXISTS ${primary(schema)} CASCADE`.catch(
        () => undefined,
      );
      await primary`DELETE FROM tenants WHERE slug = ${slug}`.catch(() => undefined);
      await primary.end();
      await shard.end();
      if (previousShard === undefined) delete process.env.NEW_TENANT_SHARD;
      else process.env.NEW_TENANT_SHARD = previousShard;
    }
  },
  120_000,
);
