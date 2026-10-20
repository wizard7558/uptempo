import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { LEGACY_PUBLIC_TABLES, archiveLegacyPublicTables } from "../../../scripts/archive-legacy-public.mjs";
import { productionBuildShouldWait } from "../../../scripts/vercel-ignore-build.mjs";

type ArchiveLegacyTestConfig =
  | { enabled: false; reason: string }
  | { enabled: true; databaseUrl: string; databaseName: string; runId: string; marker: string };

const ARCHIVE_DATABASE_URL_ENV = "ARCHIVE_LEGACY_TEST_DATABASE_URL";
const ARCHIVE_RUN_ID_ENV = "ARCHIVE_LEGACY_TEST_RUN_ID";

function resolveArchiveLegacyTestConfig(
  env: Record<string, string | undefined>,
): ArchiveLegacyTestConfig {
  const databaseUrl = env[ARCHIVE_DATABASE_URL_ENV];
  const runId = env[ARCHIVE_RUN_ID_ENV];

  if (databaseUrl === undefined && runId === undefined) {
    return {
      enabled: false,
      reason: `set both ${ARCHIVE_DATABASE_URL_ENV} and ${ARCHIVE_RUN_ID_ENV} to enable PostgreSQL cases`,
    };
  }
  if (!databaseUrl || !runId) {
    throw new Error(`Both ${ARCHIVE_DATABASE_URL_ENV} and ${ARCHIVE_RUN_ID_ENV} are required`);
  }
  if (!/^[0-9a-f]{24}$/.test(runId)) {
    throw new Error(`${ARCHIVE_RUN_ID_ENV} must be exactly 24 lowercase hexadecimal characters`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(`${ARCHIVE_DATABASE_URL_ENV} must be a valid PostgreSQL URL`);
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error(`${ARCHIVE_DATABASE_URL_ENV} must use postgres:// or postgresql://`);
  }
  if (!parsedUrl.hostname || !parsedUrl.port) {
    throw new Error(`${ARCHIVE_DATABASE_URL_ENV} must include an explicit loopback host and port`);
  }
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]" && hostname !== "::1") {
    throw new Error(`${ARCHIVE_DATABASE_URL_ENV} host must be an explicit loopback address`);
  }
  if (parsedUrl.search || parsedUrl.hash || databaseUrl.includes("?") || databaseUrl.includes("#")) {
    throw new Error(`${ARCHIVE_DATABASE_URL_ENV} must not contain query parameters or a fragment`);
  }

  const databaseName = `uptempo_archive_test_${runId}`;
  if (parsedUrl.pathname !== `/${databaseName}`) {
    throw new Error(`${ARCHIVE_DATABASE_URL_ENV} database name must be exactly ${databaseName}`);
  }

  return {
    enabled: true,
    databaseUrl,
    databaseName,
    runId,
    marker: `uptempo-archive-disposable:${runId}`,
  };
}

async function assertArchiveTestDatabase(
  sql: ReturnType<typeof postgres>,
  config: Extract<ArchiveLegacyTestConfig, { enabled: true }>,
) {
  const [identity] = await sql`
    SELECT current_database() AS database_name,
           pg_catalog.shobj_description(database_row.oid, 'pg_database') AS marker
    FROM pg_catalog.pg_database AS database_row
    WHERE database_row.datname = current_database()
  `;
  if (identity?.database_name !== config.databaseName || identity?.marker !== config.marker) {
    throw new Error(
      `Refusing PostgreSQL test mutation: expected database ${config.databaseName} with marker ${config.marker}`,
    );
  }
}

