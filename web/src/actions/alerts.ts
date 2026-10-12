"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { and, eq, isNull } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { AlertView, listAlertsForTenant, getUnreadAlertCountForTenant } from "@/lib/alerts/for-tenant";

/** Active alerts for the current request's tenant. */
export async function listAlerts(): Promise<AlertView[]> {
  const { tenantSlug: slug } = await requireStaff();
  return listAlertsForTenant(slug);
}

/** Unread count for the current request's tenant. */
export async function getUnreadAlertCount(): Promise<number> {
  const { tenantSlug: slug } = await requireStaff();
  return getUnreadAlertCountForTenant(slug);
}

/** Mark a single alert read. */
export async function markAlertRead(id: string): Promise<{ success: boolean }> {
  const { tenantSlug: slug } = await requireStaff();
  await withTenantDb(slug, async (db, t) => {
    await db
      .update(t.alerts)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(t.alerts.id, id), isNull(t.alerts.readAt)));
  });
  return { success: true };
}

/** Mark every active alert read (called when the bell menu opens). */
export async function markAllAlertsRead(): Promise<{ success: boolean }> {
  const { tenantSlug: slug } = await requireStaff();
  await withTenantDb(slug, async (db, t) => {
    await db
      .update(t.alerts)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(isNull(t.alerts.dismissedAt), isNull(t.alerts.readAt)));
  });
  return { success: true };
}

/** Soft-dismiss an alert (hidden from the bell, retained for history). */
export async function dismissAlert(id: string): Promise<{ success: boolean }> {
  const { tenantSlug: slug } = await requireStaff();
  await withTenantDb(slug, async (db, t) => {
    await db
      .update(t.alerts)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(eq(t.alerts.id, id));
  });
  return { success: true };
}
