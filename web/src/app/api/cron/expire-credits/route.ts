import { NextResponse } from "next/server";
import { listActiveTenants } from "@/lib/tenant/registry";
import { expireCreditsForTenant } from "@/lib/credits/expiry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** First tenant schema version that has the credit ledger. */
const MIN_SCHEMA_VERSION = 51;

/** Daily cron: credit packs past their expiry date lose their remaining credits. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET not set" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const tenants = await listActiveTenants();

  let total = 0;
  const results: Array<{ slug: string; expired?: number; error?: string }> = [];

  for (const tenant of tenants) {
    if (tenant.schemaVersion < MIN_SCHEMA_VERSION) continue;
    try {
      const expired = await expireCreditsForTenant(tenant.slug, now);
      total += expired;
      if (expired > 0) results.push({ slug: tenant.slug, expired });
    } catch (error) {
      console.error(`[Cron] Credit expiry failed for ${tenant.slug}:`, error);
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ expired: total, tenants: results });
}
