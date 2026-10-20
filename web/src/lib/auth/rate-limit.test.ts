import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { eq } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { otpRateLimits } from "@/lib/db/schema";
import { consumeRateLimit } from "./rate-limit";

const TEST_DATABASE_URL = process.env.REVIEW_OTP_TEST_DATABASE_URL;
const TEST_DATABASE_RUN_MARKER = process.env.REVIEW_OTP_TEST_RUN_MARKER;
const databaseDescribe =
  TEST_DATABASE_URL === undefined && TEST_DATABASE_RUN_MARKER === undefined
    ? describe.skip
    : describe;

async function assertOwnedTestDatabase(client: Sql) {
  if (!TEST_DATABASE_URL || !TEST_DATABASE_RUN_MARKER) {
    throw new Error("Review OTP integration tests require explicit database URL and ownership marker");
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
    throw new Error("Rate-limit integration tests require the named isolated loopback database");
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
    throw new Error("Rate-limit integration tests refused a database without the matching ownership marker");
  }
}

async function waitForAdvisoryLockWaiter(client: Sql) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [waiter] = await client`
      SELECT count(*)::integer AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
    `;
    if (Number(waiter.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("OTP rate-limit request did not wait for the tenant advisory lock");
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

databaseDescribe("OTP rate limits with isolated public PostgreSQL", () => {
  let tenantSlug: string;
  let observer: Sql;
  let provisionTenantSchema: typeof import("@/lib/tenant/provision").provisionTenantSchema;
  let dropTenantSchema: typeof import("@/lib/tenant/provision").dropTenantSchema;
  let closeShardClients: typeof import("@/lib/db/shards").closeShardClients;
  let closePublicDb: typeof import("@/lib/db").closePublicDb;

  beforeAll(async () => {
    observer = postgres(TEST_DATABASE_URL!, { max: 16 });
    await assertOwnedTestDatabase(observer);
    tenantSlug = `ratelimit-${process.pid}-${Date.now()}`;
    ({ provisionTenantSchema, dropTenantSchema } = await import("@/lib/tenant/provision"));
    ({ closeShardClients } = await import("@/lib/db/shards"));
    ({ closePublicDb } = await import("@/lib/db"));
    await provisionTenantSchema({ name: "Synthetic rate-limit fixture", slug: tenantSlug });
  }, 180_000);

  beforeEach(async () => {
    await publicDb.delete(otpRateLimits).where(eq(otpRateLimits.tenantSlug, tenantSlug));
  });

  afterAll(async () => {
    if (tenantSlug) {
      await publicDb.delete(otpRateLimits).where(eq(otpRateLimits.tenantSlug, tenantSlug));
      if (dropTenantSchema) {
        try {
          await dropTenantSchema(tenantSlug);
        } catch {
          // A tenant rollback race test can already have removed the fixture.
        }
      }
    }
    if (observer) await observer.end({ timeout: 5 });
    if (closeShardClients) await closeShardClients();
    if (closePublicDb) await closePublicDb();
  }, 30_000);

  it("atomically enforces identifier budgets across concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeRateLimit({
          tenantSlug,
          scope: "identifier",
          key: " Review@Example.Test ",
          limit: 3,
          windowMs: 10 * 60 * 1000,
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(9);

    const [row] = await publicDb
      .select()
      .from(otpRateLimits)
      .where(eq(otpRateLimits.tenantSlug, tenantSlug));
    expect(row).toMatchObject({
      scope: "identifier",
      normalizedKey: "review@example.test",
      attemptCount: 4,
    });
  }, 15_000);

  it("fails closed for an unknown registry tenant without creating a rate row", async () => {
    const unknownTenant = `${tenantSlug}-missing`;
    await expect(
      consumeRateLimit({
        tenantSlug: unknownTenant,
        scope: "ip",
        key: "203.0.113.7",
        limit: 5,
        windowMs: 10 * 60 * 1000,
      }),
    ).rejects.toThrow("Cannot record an OTP rate limit for an unknown tenant");
    const rows = await publicDb
      .select()
      .from(otpRateLimits)
      .where(eq(otpRateLimits.tenantSlug, unknownTenant));
    expect(rows).toHaveLength(0);
  });

  it("does not recreate an OTP rate row when a request waits behind tenant rollback", async () => {
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const tenantLockKey = `app-review-otp-rate:${tenantSlug}`;
    const lockHolder = observer.begin(async (tx) => {
      await tx.unsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [tenantLockKey],
      );
      await tx.unsafe("DELETE FROM public.otp_rate_limits WHERE tenant_slug = $1", [tenantSlug]);
      await tx.unsafe(`DROP SCHEMA IF EXISTS "tenant_${tenantSlug}" CASCADE`);
      await tx.unsafe("DELETE FROM public.tenants WHERE slug = $1", [tenantSlug]);
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;

    const request = consumeRateLimit({
      tenantSlug,
      scope: "identifier",
      key: "review@example.test",
      limit: 3,
      windowMs: 10 * 60 * 1000,
    });
    const requestFailure = expect(request).rejects.toThrow(
      "Cannot record an OTP rate limit for an unknown tenant",
    );
    try {
      await waitForAdvisoryLockWaiter(observer);
    } finally {
      releaseLock.resolve();
      await lockHolder;
    }

    await requestFailure;
    const rows = await publicDb
      .select()
      .from(otpRateLimits)
      .where(eq(otpRateLimits.tenantSlug, tenantSlug));
    expect(rows).toHaveLength(0);
  }, 15_000);
});
