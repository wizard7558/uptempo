/**
 * Copies leftover single-tenant rows out of the public tables that migration
 * 0025 refuses to drop, checks the archive counts, then clears the originals.
 *
 * Archive tables are public.archive_legacy_<table>. They are not part of the
 * Drizzle schema. 0025 drops only the empty originals. Run this before
 * drizzle-kit migrate. The copy and the clear commit together, or not at all.
 */
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

/** Children first, same order as drizzle/0025_drop_legacy_single_tenant_tables.sql. */
export const LEGACY_PUBLIC_TABLES = [
  "external_events",
  "calendar_connections",
  "charges",
  "appointment_services",
  "client_service_overrides",
  "stylist_services",
  "working_hours",
  "appointments",
  "booking_verifications",
  "salon_policies",
  "salons",
  "clients",
  "stylists",
  "services",
  "locations",
];

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing unsafe SQL identifier "${name}"`);
  }
  return `"${name}"`;
}

function archiveName(table) {
  return `archive_legacy_${table}`;
}

/**
 * @param {import("postgres").Sql} sql
 * @param {string} [schema]
 * @returns {Promise<Array<{ table: string, source: number | null, archive: number | null, action: string }>>}
 */
export async function archiveLegacyPublicTables(sql, schema = "public") {
  ident(schema);
  return sql.begin(async (tx) => {
    /** @type {string[]} */
    const present = [];
    for (const table of LEGACY_PUBLIC_TABLES) {
      const [row] = await tx`
        SELECT to_regclass(${`${schema}.${table}`}) IS NOT NULL AS present
      `;
      if (row.present) present.push(table);
    }
    if (present.length > 0) {
      await tx.unsafe(
        `LOCK TABLE ${present.map((table) => `${ident(schema)}.${ident(table)}`).join(", ")} IN ACCESS EXCLUSIVE MODE`,
      );
    }

    /** @type {Array<{ table: string, source: number, archive: number, action: string }>} */
    const planned = [];
    /** @type {Array<{ table: string, source: null, archive: null, action: "absent" }>} */
    const absent = [];

    for (const table of LEGACY_PUBLIC_TABLES) {
      if (!present.includes(table)) {
        absent.push({ table, source: null, archive: null, action: "absent" });
        continue;
      }
      const archived = archiveName(table);
      const [sourceRow] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(table)}`,
      );
      const source = Number(sourceRow.n);
      const [archRow] = await tx`
        SELECT to_regclass(${`${schema}.${archived}`}) IS NOT NULL AS present
      `;
      let archive = 0;
      let action;
      if (!archRow.present) {
        if (source === 0) {
          await tx.unsafe(
            `CREATE TABLE ${ident(schema)}.${ident(archived)} AS TABLE ${ident(schema)}.${ident(table)} WITH NO DATA`,
          );
        } else {
          await tx.unsafe(
            `CREATE TABLE ${ident(schema)}.${ident(archived)} AS TABLE ${ident(schema)}.${ident(table)}`,
          );
        }
        archive = source;
        action = "copied";
      } else {
        const [countRow] = await tx.unsafe(
          `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
        );
        archive = Number(countRow.n);
        if (source === 0) {
          action = "already-clear";
        } else if (archive === 0) {
          await tx.unsafe(
            `INSERT INTO ${ident(schema)}.${ident(archived)} SELECT * FROM ${ident(schema)}.${ident(table)}`,
          );
          archive = source;
          action = "copied";
        } else if (archive === source) {
          action = "copied";
        } else {
          throw new Error(
            `Refusing to clear ${schema}.${table}: ${schema}.${archived} has ${archive} rows and the source has ${source}`,
          );
        }
      }
      planned.push({ table, source, archive, action });
    }

    for (const item of planned) {
      if (item.source === 0) continue;
      const archived = archiveName(item.table);
      const [before] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
      );
      if (Number(before.n) !== item.source) {
        throw new Error(
          `Archive count for ${schema}.${item.table} is ${before.n}, expected ${item.source}, so the source was not cleared`,
        );
      }
      await tx.unsafe(`DELETE FROM ${ident(schema)}.${ident(item.table)}`);
      const [sourceAfter] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(item.table)}`,
      );
      const [archiveAfter] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
      );
      if (Number(sourceAfter.n) !== 0 || Number(archiveAfter.n) !== item.source) {
        throw new Error(
          `Clear of ${schema}.${item.table} failed: source ${sourceAfter.n}, archive ${archiveAfter.n}, expected archive ${item.source}`,
        );
      }
      item.archive = Number(archiveAfter.n);
      item.action = "cleared";
    }

    return [...planned, ...absent];
  });
}

async function main() {
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pinnedDatabaseUrl = process.env.DATABASE_URL;
  loadEnvConfig(projectDir);
  if (pinnedDatabaseUrl) process.env.DATABASE_URL = pinnedDatabaseUrl;
  if (!process.env.DATABASE_URL) {
    console.error("[archive-legacy] Missing DATABASE_URL.");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const report = await archiveLegacyPublicTables(sql);
    console.log(`[archive-legacy] ${JSON.stringify(report)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
