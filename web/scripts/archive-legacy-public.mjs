/**
 * Copies leftover single-tenant rows out of the public tables that migration
 * 0025 refuses to drop, checks archive shape and exact row data, then clears
 * the originals in a second pass after every pair has been validated.
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
    /** @type {string[]} */
    const existingArchives = [];
    for (const table of LEGACY_PUBLIC_TABLES) {
      const [row] = await tx`
        SELECT to_regclass(${`${schema}.${table}`}) IS NOT NULL AS present
      `;
      if (!row.present) continue;
      present.push(table);
      const [archiveRow] = await tx`
        SELECT to_regclass(${`${schema}.${archiveName(table)}`}) IS NOT NULL AS present
      `;
      if (archiveRow.present) existingArchives.push(archiveName(table));
    }
    const lockedTables = [
      ...present.map((table) => `${ident(schema)}.${ident(table)}`),
      ...existingArchives.map((table) => `${ident(schema)}.${ident(table)}`),
    ];
    if (lockedTables.length > 0) {
      await tx.unsafe(
        `LOCK TABLE ${lockedTables.join(", ")} IN ACCESS EXCLUSIVE MODE`,
      );
    }

    /** @type {Array<{ table: string, source: number, archive: number, action: string }>} */
    const plan = [];
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
      const archiveExists = existingArchives.includes(archived);
      const sourceColumns = archiveExists
        ? await assertCompatibleArchiveShape(tx, schema, table, archived)
        : await readColumnShape(tx, schema, table);

      if (!archiveExists) {
        if (source === 0) {
          await tx.unsafe(
            `CREATE TABLE ${ident(schema)}.${ident(archived)} AS TABLE ${ident(schema)}.${ident(table)} WITH NO DATA`,
          );
        } else {
          await tx.unsafe(
            `CREATE TABLE ${ident(schema)}.${ident(archived)} AS TABLE ${ident(schema)}.${ident(table)}`,
          );
        }
      }

      let [archiveCount] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
      );
      let archive = Number(archiveCount.n);
      if (source === 0) {
        plan.push({ table, source, archive, action: "already-clear" });
        continue;
      }

      if (archiveExists && archive === 0) {
        await tx.unsafe(
          `INSERT INTO ${ident(schema)}.${ident(archived)} SELECT * FROM ${ident(schema)}.${ident(table)}`,
        );
        [archiveCount] = await tx.unsafe(
          `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
        );
        archive = Number(archiveCount.n);
      }

      const sourceRowValue = rowValueExpression("source_row", sourceColumns);
      const archiveRowValue = rowValueExpression("archive_row", sourceColumns);
      const [comparison] = await tx.unsafe(`
        SELECT NOT EXISTS (
          SELECT 1
          FROM (
            (SELECT ${sourceRowValue} AS row_value
             FROM ${ident(schema)}.${ident(table)} AS source_row
             EXCEPT ALL
             SELECT ${archiveRowValue} AS row_value
             FROM ${ident(schema)}.${ident(archived)} AS archive_row)
            UNION ALL
            (SELECT ${archiveRowValue} AS row_value
             FROM ${ident(schema)}.${ident(archived)} AS archive_row
             EXCEPT ALL
             SELECT ${sourceRowValue} AS row_value
             FROM ${ident(schema)}.${ident(table)} AS source_row)
          ) AS differences
        ) AS equal
      `);
      if (!comparison.equal) {
        throw new Error(
          `Refusing to clear ${schema}.${table}: ${schema}.${archived} is not an exact row-data match (archive ${archive} rows, source ${source})`,
        );
      }

      if (archive !== source) {
        throw new Error(
          `Archive count for ${schema}.${table} is ${archive}, expected ${source}, so the source was not cleared`,
        );
      }

      plan.push({ table, source, archive, action: "copied" });
    }

    // Every source/archive pair has now been copied or validated before any
    // source table is cleared. Keep the migration's child-first order here.
    for (const item of plan) {
      if (item.source === 0) continue;
      const table = item.table;
      const archived = archiveName(table);
      const [before] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
      );
      if (Number(before.n) !== item.source) {
        throw new Error(
          `Archive count for ${schema}.${table} is ${before.n}, expected ${item.source}, so the source was not cleared`,
        );
      }
      await tx.unsafe(`DELETE FROM ${ident(schema)}.${ident(table)}`);
      const [sourceAfter] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(table)}`,
      );
      const [archiveAfter] = await tx.unsafe(
        `SELECT count(*)::int AS n FROM ${ident(schema)}.${ident(archived)}`,
      );
      if (Number(sourceAfter.n) !== 0 || Number(archiveAfter.n) !== item.source) {
        throw new Error(
          `Clear of ${schema}.${table} failed: source ${sourceAfter.n}, archive ${archiveAfter.n}, expected archive ${item.source}`,
        );
      }
      item.archive = Number(archiveAfter.n);
      item.action = "cleared";
    }

    return [...plan, ...absent];
  });
}

function rowValueExpression(alias, columns) {
  const columnValues = columns.map((column) => `${alias}.${ident(column.name)}::text`);
  return `to_jsonb(ARRAY[${columnValues.join(", ")}]::text[])`;
}

async function readColumnShape(tx, schema, table) {
  return tx.unsafe(
    `SELECT a.attname AS name, a.atttypid::int AS type_oid, a.atttypmod AS type_modifier
     FROM pg_catalog.pg_attribute AS a
     JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schema, table],
  );
}

async function assertCompatibleArchiveShape(tx, schema, source, archived) {
  const sourceColumns = await readColumnShape(tx, schema, source);
  const archiveColumns = await readColumnShape(tx, schema, archived);
  const compatible = sourceColumns.length === archiveColumns.length
    && sourceColumns.every((column, index) =>
      column.name === archiveColumns[index].name
      && Number(column.type_oid) === Number(archiveColumns[index].type_oid)
      && Number(column.type_modifier) === Number(archiveColumns[index].type_modifier)
    );
  if (!compatible) {
    throw new Error(
      `Refusing to use ${schema}.${archived}: its column names, types, or ordering do not match ${schema}.${source}`,
    );
  }
  return sourceColumns;
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
