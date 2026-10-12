import { config } from "dotenv";

// Match Next.js: prefer .env.local over .env for local dev (CLI does not load .env.local by default).
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { applyPendingMigrations } = await import(
    "../src/lib/tenant/migrations/runner"
  );

  console.log("[migrate-tenants] Starting tenant schema migrations...");

  const results = await applyPendingMigrations();

  const applied = results.reduce((sum, r) => sum + r.applied, 0);
  const failed = results.filter((r) => r.error);

  console.log(
    `[migrate-tenants] Complete: ${results.length} tenants, ${applied} migrations applied`,
  );

  if (failed.length > 0) {
    console.error(`[migrate-tenants] ${failed.length} tenant(s) had errors:`);
    for (const f of failed) {
      console.error(`  - ${f.slug}: ${f.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