async function withOwnedSchema<T>(
  sql: ReturnType<typeof postgres>,
  config: Extract<ArchiveLegacyTestConfig, { enabled: true }>,
  run: (schema: string) => Promise<T>,
): Promise<T> {
  await assertArchiveTestDatabase(sql, config);
  const schema = `archive_legacy_${config.runId}_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    return await run(schema);
  } finally {
    if (created) await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

async function createRelatedTables(sql: ReturnType<typeof postgres>, schema: string) {
  await sql.unsafe(`
    CREATE TABLE "${schema}".services (
      id integer PRIMARY KEY,
      name text NOT NULL,
      options jsonb
    );
    CREATE TABLE "${schema}".clients (
      id integer PRIMARY KEY,
      name text NOT NULL,
      note text
    );
    CREATE TABLE "${schema}".appointments (
      id integer PRIMARY KEY,
      service_id integer REFERENCES "${schema}".services(id),
      client_id integer REFERENCES "${schema}".clients(id)
    );
    CREATE TABLE "${schema}".appointment_services (
      id integer PRIMARY KEY,
      appointment_id integer REFERENCES "${schema}".appointments(id),
      service_id integer REFERENCES "${schema}".services(id)
    );
    INSERT INTO "${schema}".services VALUES (1, 'Cut', '{"duration":30,"tags":["color","trim"]}');
    INSERT INTO "${schema}".clients VALUES (1, 'Ada', NULL);
    INSERT INTO "${schema}".appointments VALUES (1, 1, 1);
    INSERT INTO "${schema}".appointment_services VALUES (1, 1, 1);
  `);
}

async function tableRows(
  sql: ReturnType<typeof postgres>,
  schema: string,
  table: string,
) {
  return sql.unsafe(
    `SELECT to_jsonb(row_value) AS row_value
     FROM "${schema}"."${table}" AS row_value
     ORDER BY to_jsonb(row_value)::text`,
  );
}

describe("legacy public archive guards", () => {
  const runId = "0123456789abcdef01234567";
  const databaseName = `uptempo_archive_test_${runId}`;
  const validUrl = `postgresql://postgres:postgres@127.0.0.1:55432/${databaseName}`;

  it("does not opt in from DATABASE_URL alone and explains how to enable database cases", () => {
    expect(resolveArchiveLegacyTestConfig({
      DATABASE_URL: "postgresql://unrelated.invalid/uptempo",
    })).toMatchObject({
      enabled: false,
      reason: expect.stringContaining(ARCHIVE_DATABASE_URL_ENV),
    });
  });

  it("accepts only a marked-test database URL shape with a matching run id", () => {
    expect(resolveArchiveLegacyTestConfig({
      [ARCHIVE_DATABASE_URL_ENV]: validUrl,
      [ARCHIVE_RUN_ID_ENV]: runId,
    })).toMatchObject({
      enabled: true,
      databaseName,
      runId,
      marker: `uptempo-archive-disposable:${runId}`,
    });
  });

  it("rejects partial opt-in before a PostgreSQL client can be constructed", () => {
    expect(() => resolveArchiveLegacyTestConfig({
      [ARCHIVE_DATABASE_URL_ENV]: validUrl,
    })).toThrow(/Both .* are required/);
    expect(() => resolveArchiveLegacyTestConfig({
      [ARCHIVE_RUN_ID_ENV]: runId,
    })).toThrow(/Both .* are required/);
  });

  it("rejects invalid run ids, non-loopback hosts, missing ports, normal databases, and query or fragment delimiters", () => {
    const base = {
      [ARCHIVE_DATABASE_URL_ENV]: validUrl,
      [ARCHIVE_RUN_ID_ENV]: runId,
    };
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_RUN_ID_ENV]: runId.toUpperCase(),
    })).toThrow(/24 lowercase hexadecimal/);
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_DATABASE_URL_ENV]: validUrl.replace("127.0.0.1", "example.com"),
    })).toThrow(/loopback/);
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_DATABASE_URL_ENV]: `postgresql://postgres:postgres@127.0.0.1/${databaseName}`,
    })).toThrow(/explicit loopback host and port/);
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_DATABASE_URL_ENV]: "postgresql://postgres:postgres@127.0.0.1:55432/uptempo",
    })).toThrow(/database name must be exactly/);
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_DATABASE_URL_ENV]: `${validUrl}?sslmode=require`,
    })).toThrow(/query parameters/);
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_DATABASE_URL_ENV]: `${validUrl}?`,
    })).toThrow(/query parameters/);
    expect(() => resolveArchiveLegacyTestConfig({
      ...base,
      [ARCHIVE_DATABASE_URL_ENV]: `${validUrl}#`,
    })).toThrow(/query parameters/);
  });

  it("refuses a marker mismatch before creating any schema", async () => {
    const config = resolveArchiveLegacyTestConfig({
      [ARCHIVE_DATABASE_URL_ENV]: validUrl,
      [ARCHIVE_RUN_ID_ENV]: runId,
    });
    if (!config.enabled) throw new Error("valid test database configuration was not enabled");
    const unsafe = vi.fn();
    const fakeSql = Object.assign(
      vi.fn(async () => [{ database_name: databaseName, marker: "unrelated-database" }]),
      { unsafe },
    ) as unknown as ReturnType<typeof postgres>;
    const run = vi.fn(async () => "should not run");

    await expect(withOwnedSchema(fakeSql, config, run)).rejects.toThrow(/Refusing PostgreSQL test mutation/);
    expect(fakeSql).toHaveBeenCalledOnce();
    expect(unsafe).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("legacy public archive", () => {
  it("lists every table migration 0025 refuses to drop, children first", () => {
    const sql = readFileSync(
      path.resolve("drizzle/0025_drop_legacy_single_tenant_tables.sql"),
      "utf8",
    );
    const seen: string[] = [];
    for (const match of sql.matchAll(/public\."([a-z_]+)"/g)) {
      const table = match[1];
      if (!seen.includes(table)) seen.push(table);
    }
    expect(LEGACY_PUBLIC_TABLES).toEqual(seen);
  });

  it("skips a production build only when the commit changes migration inputs", () => {
    expect(productionBuildShouldWait(["web/drizzle/0025_drop_legacy_single_tenant_tables.sql"], "production")).toBe(true);
    expect(productionBuildShouldWait(["web/scripts/archive-legacy-public.mjs"], "production")).toBe(true);
    expect(productionBuildShouldWait(["web/src/app/page.tsx"], "production")).toBe(false);
    expect(productionBuildShouldWait(["web/drizzle/0025_drop_legacy_single_tenant_tables.sql"], "preview")).toBe(false);
  });
});

const archiveTestConfig = resolveArchiveLegacyTestConfig(process.env);
const describeDb = archiveTestConfig.enabled ? describe : describe.skip;
const itDb = archiveTestConfig.enabled ? it : it.skip;

if (!archiveTestConfig.enabled) {
  console.info(`[archive-legacy-test] PostgreSQL cases skipped: ${archiveTestConfig.reason}`);
}

describeDb(
  `legacy public archive against PostgreSQL${archiveTestConfig.enabled ? "" : ` (skipped: ${archiveTestConfig.reason})`}`,
  () => {
    // The pure opt-in guard above runs before this constructor. The PostgreSQL client
    // is created only when both explicit test-only variables passed validation.
    const sql = archiveTestConfig.enabled
      ? postgres(archiveTestConfig.databaseUrl, {
          max: 1,
          connect_timeout: 5,
          idle_timeout: 5,
          connection: {
            application_name: "archive-legacy-public-test",
            statement_timeout: 5000,
            lock_timeout: 2000,
          },
        })
      : null;

    afterAll(async () => {
      if (sql) await sql.end({ timeout: 5 });
    });

    itDb("reads the exact disposable marker from the connected PostgreSQL database", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await expect(assertArchiveTestDatabase(sql, archiveTestConfig)).resolves.toBeUndefined();
    }, 10_000);

    itDb("fresh copy, source clear, missing tables, and already-clear retry", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await createRelatedTables(sql, schema);

        const first = await archiveLegacyPublicTables(sql, schema);
        expect(first.find((row) => row.table === "appointments")).toMatchObject({
          source: 1,
          archive: 1,
          action: "cleared",
        });
        expect(first.find((row) => row.table === "services")).toMatchObject({
          source: 1,
          archive: 1,
          action: "cleared",
        });
        expect(first.find((row) => row.table === "locations")).toMatchObject({ action: "absent" });

        const [source] = await sql.unsafe(`SELECT count(*)::int AS n FROM "${schema}".appointments`);
        const archivedAppointments = await tableRows(sql, schema, "archive_legacy_appointments");
        expect(source.n).toBe(0);
        expect(archivedAppointments).toHaveLength(1);
        expect(archivedAppointments[0].row_value).toMatchObject({ id: 1, service_id: 1, client_id: 1 });

        const second = await archiveLegacyPublicTables(sql, schema);
        expect(second.find((row) => row.table === "appointments")).toMatchObject({
          source: 0,
          archive: 1,
          action: "already-clear",
        });
        expect(await tableRows(sql, schema, "archive_legacy_appointments")).toEqual(archivedAppointments);
      });
    }, 15_000);

    itDb("clears a source when an existing nonempty archive has the same rows", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".services (id integer, name text);
          CREATE TABLE "${schema}".archive_legacy_services (id integer, name text);
          INSERT INTO "${schema}".services VALUES (1, 'Cut'), (2, 'Color');
          INSERT INTO "${schema}".archive_legacy_services VALUES (1, 'Cut'), (2, 'Color');
        `);

        const before = await tableRows(sql, schema, "archive_legacy_services");
        const report = await archiveLegacyPublicTables(sql, schema);
        expect(report.find((row) => row.table === "services")).toMatchObject({
          source: 2,
          archive: 2,
          action: "cleared",
        });
        expect(await tableRows(sql, schema, "services")).toEqual([]);
        expect(await tableRows(sql, schema, "archive_legacy_services")).toEqual(before);
      });
    }, 15_000);

    itDb("copies into an existing empty compatible archive before clearing the source", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".services (id integer, name text);
          CREATE TABLE "${schema}".archive_legacy_services (id integer, name text);
          INSERT INTO "${schema}".services VALUES (1, 'Cut'), (2, 'Color');
        `);

        const report = await archiveLegacyPublicTables(sql, schema);
        expect(report.find((row) => row.table === "services")).toMatchObject({
          source: 2,
          archive: 2,
          action: "cleared",
        });
        expect(await tableRows(sql, schema, "services")).toEqual([]);
        expect(await tableRows(sql, schema, "archive_legacy_services")).toEqual([
          { row_value: { id: 1, name: "Cut" } },
          { row_value: { id: 2, name: "Color" } },
        ]);
      });
    }, 15_000);

    itDb("rejects an unequal row count without changing either table", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".services (id integer, name text);
          CREATE TABLE "${schema}".archive_legacy_services (id integer, name text);
          INSERT INTO "${schema}".services VALUES (1, 'Cut'), (2, 'Color');
          INSERT INTO "${schema}".archive_legacy_services VALUES (8, 'Old');
        `);

        const sourceBefore = await tableRows(sql, schema, "services");
        const archiveBefore = await tableRows(sql, schema, "archive_legacy_services");
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/services.*exact row-data match/);
        expect(await tableRows(sql, schema, "services")).toEqual(sourceBefore);
        expect(await tableRows(sql, schema, "archive_legacy_services")).toEqual(archiveBefore);
      });
    }, 15_000);

    itDb("rejects equal counts with different row contents without overwriting either table", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".services (id integer, name text);
          CREATE TABLE "${schema}".archive_legacy_services (id integer, name text);
          INSERT INTO "${schema}".services VALUES (1, 'Cut'), (2, 'Color');
          INSERT INTO "${schema}".archive_legacy_services VALUES (1, 'Cut'), (3, 'Old');
        `);

        const sourceBefore = await tableRows(sql, schema, "services");
        const archiveBefore = await tableRows(sql, schema, "archive_legacy_services");
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/services.*exact row-data match/);
        expect(await tableRows(sql, schema, "services")).toEqual(sourceBefore);
        expect(await tableRows(sql, schema, "archive_legacy_services")).toEqual(archiveBefore);
      });
    }, 15_000);

    itDb("preserves duplicate multiplicity, SQL NULL values, and JSON values", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".clients (name text, profile jsonb, note text);
          INSERT INTO "${schema}".clients VALUES
            ('Ada', '{"nested":[1,{"ok":true}],"nil":null}', NULL),
            ('Ada', '{"nested":[1,{"ok":true}],"nil":null}', NULL),
            (NULL, NULL, 'nullable');
        `);

        const report = await archiveLegacyPublicTables(sql, schema);
        expect(report.find((row) => row.table === "clients")).toMatchObject({
          source: 3,
          archive: 3,
          action: "cleared",
        });
        const archived = await tableRows(sql, schema, "archive_legacy_clients");
        expect(await tableRows(sql, schema, "clients")).toEqual([]);
        expect(archived).toHaveLength(3);
        expect(archived.filter((row) => row.row_value.name === "Ada")).toHaveLength(2);
        expect(archived.find((row) => row.row_value.name === "Ada")?.row_value).toEqual({
          name: "Ada",
          profile: { nested: [1, { ok: true }], nil: null },
          note: null,
        });
        expect(archived.some((row) => row.row_value.name === null
          && row.row_value.profile === null
          && row.row_value.note === "nullable")).toBe(true);
      });
    }, 15_000);

    itDb("rejects SQL NULL versus JSON literal null with equal row counts", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".clients (profile jsonb);
          CREATE TABLE "${schema}".archive_legacy_clients (profile jsonb);
          INSERT INTO "${schema}".clients VALUES (NULL::jsonb);
          INSERT INTO "${schema}".archive_legacy_clients VALUES ('null'::jsonb);
        `);

        const sourceBefore = await sql.unsafe(
          `SELECT profile IS NULL AS is_sql_null, profile::text AS text_value FROM "${schema}".clients`,
        );
        const archiveBefore = await sql.unsafe(
          `SELECT profile IS NULL AS is_sql_null, profile::text AS text_value FROM "${schema}".archive_legacy_clients`,
        );
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/clients.*exact row-data match/);
        expect(await sql.unsafe(
          `SELECT profile IS NULL AS is_sql_null, profile::text AS text_value FROM "${schema}".clients`,
        )).toEqual(sourceBefore);
        expect(await sql.unsafe(
          `SELECT profile IS NULL AS is_sql_null, profile::text AS text_value FROM "${schema}".archive_legacy_clients`,
        )).toEqual(archiveBefore);
      });
    }, 15_000);

    itDb("rejects different raw JSON text even when parsed values and row counts match", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".clients (profile json);
          CREATE TABLE "${schema}".archive_legacy_clients (profile json);
          INSERT INTO "${schema}".clients VALUES ('{"name": 1}'::json);
          INSERT INTO "${schema}".archive_legacy_clients VALUES ('{"name":1}'::json);
        `);

        const sourceBefore = await sql.unsafe(
          `SELECT profile::text AS raw_value FROM "${schema}".clients`,
        );
        const archiveBefore = await sql.unsafe(
          `SELECT profile::text AS raw_value FROM "${schema}".archive_legacy_clients`,
        );
        expect(sourceBefore).toEqual([{ raw_value: '{"name": 1}' }]);
        expect(archiveBefore).toEqual([{ raw_value: '{"name":1}' }]);
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/clients.*exact row-data match/);
        expect(await sql.unsafe(
          `SELECT profile::text AS raw_value FROM "${schema}".clients`,
        )).toEqual(sourceBefore);
        expect(await sql.unsafe(
          `SELECT profile::text AS raw_value FROM "${schema}".archive_legacy_clients`,
        )).toEqual(archiveBefore);
      });
    }, 15_000);

    itDb("rejects equal counts when duplicate row multiplicities differ", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".services (name text);
          CREATE TABLE "${schema}".archive_legacy_services (name text);
          INSERT INTO "${schema}".services VALUES ('A'), ('A'), ('B');
          INSERT INTO "${schema}".archive_legacy_services VALUES ('A'), ('B'), ('B');
        `);

        const sourceBefore = await tableRows(sql, schema, "services");
        const archiveBefore = await tableRows(sql, schema, "archive_legacy_services");
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/services.*exact row-data match/);
        expect(await tableRows(sql, schema, "services")).toEqual(sourceBefore);
        expect(await tableRows(sql, schema, "archive_legacy_services")).toEqual(archiveBefore);
      });
    }, 15_000);

    itDb("rejects an existing archive with incompatible column names, types, or order", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".services (id integer, name text);
          CREATE TABLE "${schema}".archive_legacy_services (name text, id bigint);
          INSERT INTO "${schema}".services VALUES (1, 'Cut');
          INSERT INTO "${schema}".archive_legacy_services VALUES ('Old', 9);
        `);

        const sourceBefore = await tableRows(sql, schema, "services");
        const archiveBefore = await tableRows(sql, schema, "archive_legacy_services");
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/column names, types, or ordering/);
        expect(await tableRows(sql, schema, "services")).toEqual(sourceBefore);
        expect(await tableRows(sql, schema, "archive_legacy_services")).toEqual(archiveBefore);
      });
    }, 15_000);

    itDb("rolls back an earlier archive copy when a later table mismatches", async () => {
      if (!sql || !archiveTestConfig.enabled) throw new Error("PostgreSQL test client missing");
      await withOwnedSchema(sql, archiveTestConfig, async (schema) => {
        await sql.unsafe(`
          CREATE TABLE "${schema}".external_events (id integer, payload text);
          CREATE TABLE "${schema}".appointments (id integer, payload text);
          CREATE TABLE "${schema}".archive_legacy_appointments (id integer, payload text);
          INSERT INTO "${schema}".external_events VALUES (1, 'event');
          INSERT INTO "${schema}".appointments VALUES (1, 'source');
          INSERT INTO "${schema}".archive_legacy_appointments VALUES (1, 'archive');
        `);

        const eventBefore = await tableRows(sql, schema, "external_events");
        const appointmentBefore = await tableRows(sql, schema, "appointments");
        const archiveBefore = await tableRows(sql, schema, "archive_legacy_appointments");
        await expect(archiveLegacyPublicTables(sql, schema)).rejects.toThrow(/appointments.*exact row-data match/);

        expect(await tableRows(sql, schema, "external_events")).toEqual(eventBefore);
        expect(await tableRows(sql, schema, "appointments")).toEqual(appointmentBefore);
        expect(await tableRows(sql, schema, "archive_legacy_appointments")).toEqual(archiveBefore);
        const [createdArchive] = await sql.unsafe(
          `SELECT to_regclass($1) IS NOT NULL AS present`,
          [`${schema}.archive_legacy_external_events`],
        );
        expect(createdArchive.present).toBe(false);
      });
    }, 15_000);
  },
);
