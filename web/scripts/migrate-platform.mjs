/**
 * Applies public-schema SQL migrations via drizzle-kit (drizzle.__drizzle_migrations).
 * Loads env like Next.js: prefer .env.local over .env.
 *
 * If the DB was synced with `drizzle-kit push` only, the migration table can be empty
 * while tables already exist — then `migrate` would try to re-run 0000 and fail.
 * In that case we baseline journal rows (same hashes as drizzle-orm/migrator.js) and
 * re-run migrate (no-op).
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import nextEnv from "@next/env";
import { archiveLegacyPublicTables } from "./archive-legacy-public.mjs";

const { loadEnvConfig } = nextEnv;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");

// If DATABASE_URL is already set (e.g. migrate:production), do not let file-based
// env replace it — Next's loader can otherwise clobber a production URL with .env.local.
const pinnedDatabaseUrl = process.env.DATABASE_URL;
loadEnvConfig(projectDir);
if (pinnedDatabaseUrl) {
  process.env.DATABASE_URL = pinnedDatabaseUrl;
}

if (!process.env.DATABASE_URL) {
  console.error(
    "[migrate:platform] Missing DATABASE_URL. Set it in `.env.local` or `.env`.",
  );
  process.exit(1);
}

/** @param {import('postgres').Sql} sql */
async function baselineJournalIfPushOnlyDb(sql) {
  const [{ count }] =
    await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  if (count > 0) return;

  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'tenants'
    ) AS exists
  `;
  if (!exists) return;

  console.log(
    "[migrate:platform] Journal is empty but public tables exist (typical after `drizzle-kit push`). Baselining migration history…",
  );

  const journalPath = path.join(projectDir, "drizzle/meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

  for (const e of journal.entries) {
    const migrationPath = path.join(projectDir, `drizzle/${e.tag}.sql`);
    const query = fs.readFileSync(migrationPath, "utf8");
    const hash = crypto.createHash("sha256").update(query).digest("hex");
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${e.when})
    `;
  }

  console.log(
    `[migrate:platform] Baseline complete (${journal.entries.length} rows).`,
  );
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await sql`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;
    await baselineJournalIfPushOnlyDb(sql);
    const archived = await archiveLegacyPublicTables(sql);
    console.log(`[archive-legacy] ${JSON.stringify(archived)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log("[migrate:platform] Running drizzle-kit migrate…");

  try {
    execSync("npx drizzle-kit migrate", {
      cwd: projectDir,
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
