import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import postgres, { type Sql } from "postgres";
import { eq } from "drizzle-orm";
import {
  createReviewVerificationForTenant,
  createVerificationForTenant,
  MAX_ATTEMPTS,
  normalizeBookingIdentifier,
  normalizeBookingPhone,
  OTP_EXPIRY_SECONDS,
  readReviewOtpConfig,
  REVIEW_OTP_MAX_AGE_MS,
  verifyCodeForTenant,
} from "./otp";

const REVIEW_ENV_KEYS = [
  "REVIEW_OTP_EMAIL",
  "REVIEW_OTP_CODE",
  "REVIEW_OTP_TENANT_SLUG",
  "REVIEW_OTP_EXPIRES_AT",
] as const;
const previousReviewEnv = Object.fromEntries(
  REVIEW_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof REVIEW_ENV_KEYS)[number], string | undefined>;
const TEST_DATABASE_URL = process.env.REVIEW_OTP_TEST_DATABASE_URL;
const TEST_DATABASE_RUN_MARKER = process.env.REVIEW_OTP_TEST_RUN_MARKER;
const databaseDescribe =
  TEST_DATABASE_URL === undefined && TEST_DATABASE_RUN_MARKER === undefined
    ? describe.skip
    : describe;
const REVIEW_EMAIL = "reviewer@example.com";

let reviewTenantSlug = "review-studio";
let otherTenantSlug = "other-studio";

function clearReviewConfig() {
  for (const key of REVIEW_ENV_KEYS) delete process.env[key];
}

