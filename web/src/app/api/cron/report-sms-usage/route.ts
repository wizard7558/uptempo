import { NextResponse } from "next/server";
import { reconcileHostedBilling } from "@/lib/billing/reconcile";
import { reportSmsUsage } from "@/lib/billing/sms-usage";
import { isSingleMode } from "@/lib/config/mode";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 30;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Returns an error message when `date` is not an acceptable backfill day. */
function validateDate(date: string, todayMs: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "date must be YYYY-MM-DD";
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || isoDay(ms) !== date) return "date is not a real date";
  if (ms >= todayMs) return "date must be before today (UTC)";
  if (ms < todayMs - MAX_BACKFILL_DAYS * DAY_MS) {
    return `date must be within the last ${MAX_BACKFILL_DAYS} days`;
  }
  return null;
}

/**
 * Nightly: reconcile hosted subscriptions (and the text lifecycle) first, then
 * report billed texts to the Stripe meter for every pending day through
 * yesterday. `?date=YYYY-MM-DD` limits the catch-up to a day in the last 30.
 */
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

  const now = Date.now();
  const todayMs = Date.parse(`${isoDay(now)}T00:00:00Z`);
  const requested = new URL(request.url).searchParams.get("date");
  if (requested !== null) {
    const problem = validateDate(requested, todayMs);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }
  const date = requested ?? isoDay(todayMs - DAY_MS);

  // Reconcile first so a paid boundary or meter repaired tonight is visible to
  // the report. Every reporting tenant independently validates its lifecycle,
  // including when this preliminary reconciliation fails or crashes.
  let reconcile: Awaited<ReturnType<typeof reconcileHostedBilling>> | null = null;
  let reconcileError: string | null = null;
  try {
    reconcile = await reconcileHostedBilling();
  } catch {
    console.error("[billing] reconcileHostedBilling crashed", "hosted_reconcile_failed");
    reconcileError = "hosted_reconcile_failed";
  }

  let usage: Awaited<ReturnType<typeof reportSmsUsage>> | null = null;
  let usageError: string | null = null;
  try {
    usage = await reportSmsUsage(date, { now: new Date(now) });
  } catch {
    console.error("[billing] report-sms-usage failed", "usage_reporting_failed");
    usageError = "usage_reporting_failed";
  }

  const failed = usageError !== null || reconcileError !== null;
  return NextResponse.json(
    {
      date,
      usage,
      reconcile,
      ...(usageError ? { usageError } : {}),
      ...(reconcileError ? { reconcileError } : {}),
    },
    { status: failed ? 500 : 200 },
  );
}
