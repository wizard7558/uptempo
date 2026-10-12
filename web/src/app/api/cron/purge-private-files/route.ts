import { NextResponse } from "next/server";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants } from "@/lib/tenant/registry";
import { getStorageProvider } from "@/lib/providers/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** First tenant schema version that has the `attachments` table. */
const MIN_SCHEMA_VERSION = 47;
const BATCH_LIMIT = 500;

/**
 * Daily cron: delete private files (ID photos, expired uploads) whose
 * `delete_after` has passed. The stored file goes first, then the row is marked
 * deleted, so a failed delete is retried on the next run.
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

  const now = new Date();
  const tenants = await listActiveTenants();

  let totalDeleted = 0;
  let totalFailed = 0;
  const results: Array<{ slug: string; deleted?: number; failed?: number; error?: string }> = [];

  for (const tenant of tenants) {
    if (tenant.schemaVersion < MIN_SCHEMA_VERSION) continue;
    try {
      const r = await purgeForTenant(tenant.slug, now);
      totalDeleted += r.deleted;
      totalFailed += r.failed;
      if (r.deleted > 0 || r.failed > 0) results.push({ slug: tenant.slug, ...r });
    } catch (error) {
      console.error(`[Cron] Private file purge failed for ${tenant.slug}:`, error);
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ deleted: totalDeleted, failed: totalFailed, tenants: results });
}

async function purgeForTenant(
  slug: string,
  now: Date,
): Promise<{ deleted: number; failed: number }> {
  const due = await withTenantDb(slug, async (db, { attachments }) =>
    db
      .select({ id: attachments.id, storageKey: attachments.storageKey })
      .from(attachments)
      .where(and(lte(attachments.deleteAfter, now), isNull(attachments.deletedAt)))
      .orderBy(asc(attachments.deleteAfter))
      .limit(BATCH_LIMIT),
  );
  if (due.length === 0) return { deleted: 0, failed: 0 };

  const storage = getStorageProvider();
  let deleted = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await storage.deleteByKey(row.storageKey);
      await withTenantDb(slug, async (db, { attachments }) => {
        await db.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, row.id));
      });
      deleted++;
    } catch (error) {
      failed++;
      console.error(`[Cron] Could not delete private file ${row.id} for ${slug}:`, error);
    }
  }
  return { deleted, failed };
}
