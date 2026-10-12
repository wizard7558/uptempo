import { and, desc, isNull, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

export interface AlertView {
  id: string;
  type: string;
  severity: "info" | "warning";
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

function serialize(row: {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}): AlertView {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity === "warning" ? "warning" : "info",
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAlertsForTenant(slug: string): Promise<AlertView[]> {
  return withTenantDb(slug, async (db, t) => {
    const rows = await db
      .select({
        id: t.alerts.id,
        type: t.alerts.type,
        severity: t.alerts.severity,
        title: t.alerts.title,
        body: t.alerts.body,
        data: t.alerts.data,
        readAt: t.alerts.readAt,
        createdAt: t.alerts.createdAt,
      })
      .from(t.alerts)
      .where(isNull(t.alerts.dismissedAt))
      .orderBy(desc(t.alerts.createdAt))
      .limit(50);
    return rows.map(serialize);
  });
}

export async function getUnreadAlertCountForTenant(
  slug: string,
): Promise<number> {
  return withTenantDb(slug, async (db, t) => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.alerts)
      .where(and(isNull(t.alerts.dismissedAt), isNull(t.alerts.readAt)));
    return Number(rows[0]?.count ?? 0);
  });
}
