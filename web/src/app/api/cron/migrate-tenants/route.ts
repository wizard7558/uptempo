import { NextResponse } from "next/server";
import { applyPendingMigrations } from "@/lib/tenant/migrations/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify CRON_SECRET (mandatory)
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

  const results = await applyPendingMigrations();

  const failed = results.filter((r) => r.error);
  const applied = results.reduce((sum, r) => sum + r.applied, 0);

  return NextResponse.json({
    tenants: results.length,
    applied,
    failed: failed.length,
    results,
  });
}
