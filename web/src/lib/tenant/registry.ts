import { and, eq, ilike } from "drizzle-orm";
import { cache } from "react";
import { publicDb } from "@/lib/db";
import { newTenantShard } from "@/lib/db/shards";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlugOrNull } from "@/lib/tenant/context";
import { tenants } from "@/lib/db/schema";
import { hairSalon } from "@/lib/verticals/hair-salon";

/**
 * Resolve which tenant schema owns a client record (for public routes without
 * `x-tenant-slug`, e.g. `/account`).
 * - If request context implies a tenant, only match there when the client exists.
 * - Otherwise scan active tenants (same pattern as `resolveTenantSlugForAppointment`).
 */
export async function resolveTenantSlugForClient(
  clientId: string,
): Promise<string | null> {
  const fromContext = await getTenantSlugOrNull();
  if (fromContext) {
    const found = await withTenantDb(fromContext, async (db, { clients }) => {
      const [r] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      return r != null;
    });
    if (found) return fromContext;
  }

  const tenantList = await listActiveTenants();
  for (const t of tenantList) {
    const found = await withTenantDb(t.slug, async (db, { clients }) => {
      const [r] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      return r != null;
    });
    if (found) return t.slug;
  }
  return null;
}

/**
 * Tenant slug for booking client operations: prefer request/header context when
 * it matches the client; otherwise resolve by scanning tenants.
 */
export async function getTenantSlugForBookingClient(
  clientId: string,
): Promise<string | null> {
  const fromContext = await getTenantSlugOrNull();
  if (fromContext) {
    const ok = await withTenantDb(fromContext, async (db, { clients }) => {
      const [r] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      return r != null;
    });
    if (ok) return fromContext;
  }
  return resolveTenantSlugForClient(clientId);
}

export async function updateTenantOnboardingSteps(slug: string, steps: Record<string, boolean>) {
  await publicDb
    .update(tenants)
    .set({ onboardingSteps: steps, updatedAt: new Date() })
    .where(eq(tenants.slug, slug));
}

export const getTenantBySlug = cache(async (slug: string) => {
  const [tenant] = await publicDb
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return tenant ?? null;
});

/**
 * True when `slug` names a registered tenant whose schema has been provisioned
 * (schema_version > 0). Tenant-schema queries for any other slug would fail
 * with "relation ... does not exist", so public routes gate on this first.
 */
export async function isTenantProvisioned(slug: string): Promise<boolean> {
  const tenant = await getTenantBySlug(slug);
  return tenant != null && tenant.schemaVersion > 0;
}

export async function getTenantById(id: string) {
  const [tenant] = await publicDb
    .select()
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  return tenant ?? null;
}

export async function getTenantSlugForBusinessId(
  businessId: string,
): Promise<string | null> {
  const tenant = await getTenantById(businessId);
  return tenant?.slug ?? null;
}

export async function createTenant(data: {
  name: string;
  slug: string;
  timezone?: string;
}) {
  const [tenant] = await publicDb
    .insert(tenants)
    .values({
      name: data.name,
      slug: data.slug,
      timezone: data.timezone ?? "America/New_York",
      industry: "hair_salon",
      modules: [...hairSalon.modules],
      dbShard: newTenantShard(),
    })
    .returning();
  return tenant;
}

export async function listActiveTenants() {
  return publicDb
    .select()
    .from(tenants)
    .where(eq(tenants.status, "active"));
}

/**
 * Find the tenant slug that owns a Stripe Connect account.
 * Uses the unique index on stripe_connect_account_id for O(1) lookup.
 */
export async function findTenantByConnectAccountId(
  connectAccountId: string,
): Promise<string | null> {
  const [tenant] = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.stripeConnectAccountId, connectAccountId))
    .limit(1);
  return tenant?.slug ?? null;
}

/**
 * Resolve which tenant schema owns an appointment.
 * - If `x-tenant-slug` / session implies a tenant, only match there (avoids cross-tenant ID probing).
 * - Otherwise scan active tenants (public email links: /checkout, /cancel, /reschedule on the root domain).
 */
export async function resolveTenantSlugForAppointment(
  appointmentId: string,
): Promise<string | null> {
  const fromContext = await getTenantSlugOrNull();
  if (fromContext) {
    const found = await withTenantDb(fromContext, async (db, { appointments }) => {
      const [r] = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
      return r != null;
    });
    return found ? fromContext : null;
  }

  const tenantList = await listActiveTenants();
  for (const t of tenantList) {
    const found = await withTenantDb(t.slug, async (db, { appointments }) => {
      const [r] = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
      return r != null;
    });
    if (found) return t.slug;
  }
  return null;
}

export type MarketplaceSalon = { name: string; slug: string };

/**
 * Active salons that have opted into the public client app marketplace.
 * Optional case-insensitive name search. Used by the `/discover` screen that
 * the client iOS app opens to (since the app has no URL bar to carry a slug).
 */
export async function listMarketplaceSalons(
  search?: string,
): Promise<MarketplaceSalon[]> {
  const trimmed = search?.trim();
  return publicDb
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(
      and(
        eq(tenants.status, "active"),
        eq(tenants.listedInMarketplace, 1),
        trimmed ? ilike(tenants.name, `%${trimmed}%`) : undefined,
      ),
    )
    .orderBy(tenants.name)
    .limit(100);
}
