import nextEnv from "@next/env";
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { loadEnvConfig } = nextEnv;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, "..");

loadEnvConfig(projectDir);

const registry = JSON.parse(
  fs.readFileSync(path.join(projectDir, "env.registry.json"), "utf8"),
);

const ENUMS = {
  UPTEMPO_MODE: ["multi", "single"],
  STORAGE_PROVIDER: ["vercel-blob", "local", "s3"],
  EMAIL_PROVIDER: ["resend", "smtp", "console"],
  SMS_PROVIDER: ["twilio", "loopmessage", "none"],
  DOMAINS_PROVIDER: ["vercel", "none"],
  DOMAIN_MAP_PROVIDER: ["global-config", "static", "none"],
};

const SECRET_NAMES = new Set([
  "BETTER_AUTH_SECRET",
  "BOOKING_SESSION_SECRET",
  "CRON_SECRET",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isBlank(value) {
  const text = clean(value);
  return text.length === 0 || text === "CHANGE_ME" || text.startsWith("your-");
}

function modeFromEnv() {
  const raw = clean(process.env.UPTEMPO_MODE).toLowerCase();
  if (!raw || raw === "multi") return "multi";
  if (raw === "single") return "single";
  return null;
}

function emailProvider() {
  const chosen = clean(process.env.EMAIL_PROVIDER).toLowerCase();
  if (chosen) return chosen;
  const key = clean(process.env.RESEND_API_KEY);
  if (key && !["re_placeholder", "test", "your-resend-api-key"].includes(key)) {
    return "resend";
  }
  if (clean(process.env.SMTP_HOST)) return "smtp";
  return "console";
}

function requirement(entry, mode) {
  const flag = mode === "single" ? entry.single : entry.multi;
  const development = process.env.NODE_ENV === "development";
  if (development && mode === "multi" && entry.hosted && flag === "R") return "O";
  return flag;
}

function collectEnvErrors() {
  const lines = [];
  const mode = modeFromEnv();
  const activeMode = mode ?? "multi";

  for (const entry of registry) {
    const value = process.env[entry.name];
    if (ENUMS[entry.name] && !isBlank(value)) {
      const allowed = [...ENUMS[entry.name]];
      if (entry.name === "SMS_PROVIDER" && process.env.NODE_ENV !== "production") {
        allowed.push("log");
      }
      const normalized = clean(value).toLowerCase();
      if (!allowed.includes(normalized)) {
        lines.push({
          group: entry.group,
          line: `- ${entry.name} (${entry.group}): must be one of ${allowed.join("|")}`,
        });
      }
    }

    if (entry.name === "DATABASE_SHARD_URLS" && !isBlank(value)) {
      try {
        JSON.parse(clean(value));
      } catch {
        lines.push({
          group: entry.group,
          line: `- DATABASE_SHARD_URLS (${entry.group}): must be JSON`,
        });
      }
    }

    if (
      process.env.NODE_ENV === "production" &&
      SECRET_NAMES.has(entry.name) &&
      !isBlank(value) &&
      clean(value).length < 32
    ) {
      lines.push({
        group: entry.group,
        line: `- ${entry.name} (${entry.group}): must be at least 32 characters`,
      });
    }

    let because = null;
    if (entry.requiredWhen) {
      const [key, expected] = Object.entries(entry.requiredWhen)[0];
      if (clean(process.env[key]).toLowerCase() === String(expected).toLowerCase()) {
        because = `${key}=${expected}`;
      }
    }
    if (
      entry.name === "EMAIL_FROM" &&
      activeMode === "single" &&
      emailProvider() !== "console"
    ) {
      because = `EMAIL_PROVIDER=${emailProvider()}`;
    }
    if (
      entry.name === "STRIPE_WEBHOOK_SECRET" &&
      activeMode === "single" &&
      !isBlank(process.env.STRIPE_SECRET_KEY)
    ) {
      because = "STRIPE_SECRET_KEY is set";
    }

    const required = requirement(entry, activeMode) === "R" || because !== null;
    if (required && isBlank(value)) {
      const why = because ? `required because ${because}` : "required";
      lines.push({
        group: entry.group,
        line: `- ${entry.name} (${entry.group}): ${why}`,
      });
    }
  }

  return lines;
}

const REQUIRED_PUBLIC_TABLES = [
  "tenants",
  "user",
  "session",
  "team_invitations",
  "domain_mappings",
  "otp_rate_limits",
  "job_runs",
];

const REQUIRED_TENANT_COLUMNS = [
  "plan",
  "platform_fee_percent",
  "assistant_seats",
];

function printFailure(lines) {
  console.error("\nLocal bootstrap check failed.\n");
  for (const line of lines) {
    console.error(line);
  }
  console.error("");
}

async function main() {
  if (process.env.SKIP_BOOTSTRAP_CHECK === "1") {
    console.log("Skipping local bootstrap check.");
    return;
  }

  const envErrors = collectEnvErrors();
  if (envErrors.length > 0) {
    const grouped = [];
    let last = "";
    for (const error of envErrors) {
      if (error.group !== last) {
        grouped.push(error.group);
        last = error.group;
      }
      grouped.push(error.line);
    }
    printFailure(grouped);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--env-only")) {
    console.log("Env check passed (--env-only).");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    printFailure([
      "Missing `DATABASE_URL`.",
      "Set it in `.env.local`, then re-run `npm run dev`.",
    ]);
    process.exitCode = 1;
    return;
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
  });

  try {
    const publicTables = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `;

    const tenantColumns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tenants'
    `;

    const tableNames = new Set(
      publicTables.map((row) => String(row.table_name)),
    );
    const tenantColumnNames = new Set(
      tenantColumns.map((row) => String(row.column_name)),
    );

    const missingTables = REQUIRED_PUBLIC_TABLES.filter(
      (tableName) => !tableNames.has(tableName),
    );
    const missingTenantColumns = REQUIRED_TENANT_COLUMNS.filter(
      (columnName) => !tenantColumnNames.has(columnName),
    );

    if (missingTables.length > 0 || missingTenantColumns.length > 0) {
      const lines = [
        "Your local public schema is behind the current app code.",
      ];

      if (missingTables.length > 0) {
        lines.push(`Missing tables: ${missingTables.join(", ")}`);
      }

      if (missingTenantColumns.length > 0) {
        lines.push(
          `Missing tenants columns: ${missingTenantColumns.join(", ")}`,
        );
      }

      lines.push(
        "Run `npm run migrate:platform` to prepare and migrate the public schema, then re-run `npm run dev`.",
      );
      lines.push(
        "If you intentionally want to bypass this guard, use `SKIP_BOOTSTRAP_CHECK=1 npm run dev`.",
      );

      printFailure(lines);
      process.exitCode = 1;
      return;
    }

    console.log("Local bootstrap check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    printFailure([
      `Could not verify the local database schema: ${message}`,
      "Check that your database is reachable and `DATABASE_URL` points at the expected local/dev database.",
      "If you intentionally want to bypass this guard, use `SKIP_BOOTSTRAP_CHECK=1 npm run dev`.",
    ]);
    process.exitCode = 1;
  } finally {
    try {
      await sql.end();
    } catch {
      // Ignore cleanup errors from failed connections.
    }
  }
}

await main();
