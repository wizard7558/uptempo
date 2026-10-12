/**
 * Migration: Add import-related columns to clients table for all tenants.
 * Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Usage: npx tsx scripts/add-client-import-columns.ts
 */

import { config } from "dotenv";
import postgres from "postgres";

// Load .env.production first, then .env.local as fallback
config({ path: ".env.production" });
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

const NEW_COLUMNS = [
  `"birthday" date`,
  `"gender" text`,
  `"address" text`,
  `"city" text`,
  `"state" text`,
  `"zip" text`,
  `"customer_since" date`,
  `"appointments_booked" integer DEFAULT 0 NOT NULL`,
  `"source" text`,
];

async function main() {
  // Find all tenant schemas
  const schemas = await sql`
    SELECT slug FROM tenants
  `;

  if (schemas.length === 0) {
    console.log("No tenants found.");
    await sql.end();
    return;
  }

  console.log(`Found ${schemas.length} tenant(s): ${schemas.map((s) => s.slug).join(", ")}`);

  for (const { slug } of schemas) {
    const schemaName = `tenant_${slug}`;
    console.log(`\nMigrating ${schemaName}.clients ...`);

    for (const colDef of NEW_COLUMNS) {
      const alterSql = `ALTER TABLE "${schemaName}"."clients" ADD COLUMN IF NOT EXISTS ${colDef}`;
      try {
        await sql.unsafe(alterSql);
        console.log(`  + ${colDef.split('"')[1]}`);
      } catch (err) {
        console.error(`  ! Failed: ${colDef}`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log("\nDone.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
