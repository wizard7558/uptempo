import postgres from "postgres";
import { execSync } from "node:child_process";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;
  const [{ exists }] = await sql`
    SELECT to_regclass('public.tenants') IS NOT NULL AS exists
  `;
  if (!exists) {
    console.log("[db-prepare] Fresh database: pushing public schema");
    execSync("pnpm exec drizzle-kit push --force", {
      stdio: "inherit",
      env: process.env,
    });
  }
} finally {
  await sql.end({ timeout: 5 });
}
