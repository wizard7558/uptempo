import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import {
  billTenantForPeriod,
  previousMonthPeriod,
  type BillTenantResult,
} from "@/lib/services/platform-billing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Monthly platform-fee billing. On the 1st of each month it bills the PREVIOUS
 * calendar month for every tenant with `billing_enabled = 1`, charging the
 * floor top-up (max(0, $50 − application fees already collected)) to the salon's
 * saved platform card. Idempotent per (tenant, period). Beta tenants
 * (billing_enabled = 0) are untouched.
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

  if (isSingleMode()) {
    return NextResponse.json({ skipped: "single mode" });
  }

  const period = previousMonthPeriod(new Date());

  const billable = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.billingEnabled, 1));

  const results: Array<BillTenantResult | { slug: string; error: string }> = [];
  let charged = 0;
  let chargedCents = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenant of billable) {
    try {
      const result = await billTenantForPeriod(tenant.slug, period);
      results.push(result);
      if (result.status === "succeeded") {
        charged += 1;
        chargedCents += result.amountChargedCents;
      } else if (
        result.status === "failed" ||
        result.status === "no_payment_method"
      ) {
        failed += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      console.error(
        `[PlatformBilling] Failed to bill tenant ${tenant.slug}:`,
        error,
      );
      failed += 1;
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    period: {
      start: period.start.toISOString().slice(0, 10),
      end: period.end.toISOString().slice(0, 10),
    },
    billableTenants: billable.length,
    charged,
    chargedCents,
    skipped,
    failed,
    results,
  });
}
