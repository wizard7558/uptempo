import { AuthError } from "@/lib/auth/rbac";
import { eq } from "drizzle-orm";
import { provisionTenantSchema } from "@/lib/tenant/provision";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { withTenantDb } from "@/lib/db/tenant";
import { trackEvent } from "@/lib/analytics/events";
import { syncBillableStaff } from "@/lib/billing/billable-staff";

export async function ensureTenantProvisioned(
  slug: string,
  ownerUserId: string,
  ownerName: string,
  ownerEmail: string,
): Promise<{ provisioned: boolean; error?: string }> {
  try {
    const tenant = await getTenantBySlug(slug);
    if (!tenant) return { provisioned: false, error: "Tenant not found" };

    // Already provisioned
    if (tenant.schemaVersion > 0) return { provisioned: true };

    // Provision the schema (creates all tables, indexes, constraints)
    await provisionTenantSchema({
      name: tenant.name,
      slug: tenant.slug,
      timezone: tenant.timezone,
    });

    // Create the default stylist for the owner (idempotent for concurrent requests)
    await withTenantDb(slug, async (db, { staff }) => {
      const existing = await db
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.userId, ownerUserId))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(staff).values({
          displayName: ownerName,
          userId: ownerUserId,
          email: ownerEmail,
        });
      }
    });
    await syncBillableStaff(slug);

    trackEvent("salon.provisioned", { slug }, { tenantSlug: slug, userId: ownerUserId });
    return { provisioned: true };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    return { provisioned: false, error: error instanceof Error ? error.message : "Provisioning failed" };
  }
}
