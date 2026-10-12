/**
 * Post-Import Validation Script
 *
 * Verifies imported data integrity by comparing DB record counts against CSV
 * source files and checking referential integrity across all FK relationships.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/validate-import.ts --slug <slug> --csv-dir <dir>
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "csv-parse/sync";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[++i];
    }
  }
  const slug = args["slug"];
  const csvDir = args["csv-dir"];
  if (!slug || !csvDir) {
    console.error("Usage: npx tsx scripts/validate-import.ts --slug <slug> --csv-dir <dir>");
    process.exit(1);
  }
  return { slug, csvDir };
}

function countCsvRows(filePath: string): number {
  if (!existsSync(filePath)) return -1; // -1 means file not found
  const raw = readFileSync(filePath, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function validate(slug: string, csvDir: string) {
  const sql = postgres(process.env.DATABASE_URL!);
  const schema = `tenant_${slug}`;
  let hasErrors = false;

  try {
    // 1. Verify tenant exists
    const tenantRows = await sql`SELECT * FROM tenants WHERE slug = ${slug}`;
    if (tenantRows.length === 0) {
      console.error(`[Validate] ERROR: No tenant found with slug '${slug}'.`);
      process.exit(1);
    }
    console.log(`[Validate] Tenant found: ${tenantRows[0].name} (${tenantRows[0].slug})`);
    console.log(`[Validate] Schema: ${schema}\n`);

    // 2. Count records per table vs CSV source
    console.log("=== Record Count Comparison ===\n");

    const tables: Array<{ table: string; csvFile: string }> = [
      { table: "services", csvFile: "services.csv" },
      { table: "clients", csvFile: "clients.csv" },
      { table: "staff", csvFile: "stylists.csv" },
      { table: "working_hours", csvFile: "working_hours.csv" },
      { table: "client_service_overrides", csvFile: "client_service_overrides.csv" },
      { table: "appointments", csvFile: "appointments.csv" },
      { table: "charges", csvFile: "charges.csv" },
    ];

    for (const { table, csvFile } of tables) {
      const result = await sql.unsafe(`SELECT count(*)::int as count FROM "${schema}"."${table}"`);
      const dbCount = result[0].count;
      const csvCount = countCsvRows(join(csvDir, csvFile));

      if (csvCount === -1) {
        console.log(`  Table: ${table.padEnd(28)} | DB: ${String(dbCount).padStart(5)} | CSV: N/A   | SKIPPED (no file)`);
        continue;
      }

      const match = dbCount === csvCount;
      const status = match ? "MATCH" : "MISMATCH";
      if (!match) hasErrors = true;

      console.log(
        `  Table: ${table.padEnd(28)} | DB: ${String(dbCount).padStart(5)} | CSV: ${String(csvCount).padStart(5)} | ${status}`,
      );
    }

    // Also show tables without CSV counterparts
    const extraTables = ["business_settings", "staff_services", "appointment_services"];
    for (const table of extraTables) {
      const result = await sql.unsafe(`SELECT count(*)::int as count FROM "${schema}"."${table}"`);
      console.log(`  Table: ${table.padEnd(28)} | DB: ${String(result[0].count).padStart(5)} | CSV: N/A   | (derived)`);
    }

    // 3. Referential integrity checks
    console.log("\n=== Referential Integrity Checks ===\n");

    const integrityChecks: Array<{ name: string; query: string }> = [
      {
        name: "Appointments with missing client_id",
        query: `SELECT a.id FROM "${schema}"."appointments" a LEFT JOIN "${schema}"."clients" c ON a.client_id = c.id WHERE c.id IS NULL`,
      },
      {
        name: "Appointments with missing service_id",
        query: `SELECT a.id FROM "${schema}"."appointments" a LEFT JOIN "${schema}"."services" s ON a.service_id = s.id WHERE a.service_id IS NOT NULL AND s.id IS NULL`,
      },
      {
        name: "Appointment_services with missing appointment_id",
        query: `SELECT aps.id FROM "${schema}"."appointment_services" aps LEFT JOIN "${schema}"."appointments" a ON aps.appointment_id = a.id WHERE a.id IS NULL`,
      },
      {
        name: "Appointment_services with missing service_id",
        query: `SELECT aps.id FROM "${schema}"."appointment_services" aps LEFT JOIN "${schema}"."services" s ON aps.service_id = s.id WHERE s.id IS NULL`,
      },
      {
        name: "Charges with missing appointment_id",
        query: `SELECT ch.id FROM "${schema}"."charges" ch LEFT JOIN "${schema}"."appointments" a ON ch.appointment_id = a.id WHERE a.id IS NULL`,
      },
      {
        name: "Charges with missing client_id",
        query: `SELECT ch.id FROM "${schema}"."charges" ch LEFT JOIN "${schema}"."clients" c ON ch.client_id = c.id WHERE c.id IS NULL`,
      },
      {
        name: "Working_hours with missing stylist_id",
        query: `SELECT wh.id FROM "${schema}"."working_hours" wh LEFT JOIN "${schema}"."staff" s ON wh.staff_id = s.id WHERE s.id IS NULL`,
      },
      {
        name: "Client_service_overrides with missing client_id",
        query: `SELECT cso.id FROM "${schema}"."client_service_overrides" cso LEFT JOIN "${schema}"."clients" c ON cso.client_id = c.id WHERE c.id IS NULL`,
      },
      {
        name: "Client_service_overrides with missing service_id",
        query: `SELECT cso.id FROM "${schema}"."client_service_overrides" cso LEFT JOIN "${schema}"."services" s ON cso.service_id = s.id WHERE s.id IS NULL`,
      },
      {
        name: "Stylist_services with missing stylist_id",
        query: `SELECT ss.id FROM "${schema}"."staff_services" ss LEFT JOIN "${schema}"."staff" s ON ss.staff_id = s.id WHERE s.id IS NULL`,
      },
      {
        name: "Stylist_services with missing service_id",
        query: `SELECT ss.id FROM "${schema}"."staff_services" ss LEFT JOIN "${schema}"."services" s ON ss.service_id = s.id WHERE s.id IS NULL`,
      },
    ];

    for (const check of integrityChecks) {
      const orphaned = await sql.unsafe(check.query);
      const status = orphaned.length === 0 ? "PASS" : "FAIL";
      if (orphaned.length > 0) hasErrors = true;
      console.log(`  ${check.name.padEnd(50)} ${status}${orphaned.length > 0 ? ` (${orphaned.length} orphaned)` : ""}`);
    }

    // 4. Duplicate detection
    console.log("\n=== Duplicate Detection ===\n");

    const dupEmailResult = await sql.unsafe(
      `SELECT email, count(*)::int as cnt FROM "${schema}"."clients" WHERE email IS NOT NULL GROUP BY email HAVING count(*) > 1`,
    );
    if (dupEmailResult.length > 0) {
      hasErrors = true;
      console.log(`  Duplicate client emails:                         FAIL (${dupEmailResult.length} duplicates)`);
      for (const row of dupEmailResult) {
        console.log(`    - ${row.email}: ${row.cnt} occurrences`);
      }
    } else {
      console.log("  Duplicate client emails:                         PASS");
    }

    const dupServiceResult = await sql.unsafe(
      `SELECT name, count(*)::int as cnt FROM "${schema}"."services" GROUP BY name HAVING count(*) > 1`,
    );
    if (dupServiceResult.length > 0) {
      hasErrors = true;
      console.log(`  Duplicate service names:                         FAIL (${dupServiceResult.length} duplicates)`);
      for (const row of dupServiceResult) {
        console.log(`    - ${row.name}: ${row.cnt} occurrences`);
      }
    } else {
      console.log("  Duplicate service names:                         PASS");
    }

    // 5. Summary
    console.log("\n===================================");
    if (hasErrors) {
      console.log("  RESULT: FAIL -- issues found above");
      process.exit(1);
    } else {
      console.log("  RESULT: PASS -- all checks passed");
    }
  } finally {
    await sql.end();
  }
}

const args = parseArgs(process.argv);
validate(args.slug, args.csvDir).catch((err) => {
  console.error("[Validate] Fatal error:", err);
  process.exit(1);
});
