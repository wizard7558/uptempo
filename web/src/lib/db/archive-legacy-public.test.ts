import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { LEGACY_PUBLIC_TABLES, archiveLegacyPublicTables } from "../../../scripts/archive-legacy-public.mjs";
import { productionBuildShouldWait } from "../../../scripts/vercel-ignore-build.mjs";

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const SCHEMA = "archive_legacy_unit";

function localAvailable() {
  try {
    execSync("pg_isready -h 127.0.0.1 -p 5432", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const itDb = localAvailable() ? it : it.skip;

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

describe("legacy public archive against postgres", () => {
  const sql = localAvailable() ? postgres(LOCAL, { max: 1 }) : null;

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  itDb("copies rows, checks the counts, clears the source, and rolls back a mismatch", async () => {
    if (!sql) throw new Error("postgres client missing");
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await sql.unsafe(`CREATE SCHEMA "${SCHEMA}"`);
    await sql.unsafe(`
      CREATE TABLE "${SCHEMA}".services (id int PRIMARY KEY, name text);
      CREATE TABLE "${SCHEMA}".clients (id int PRIMARY KEY, name text);
      CREATE TABLE "${SCHEMA}".appointments (
        id int PRIMARY KEY,
        service_id int REFERENCES "${SCHEMA}".services(id),
        client_id int REFERENCES "${SCHEMA}".clients(id)
      );
      CREATE TABLE "${SCHEMA}".appointment_services (
        id int PRIMARY KEY,
        appointment_id int REFERENCES "${SCHEMA}".appointments(id),
        service_id int REFERENCES "${SCHEMA}".services(id)
      );
      INSERT INTO "${SCHEMA}".services VALUES (1, 'Cut');
      INSERT INTO "${SCHEMA}".clients VALUES (1, 'Ada');
      INSERT INTO "${SCHEMA}".appointments VALUES (1, 1, 1);
      INSERT INTO "${SCHEMA}".appointment_services VALUES (1, 1, 1);
    `);

    const first = await archiveLegacyPublicTables(sql, SCHEMA);
    const appointments = first.find((row) => row.table === "appointments");
    const services = first.find((row) => row.table === "services");
    const missing = first.find((row) => row.table === "locations");
    expect(appointments).toMatchObject({ source: 1, archive: 1, action: "cleared" });
    expect(services).toMatchObject({ source: 1, archive: 1, action: "cleared" });
    expect(missing).toMatchObject({ action: "absent" });

    const [source] = await sql.unsafe(`SELECT count(*)::int AS n FROM "${SCHEMA}".appointments`);
    const [archive] = await sql.unsafe(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".archive_legacy_appointments`,
    );
    expect(source.n).toBe(0);
    expect(archive.n).toBe(1);

    const second = await archiveLegacyPublicTables(sql, SCHEMA);
    expect(second.find((row) => row.table === "appointments")).toMatchObject({
      source: 0,
      archive: 1,
      action: "already-clear",
    });
    const [archiveAgain] = await sql.unsafe(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".archive_legacy_appointments`,
    );
    expect(archiveAgain.n).toBe(1);

    await sql.unsafe(`
      INSERT INTO "${SCHEMA}".services VALUES (1, 'Cut');
      INSERT INTO "${SCHEMA}".clients VALUES (1, 'Ada');
      INSERT INTO "${SCHEMA}".appointments VALUES (2, 1, 1);
    `);
    await sql.unsafe(`DELETE FROM "${SCHEMA}".archive_legacy_appointments`);
    await sql.unsafe(`INSERT INTO "${SCHEMA}".archive_legacy_appointments VALUES (9, 1, 1), (8, 1, 1)`);
    await expect(archiveLegacyPublicTables(sql, SCHEMA)).rejects.toThrow(/appointments/);
    const [stillThere] = await sql.unsafe(`SELECT count(*)::int AS n FROM "${SCHEMA}".appointments`);
    const [archiveUntouched] = await sql.unsafe(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".archive_legacy_appointments`,
    );
    expect(stillThere.n).toBe(1);
    expect(archiveUntouched.n).toBe(2);
  });
});
