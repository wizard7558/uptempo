import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  findClientByEmailForTenant,
} from "./for-tenant";

const TEST_DATABASE_URL = process.env.REVIEW_OTP_TEST_DATABASE_URL;
const TEST_DATABASE_RUN_MARKER = process.env.REVIEW_OTP_TEST_RUN_MARKER;
const databaseDescribe =
  TEST_DATABASE_URL === undefined && TEST_DATABASE_RUN_MARKER === undefined
    ? describe.skip
    : describe;

async function assertOwnedTestDatabase(client: Sql) {
  if (!TEST_DATABASE_URL || !TEST_DATABASE_RUN_MARKER) {
    throw new Error("Client lookup integration tests require explicit database URL and ownership marker");
  }
  const parsed = new URL(TEST_DATABASE_URL);
  const databaseName = parsed.pathname.slice(1);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    !parsed.port ||
    !/^uptempo_score_[a-z0-9_]+$/.test(databaseName) ||
    parsed.search ||
    parsed.hash ||
    process.env.DATABASE_URL !== TEST_DATABASE_URL ||
    !/^uptempo-review-otp-disposable:[0-9]+-[0-9]+$/.test(TEST_DATABASE_RUN_MARKER)
  ) {
    throw new Error("Client lookup integration tests require the named isolated loopback database");
  }

  const [identity] = await client`
    SELECT current_database() AS database_name,
           pg_catalog.shobj_description(database_row.oid, 'pg_database') AS marker
    FROM pg_catalog.pg_database AS database_row
    WHERE database_row.datname = current_database()
  `;
  if (
    identity?.database_name !== databaseName ||
    identity?.marker !== TEST_DATABASE_RUN_MARKER
  ) {
    throw new Error("Client lookup integration tests refused a database without the matching ownership marker");
  }
}

databaseDescribe("tenant email lookup with isolated public PostgreSQL", () => {
  let tenantSlug: string;
  let withTenantDb: typeof import("@/lib/db/tenant").withTenantDb;
  let provisionTenantSchema: typeof import("@/lib/tenant/provision").provisionTenantSchema;
  let dropTenantSchema: typeof import("@/lib/tenant/provision").dropTenantSchema;
  let closeShardClients: typeof import("@/lib/db/shards").closeShardClients;
  let closePublicDb: typeof import("@/lib/db").closePublicDb;

  beforeAll(async () => {
    const observer = postgres(TEST_DATABASE_URL!, { max: 1 });
    try {
      await assertOwnedTestDatabase(observer);
    } finally {
      await observer.end({ timeout: 5 });
    }
    tenantSlug = `client-${process.pid}-${Date.now()}`;
    ({ withTenantDb } = await import("@/lib/db/tenant"));
    ({ provisionTenantSchema, dropTenantSchema } = await import("@/lib/tenant/provision"));
    ({ closeShardClients } = await import("@/lib/db/shards"));
    ({ closePublicDb } = await import("@/lib/db"));
    await provisionTenantSchema({ name: "Synthetic client lookup fixture", slug: tenantSlug });
  }, 180_000);

  beforeEach(async () => {
    await withTenantDb(tenantSlug, async (db, { clients }) => {
      await db.delete(clients);
    });
  });

  afterAll(async () => {
    if (dropTenantSchema && tenantSlug) {
      try {
        await dropTenantSchema(tenantSlug);
      } catch {
        // Cleanup is best-effort for the disposable isolated test tenant.
      }
    }
    if (closeShardClients) await closeShardClients();
    if (closePublicDb) await closePublicDb();
  }, 30_000);

  it("matches percent and underscore as literal email characters", async () => {
    const decoys = await withTenantDb(tenantSlug, async (db, { clients }) =>
      db
        .insert(clients)
        .values([
          { name: "Underscore wildcard decoy", email: "firstXlast@example.test" },
          { name: "Percent wildcard decoy", email: "tag-any-review@example.test" },
        ])
        .returning({ id: clients.id }),
    );

    await expect(
      findClientByEmailForTenant(tenantSlug, "first_last@example.test"),
    ).resolves.toBeNull();
    await expect(
      findClientByEmailForTenant(tenantSlug, "tag%-review@example.test"),
    ).resolves.toBeNull();

    const exact = await withTenantDb(tenantSlug, async (db, { clients }) =>
      db
        .insert(clients)
        .values([
          { name: "Exact underscore", email: "first_last@example.test" },
          { name: "Exact percent", email: "tag%-review@example.test" },
        ])
        .returning({ id: clients.id }),
    );

    await expect(
      findClientByEmailForTenant(tenantSlug, " FIRST_LAST@EXAMPLE.TEST "),
    ).resolves.toMatchObject({ id: exact[0].id });
    await expect(
      findClientByEmailForTenant(tenantSlug, "TAG%-REVIEW@EXAMPLE.TEST"),
    ).resolves.toMatchObject({ id: exact[1].id });
    expect(exact.map(({ id }) => id)).not.toContain(decoys[0].id);
    expect(exact.map(({ id }) => id)).not.toContain(decoys[1].id);
  });

  it("keeps the deleted-client filter while normalizing case and whitespace", async () => {
    const [deleted, current] = await withTenantDb(tenantSlug, async (db, { clients }) =>
      db
        .insert(clients)
        .values([
          { name: "Deleted synthetic client", email: "case@example.test", deletedAt: new Date() },
          { name: "Current synthetic client", email: "Current@Example.Test" },
        ])
        .returning({ id: clients.id }),
    );

    await expect(
      findClientByEmailForTenant(tenantSlug, " case@example.test "),
    ).resolves.toBeNull();
    await expect(
      findClientByEmailForTenant(tenantSlug, " current@example.test "),
    ).resolves.toMatchObject({ id: current.id });
    expect(current.id).not.toBe(deleted.id);
  });
});
