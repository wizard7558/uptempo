import { NextResponse } from "next/server";
import { isSingleMode } from "@/lib/config/mode";
import { listActiveTenants } from "@/lib/tenant/registry";
import { advanceRegistration } from "@/lib/sms/registration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Advances one durable registration checkpoint for each eligible hosted tenant. */
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
  if (isSingleMode()) {
    return NextResponse.json({ skipped: "single_mode" });
  }

  let tenants;
  try {
    tenants = await listActiveTenants();
  } catch {
    console.error("[Cron] SMS registration scan failed");
    return NextResponse.json({ error: "registration_scan_failed" }, { status: 500 });
  }

  let advanced = 0;
  let failed = 0;
  const results: Array<{ slug: string; status?: string; error?: string }> = [];
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    const registration = tenant.smsRegistration ?? {};
    const pending = tenant.smsLineStatus === "pending";
    const awaitingTextConfirmation =
      tenant.smsLineStatus === "action_needed" && registration.reason === "confirm_text";
    if (!pending && !awaitingTextConfirmation) continue;

    try {
      const result = await advanceRegistration(tenant.slug);
      if (result.ok) {
        advanced++;
        results.push({ slug: tenant.slug, status: result.status });
      } else {
        failed++;
        results.push({ slug: tenant.slug, error: result.error });
        console.error("[Cron] SMS registration advance failed", tenant.slug, result.error);
      }
    } catch {
      failed++;
      results.push({ slug: tenant.slug, error: "registration_temporarily_unavailable" });
      console.error("[Cron] SMS registration advance failed", tenant.slug);
    }
  }

  return NextResponse.json({ advanced, failed, tenants: results });
}
