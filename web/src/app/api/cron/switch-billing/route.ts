import { NextResponse } from "next/server";
import { runDueBillingSwitches } from "@/lib/billing/switch";
import { isSingleMode } from "@/lib/config/mode";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily hosted-only switch. Timing always comes from the server clock. */
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
    return NextResponse.json({ skipped: "single_mode", results: [], failures: 0 });
  }

  const result = await runDueBillingSwitches();
  return NextResponse.json(result, { status: result.failures > 0 ? 500 : 200 });
}
