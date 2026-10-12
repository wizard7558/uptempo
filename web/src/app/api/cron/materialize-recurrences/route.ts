import { NextResponse } from "next/server";
import { listActiveTenants } from "@/lib/tenant/registry";
import { materializeTenant, type MaterializeTenantResult } from "@/lib/scheduling/recurrence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** First tenant schema version that has recurring bookings (migration 0046). */
const MIN_SCHEMA_VERSION = 46;

/**
 * Nightly job for repeating bookings. For every active tenant, books each
 * series' visits up to 84 days ahead and raises an alert for any visit that no
 * longer fits. One tenant failing never blocks the others.
 *
 * Scheduled in `vercel.json`; authorized via the `CRON_SECRET` bearer token.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET not set" },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();

  let skipped = 0;
  let created = 0;
  let conflicts = 0;
  const results: Array<MaterializeTenantResult | { slug: string; error: string }> = [];

  for (const tenant of tenants) {
    if (tenant.schemaVersion < MIN_SCHEMA_VERSION) {
      skipped += 1;
      continue;
    }
    try {
      const result = await materializeTenant(tenant.slug);
      created += result.created;
      conflicts += result.conflicts;
      results.push(result);
    } catch (error) {
      console.error(`[Recurrence] Failed to materialize tenant ${tenant.slug}:`, error);
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenants.length,
    skipped,
    created,
    conflicts,
    results,
  });
}
