import { eq } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { hostedTextBillingState, tenants } from "@/lib/db/schema";

export type HostedTextState = typeof hostedTextBillingState.$inferSelect;
export type HostedTextTenant = {
  slug: string;
  comped: number;
  billingSwitchedAt: Date | null;
  smsLineStatus: string | null;
  customerId: string | null;
  subscriptionId: string | null;
};
export type StatePatch = Partial<
  Omit<HostedTextState, "tenantSlug" | "customerId" | "subscriptionId">
>;
export type LockDecision<T> = { insert?: boolean; patch?: StatePatch; result: T };

/** The only DB surface of the lifecycle; each call is one short statement or transaction. */
export interface HostedTextStore {
  readTenant(slug: string): Promise<HostedTextTenant | null>;
  readState(slug: string): Promise<HostedTextState | null>;
  /**
   * One transaction with no network: lock the tenant row, then the state row,
   * and apply the decision. `insert` creates the state row bound to the
   * locked tenant's customer and subscription.
   */
  locked<T>(
    slug: string,
    decide: (tenant: HostedTextTenant | null, state: HostedTextState | null) => LockDecision<T>,
  ): Promise<T>;
}

const tenantColumns = {
  slug: tenants.slug,
  comped: tenants.comped,
  billingSwitchedAt: tenants.billingSwitchedAt,
  smsLineStatus: tenants.smsLineStatus,
  customerId: tenants.platformStripeCustomerId,
  subscriptionId: tenants.stripeSubscriptionId,
};

export const drizzleHostedTextStore: HostedTextStore = {
  async readTenant(slug) {
    const [row] = await publicDb.select(tenantColumns).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return row ?? null;
  },
  async readState(slug) {
    const [row] = await publicDb.select().from(hostedTextBillingState)
      .where(eq(hostedTextBillingState.tenantSlug, slug)).limit(1);
    return row ?? null;
  },
  locked(slug, decide) {
    return publicDb.transaction(async (tx) => {
      const [tenant] = await tx.select(tenantColumns).from(tenants).where(eq(tenants.slug, slug)).for("update");
      const [state] = await tx.select().from(hostedTextBillingState)
        .where(eq(hostedTextBillingState.tenantSlug, slug)).for("update");
      const decision = decide(tenant ?? null, state ?? null);
      if (decision.insert && !state && tenant?.customerId && tenant.subscriptionId) {
        await tx.insert(hostedTextBillingState).values({
          ...decision.patch,
          tenantSlug: slug,
          customerId: tenant.customerId,
          subscriptionId: tenant.subscriptionId,
        });
      } else if (state && decision.patch && Object.keys(decision.patch).length > 0) {
        await tx.update(hostedTextBillingState).set(decision.patch)
          .where(eq(hostedTextBillingState.tenantSlug, slug));
      }
      return decision.result;
    });
  },
};
