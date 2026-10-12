/**
 * Production Setup Script
 *
 * Validates production environment variables, tests database connectivity,
 * pushes the Drizzle schema to the production database, and verifies
 * critical tables exist.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/setup-production.ts
 *
 * Exit codes:
 *   0 — Success
 *   1 — Validation or setup failure
 */

import { execSync } from "child_process";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// 1. Environment variable validation
// ---------------------------------------------------------------------------

interface EnvRule {
  name: string;
  required: boolean;
  source: string;
  validate?: (value: string) => string | null; // returns warning/error message or null
}

const ENV_RULES: EnvRule[] = [
  {
    name: "DATABASE_URL",
    required: true,
    source: "Neon Console -> Connection Details -> Pooled connection string",
    validate: (v) => {
      if (!v.includes("-pooler")) {
        return "DATABASE_URL appears to use a direct connection. Use the pooled connection string (hostname should contain -pooler) for Vercel serverless.";
      }
      if (!v.includes("sslmode=require")) {
        return "DATABASE_URL is missing sslmode=require. Append ?sslmode=require (or &sslmode=require) to the connection string.";
      }
      return null;
    },
  },
  {
    name: "BETTER_AUTH_SECRET",
    required: true,
    source: "Generate with: openssl rand -base64 32",
  },
  {
    name: "BETTER_AUTH_URL",
    required: true,
    source: "Set to https://bookuptempo.com for production",
    validate: (v) => {
      if (!v.startsWith("https://")) {
        return "BETTER_AUTH_URL must start with https:// in production.";
      }
      return null;
    },
  },
  {
    name: "ROOT_DOMAIN",
    required: true,
    source: "Set to bookuptempo.com",
  },
  {
    name: "STRIPE_SECRET_KEY",
    required: true,
    source: "Stripe Dashboard -> Developers -> API Keys -> Secret key",
  },
  {
    name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    required: true,
    source: "Stripe Dashboard -> Developers -> API Keys -> Publishable key",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    required: true,
    source: "Stripe Dashboard -> Developers -> Webhooks -> Signing secret",
  },
  {
    name: "RESEND_API_KEY",
    required: true,
    source: "Resend Dashboard -> API Keys",
  },
  {
    name: "CRON_SECRET",
    required: true,
    source: "Generate with: openssl rand -hex 32",
  },
  {
    name: "BOOKING_SESSION_SECRET",
    required: true,
    source: "Generate with: openssl rand -hex 32",
  },
  {
    name: "GOOGLE_CALENDAR_CLIENT_ID",
    required: true,
    source:
      "Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client (Calendar API)",
  },
  {
    name: "GOOGLE_CALENDAR_CLIENT_SECRET",
    required: true,
    source:
      "Google Cloud Console -> APIs & Services -> Credentials -> OAuth client secret",
  },
];

function validateEnvironment(): boolean {
  console.log("=== Environment Variable Validation ===\n");

  let hasErrors = false;
  let hasWarnings = false;

  for (const rule of ENV_RULES) {
    const value = process.env[rule.name];

    if (!value || value.trim() === "") {
      if (rule.required) {
        console.error(`  MISSING: ${rule.name}`);
        console.error(`    Source: ${rule.source}\n`);
        hasErrors = true;
      }
      continue;
    }

    // Run custom validation if present
    if (rule.validate) {
      const warning = rule.validate(value);
      if (warning) {
        console.warn(`  WARNING: ${rule.name}`);
        console.warn(`    ${warning}\n`);
        hasWarnings = true;
      }
    }
  }

  if (hasErrors) {
    console.error("\nEnvironment validation FAILED. Set the missing variables above and re-run.\n");
    return false;
  }

  if (hasWarnings) {
    console.warn("\nEnvironment validation passed with warnings. Review the warnings above.\n");
  } else {
    console.log("  All required environment variables are set.\n");
  }

  return true;
}

// ---------------------------------------------------------------------------
// 2. Database connectivity test
// ---------------------------------------------------------------------------

async function testDatabaseConnectivity(): Promise<boolean> {
  console.log("=== Database Connectivity Test ===\n");

  const databaseUrl = process.env.DATABASE_URL!;
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10 });

  try {
    const result = await sql`SELECT 1 AS ok`;
    if (result[0]?.ok === 1) {
      console.log("  Database connection successful.\n");
      await sql.end();
      return true;
    }
    console.error("  Unexpected result from SELECT 1.\n");
    await sql.end();
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  Database connection FAILED: ${message}`);
    console.error("");
    console.error("  Troubleshooting tips:");
    console.error("    - Ensure sslmode=require is in the connection string");
    console.error("    - Check that the Neon project is active (not suspended)");
    console.error("    - Verify IP is not blocked by Neon allowlist settings");
    console.error("    - Confirm the hostname contains -pooler for pooled connections");
    console.error("");

    try {
      await sql.end();
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. Public schema push (drizzle-kit push)
// ---------------------------------------------------------------------------

function pushSchema(): boolean {
  console.log("=== Public Schema Push (drizzle-kit) ===\n");

  try {
    execSync("npx drizzle-kit push", {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env },
    });
    console.log("\n  Schema push completed.\n");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n  Schema push FAILED: ${message}\n`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. Table verification
// ---------------------------------------------------------------------------

async function verifyTables(): Promise<boolean> {
  console.log("=== Table Verification ===\n");

  const databaseUrl = process.env.DATABASE_URL!;
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10 });

  try {
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    const tableNames = tables.map((row) => row.table_name as string);

    console.log("  Tables in public schema:");
    for (const name of tableNames) {
      console.log(`    - ${name}`);
    }
    console.log("");

    const requiredTables = ["tenants", "user", "session", "salons"];
    const missing = requiredTables.filter((t) => !tableNames.includes(t));

    if (missing.length > 0) {
      console.error(`  MISSING required tables: ${missing.join(", ")}`);
      console.error("  The schema push may have failed or the schema is incomplete.\n");
      await sql.end();
      return false;
    }

    console.log(`  All required tables verified: ${requiredTables.join(", ")}\n`);
    await sql.end();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  Table verification FAILED: ${message}\n`);
    try {
      await sql.end();
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n========================================");
  console.log("  Emme Scheduler — Production Setup");
  console.log("========================================\n");

  // Step 1: Validate environment
  const envOk = validateEnvironment();
  if (!envOk) {
    process.exit(1);
  }

  // Step 2: Test database connectivity
  const dbOk = await testDatabaseConnectivity();
  if (!dbOk) {
    process.exit(1);
  }

  // Step 3: Push schema
  const pushOk = pushSchema();
  if (!pushOk) {
    process.exit(1);
  }

  // Step 4: Verify tables
  const tablesOk = await verifyTables();
  if (!tablesOk) {
    process.exit(1);
  }

  // Step 5: Summary
  console.log("========================================");
  console.log("  Production Setup Complete");
  console.log("========================================\n");
  console.log("  [x] Environment variables validated");
  console.log("  [x] Database connectivity confirmed");
  console.log("  [x] Public schema pushed via drizzle-kit");
  console.log("  [x] Required tables verified (tenants, user, session, salons)");
  console.log("");
  console.log("  Next steps:");
  console.log("    1. Deploy to Vercel: vercel --prod");
  console.log("    2. Verify https://bookuptempo.com loads");
  console.log("    3. Check Vercel cron jobs are active (Pro plan required)");
  console.log("");

  process.exit(0);
}

main();
