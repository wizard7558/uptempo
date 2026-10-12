import { NextResponse } from "next/server";
import { listActiveTenants } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { runWaitlistCron } from "@/lib/waitlist/opening";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** First tenant schema version that has slot_waitlist. */
const MIN_SCHEMA_VERSION = 53;

/** Every five minutes: expire holds, text the next match, and close openings that are too soon. */
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

  const tenants = await listActiveTenants();
  const results: Array<{ slug: string; error?: string }> = [];
  for (const tenant of tenants) {
    if (tenant.schemaVersion < MIN_SCHEMA_VERSION) continue;
    try {
      if (!(await hasModule(tenant.slug, "slot_waitlist"))) continue;
      await runWaitlistCron(tenant.slug, new Date());
      results.push({ slug: tenant.slug });
    } catch (error) {
      console.error(`[waitlist] cron failed for ${tenant.slug}:`, error);
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ ok: true, tenants: results });
}
