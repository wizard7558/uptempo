import { NextResponse } from "next/server";
import { listActiveTenants } from "@/lib/tenant/registry";
import {
  evaluateCapacityForTenant,
  type CapacityEvaluationResult,
} from "@/lib/services/capacity-coach";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Weekly Capacity Coach evaluation. For every active tenant, compares each goal-setting
 * stylist's actual booked hours and effective hourly rate against their goals
 * and reconciles their dashboard alerts. One tenant failing never blocks the others.
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

  let evaluated = 0;
  let skipped = 0;
  let alertsUpserted = 0;
  let alertsCleared = 0;
  const results: Array<CapacityEvaluationResult | { slug: string; error: string }> =
    [];

  for (const tenant of tenants) {
    try {
      const result = await evaluateCapacityForTenant(tenant.slug);
      if (result.skipped) skipped += 1;
      else evaluated += 1;
      alertsUpserted += result.alertsUpserted;
      alertsCleared += result.alertsCleared;
      results.push(result);
    } catch (error) {
      console.error(
        `[CapacityCoach] Failed to evaluate tenant ${tenant.slug}:`,
        error,
      );
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenants.length,
    evaluated,
    skipped,
    alertsUpserted,
    alertsCleared,
    results,
  });
}