function restoreReviewConfig() {
  for (const key of REVIEW_ENV_KEYS) {
    const value = previousReviewEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setReviewConfig(
  expiresAt = new Date(Date.now() + 5 * 60 * 1000),
  tenantSlug = reviewTenantSlug,
) {
  process.env.REVIEW_OTP_EMAIL = "Reviewer@Example.com";
  process.env.REVIEW_OTP_CODE = "381624";
  process.env.REVIEW_OTP_TENANT_SLUG = tenantSlug;
  process.env.REVIEW_OTP_EXPIRES_AT = expiresAt.toISOString();
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function assertOwnedTestDatabase(client: Sql) {
  if (!TEST_DATABASE_URL || !TEST_DATABASE_RUN_MARKER) {
    throw new Error("OTP integration tests require explicit database URL and ownership marker");
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
    throw new Error("OTP integration tests require the named isolated loopback database");
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
    throw new Error("OTP integration tests refused a database without the matching ownership marker");
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
  throw new Error("OTP verification did not wait for the advisory lock");
}

beforeEach(clearReviewConfig);
afterEach(restoreReviewConfig);
afterAll(restoreReviewConfig);

describe("booking OTP configuration and normalization", () => {
  it("normalizes valid emails and current app phone formats, and rejects invalid identifiers", () => {
    expect(normalizeBookingIdentifier("  Reviewer@Example.COM ")).toEqual({
      identifier: "reviewer@example.com",
      type: "email",
    });
    expect(normalizeBookingIdentifier("(555) 123-4567")).toEqual({
      identifier: "+15551234567",
      type: "phone",
    });
    expect(normalizeBookingPhone("1 555 123 4567")).toBe("+15551234567");
    expect(normalizeBookingIdentifier("not-an-email@")).toBeNull();
    expect(normalizeBookingIdentifier("letters1234567")).toBeNull();
    expect(normalizeBookingPhone("too short")).toBeNull();
  });

  it("requires all four bounded review settings and validates expiry, tenant, email, and six-digit code", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    expect(readReviewOtpConfig(now)).toEqual({ status: "absent" });

    process.env.REVIEW_OTP_EMAIL = "Reviewer@Example.com";
    expect(readReviewOtpConfig(now)).toEqual({
      status: "invalid",
      email: "reviewer@example.com",
    });

    setReviewConfig(new Date(now.getTime() + 60_000));
    expect(readReviewOtpConfig(now)).toMatchObject({
      status: "valid",
      email: "reviewer@example.com",
      tenantSlug: "review-studio",
      code: "381624",
    });

    process.env.REVIEW_OTP_CODE = "12345x";
    expect(readReviewOtpConfig(now).status).toBe("invalid");
    setReviewConfig(new Date(now.getTime() - 1));
    expect(readReviewOtpConfig(now).status).toBe("invalid");
    setReviewConfig(new Date(now.getTime() + REVIEW_OTP_MAX_AGE_MS + 1));
    expect(readReviewOtpConfig(now).status).toBe("invalid");
    setReviewConfig(new Date(now.getTime() + 60_000));
    process.env.REVIEW_OTP_EXPIRES_AT = "2026-10-19T12:01:00+00:00";
    expect(readReviewOtpConfig(now).status).toBe("invalid");
    setReviewConfig(new Date(now.getTime() + 60_000));
    process.env.REVIEW_OTP_TENANT_SLUG = "Review-Studio";
    expect(readReviewOtpConfig(now).status).toBe("invalid");
    process.env.REVIEW_OTP_EMAIL = "not-an-email";
    expect(readReviewOtpConfig(now).status).toBe("invalid");
  });
});

databaseDescribe("booking OTP with isolated public PostgreSQL tenant schemas", () => {
  let observer: Sql;
  let withTenantDb: typeof import("@/lib/db/tenant").withTenantDb;
  let provisionTenantSchema: typeof import("@/lib/tenant/provision").provisionTenantSchema;
  let dropTenantSchema: typeof import("@/lib/tenant/provision").dropTenantSchema;
  let closeShardClients: typeof import("@/lib/db/shards").closeShardClients;
  let closePublicDb: typeof import("@/lib/db").closePublicDb;
  const testSlugs: string[] = [];

  beforeAll(async () => {
    observer = postgres(TEST_DATABASE_URL!, { max: 16 });
    await assertOwnedTestDatabase(observer);
    ({ withTenantDb } = await import("@/lib/db/tenant"));
    ({ provisionTenantSchema, dropTenantSchema } = await import("@/lib/tenant/provision"));
    ({ closeShardClients } = await import("@/lib/db/shards"));
    ({ closePublicDb } = await import("@/lib/db"));
    reviewTenantSlug = `review-${process.pid}-${Date.now()}`;
    otherTenantSlug = `other-${process.pid}-${Date.now()}`;
    testSlugs.push(reviewTenantSlug, otherTenantSlug);
    await provisionTenantSchema({ name: "Synthetic review fixture", slug: reviewTenantSlug });
    await provisionTenantSchema({ name: "Synthetic other fixture", slug: otherTenantSlug });
  }, 180_000);

  beforeEach(async () => {
    if (!withTenantDb) return;
    for (const slug of testSlugs) {
      await withTenantDb(slug, async (db, tables) => {
        await db.delete(tables.bookingVerifications);
        await db.delete(tables.clients);
      });
    }
  });

  afterAll(async () => {
    if (dropTenantSchema) {
      for (const slug of testSlugs) {
        try {
          await dropTenantSchema(slug);
        } catch {
          // Cleanup is best-effort for disposable isolated test tenants.
        }
      }
    }
    if (observer) await observer.end({ timeout: 5 });
    if (closeShardClients) await closeShardClients();
    if (closePublicDb) await closePublicDb();
  }, 30_000);

  async function seedReviewClient(email = REVIEW_EMAIL) {
    return withTenantDb(reviewTenantSlug, async (db, { clients }) => {
      const [client] = await db
        .insert(clients)
        .values({ name: "Synthetic Review Client", email })
        .returning({ id: clients.id });
      return client;
    });
  }

  async function challengeRows(
    slug = reviewTenantSlug,
    identifier = REVIEW_EMAIL,
  ) {
    return withTenantDb(slug, async (db, { bookingVerifications }) =>
      db
        .select()
        .from(bookingVerifications)
        .where(eq(bookingVerifications.identifier, identifier)),
    );
  }

  it("requires an existing client in the configured tenant before creating a review challenge", async () => {
    setReviewConfig();
    await expect(
      createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL),
    ).resolves.toBeNull();
    expect(await challengeRows()).toHaveLength(0);

    await seedReviewClient();
    await expect(
      createReviewVerificationForTenant(otherTenantSlug, REVIEW_EMAIL),
    ).resolves.toBeNull();
    await expect(
      createReviewVerificationForTenant(reviewTenantSlug, "someone-else@example.com"),
    ).resolves.toBeNull();
    expect(await challengeRows()).toHaveLength(0);
  });

  it("persists the normalized static code with zero attempts and caps expiry at configuration", async () => {
    await seedReviewClient("Reviewer@Example.com");
    const configExpiry = new Date(Date.now() + 3 * 60 * 1000);
    setReviewConfig(configExpiry);

    await expect(
      createReviewVerificationForTenant(reviewTenantSlug, " Reviewer@Example.COM "),
    ).resolves.toBe("381624");

    const [record] = await challengeRows();
    expect(record).toMatchObject({
      identifier: REVIEW_EMAIL,
      type: "email",
      code: "381624",
      attempts: 0,
    });
    expect(record.expiresAt.getTime()).toBe(configExpiry.getTime());
    expect(record.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + OTP_EXPIRY_SECONDS * 1000,
    );

    await withTenantDb(reviewTenantSlug, async (db, { bookingVerifications }) => {
      await db.delete(bookingVerifications);
    });
    await setReviewConfig(new Date(Date.now() + 20 * 60 * 1000));
    const startedAt = Date.now();
    await createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL);
    const [longConfigRecord] = await challengeRows();
    expect(longConfigRecord.expiresAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + OTP_EXPIRY_SECONDS * 1000,
    );
    expect(longConfigRecord.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + OTP_EXPIRY_SECONDS * 1000,
    );
  });

  it("cannot verify the configured code without the persisted tenant challenge and consumes it once", async () => {
    setReviewConfig();
    await expect(
      verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "381624"),
    ).resolves.toEqual({ valid: false });

    await seedReviewClient();
    await createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL);
    await expect(
      verifyCodeForTenant(otherTenantSlug, REVIEW_EMAIL, "381624"),
    ).resolves.toEqual({ valid: false });
    await expect(
      verifyCodeForTenant(reviewTenantSlug, "different@example.com", "381624"),
    ).resolves.toEqual({ valid: false });
    await expect(
      verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "381624"),
    ).resolves.toEqual({ valid: true, type: "email" });
    await expect(
      verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "381624"),
    ).resolves.toEqual({ valid: false });
    expect(await challengeRows()).toHaveLength(0);
  });

  it("enforces three wrong attempts and rejects the correct code after exhaustion", async () => {
    await seedReviewClient();
    setReviewConfig();
    await createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await expect(
        verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "000000"),
      ).resolves.toEqual({ valid: false });
    }
    expect((await challengeRows())[0].attempts).toBe(MAX_ATTEMPTS);
    await verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "000000");
    expect((await challengeRows())[0].attempts).toBe(MAX_ATTEMPTS);
    await expect(
      verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "381624"),
    ).resolves.toEqual({ valid: false });
  });

  it("rejects an expired persisted challenge", async () => {
    await seedReviewClient();
    setReviewConfig();
    await createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL);
    await withTenantDb(reviewTenantSlug, async (db, { bookingVerifications }) => {
      await db
        .update(bookingVerifications)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(bookingVerifications.identifier, REVIEW_EMAIL));
    });

    await expect(
      verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "381624"),
    ).resolves.toEqual({ valid: false });
  });

  it("rechecks expiry after waiting for the identifier advisory lock", async () => {
    const identifier = "expires-while-waiting@example.com";
    const expiresAt = new Date(Date.now() + 750);
    await withTenantDb(reviewTenantSlug, async (db, { bookingVerifications }) => {
      await db.insert(bookingVerifications).values({
        identifier,
        type: "email",
        code: "123456",
        attempts: 0,
        expiresAt,
      });
    });

    const lockAcquired = deferred();
    const releaseLock = deferred();
    const lockHolder = observer.begin(async (tx) => {
      await tx.unsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [reviewTenantSlug, identifier],
      );
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;

    const verification = verifyCodeForTenant(reviewTenantSlug, identifier, "123456");
    try {
      await waitForAdvisoryLockWaiter(observer);
      const remainingMs = expiresAt.getTime() - Date.now();
      if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingMs + 10));
    } finally {
      releaseLock.resolve();
      await lockHolder;
    }

    await expect(verification).resolves.toEqual({ valid: false });
    expect((await challengeRows(reviewTenantSlug, identifier))[0].attempts).toBe(0);
  }, 15_000);

  it("serializes concurrent wrong attempts, successful consumption, and challenge creation", async () => {
    await seedReviewClient();
    setReviewConfig();
    await createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL);

    const wrongResults = await Promise.all(
      Array.from({ length: 9 }, () =>
        verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "000000"),
      ),
    );
    expect(wrongResults.every((result) => !result.valid)).toBe(true);
    expect((await challengeRows())[0].attempts).toBe(MAX_ATTEMPTS);

    await withTenantDb(reviewTenantSlug, async (db, { bookingVerifications }) => {
      await db.delete(bookingVerifications);
    });
    await createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL);
    const correctResults = await Promise.all(
      Array.from({ length: 9 }, () =>
        verifyCodeForTenant(reviewTenantSlug, REVIEW_EMAIL, "381624"),
      ),
    );
    expect(correctResults.filter((result) => result.valid)).toHaveLength(1);
    expect(await challengeRows()).toHaveLength(0);

    const reviewCodes = await Promise.all(
      Array.from({ length: 8 }, () =>
        createReviewVerificationForTenant(reviewTenantSlug, REVIEW_EMAIL),
      ),
    );
    expect(reviewCodes).toEqual(Array.from({ length: 8 }, () => "381624"));
    const reviewRows = await challengeRows();
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]).toMatchObject({
      identifier: REVIEW_EMAIL,
      type: "email",
      code: "381624",
      attempts: 0,
    });

    const codes = await Promise.all(
      Array.from({ length: 8 }, () =>
        createVerificationForTenant(otherTenantSlug, " Reviewer@Example.COM ", "email"),
      ),
    );
    const rows = await challengeRows(otherTenantSlug);
    expect(rows).toHaveLength(1);
    expect(codes).toContain(rows[0].code);
    expect(rows[0]).toMatchObject({ identifier: REVIEW_EMAIL, type: "email", attempts: 0 });
  }, 30_000);

  it("keeps ordinary email and phone OTP creation normalized and usable", async () => {
    const emailCode = await createVerificationForTenant(
      reviewTenantSlug,
      "  Client@Example.COM ",
      "email",
    );
    expect(emailCode).toMatch(/^\d{6}$/);
    await expect(
      verifyCodeForTenant(reviewTenantSlug, "client@example.com", emailCode),
    ).resolves.toEqual({ valid: true, type: "email" });

    const phoneCode = await createVerificationForTenant(
      reviewTenantSlug,
      "(555) 123-4567",
      "phone",
    );
    const [phoneChallenge] = await challengeRows(reviewTenantSlug, "+15551234567");
    expect(phoneChallenge.code).toBe(phoneCode);
    await expect(
      verifyCodeForTenant(reviewTenantSlug, "1 555 123 4567", phoneCode),
    ).resolves.toEqual({ valid: true, type: "phone" });
  });
});
