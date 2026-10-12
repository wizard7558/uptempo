"use server";

import { getT } from "@/lib/terms/server";
import type Stripe from "stripe";
import { eq, and, asc, desc, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import {
  getTenantBySlug,
  getTenantSlugForBookingClient,
} from "@/lib/tenant/registry";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getStripe } from "@/lib/stripe/server";
import { getConnectChargeParams } from "@/lib/stripe/connect-charge-params";
import { getOrCreateMonthlyPrice } from "@/lib/stripe/membership-prices";
import { feePercentForTenant } from "@/lib/billing/platform-pricing";
import { customAmountError } from "@/lib/membership/custom-amount";
import {
  appendStoredValueLedger,
  getStoredValueBalanceCents,
  listStoredValueTransactions,
  transferStoredValueBetweenClients,
} from "@/lib/services/stored-value-ledger";
import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getUserRole, requireStaff } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/permissions";
import { publicDb } from "@/lib/db";
import { webhookLookup } from "@/lib/db/schema";
import { trackEvent } from "@/lib/analytics/events";
import {
  isStripeSubscriptionImmediatelyUsable,
  mapMembershipSubscriptionStatus,
} from "@/lib/membership/stripe-subscription-status";

async function requireSettings() {
  const role = await getUserRole();
  if (!role || !hasPermission(role, "manage_settings")) {
    throw new Error("Unauthorized");
  }
}

export async function getStoredValuePreviewForClient(clientId: string) {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    throw new Error("Unauthorized");
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    throw new Error((await getT("errors"))("membership.noPlace"));
  }
  return withTenantDb(slug, async (db, tables) => {
    const balance = await getStoredValueBalanceCents(db, tables, clientId);
    return { balanceCents: balance };
  });
}

export interface MembershipUpsellInfo {
  hasActivePlans: boolean;
  isMember: boolean;
  topMemberDiscountPercent: number;
}

const NO_UPSELL: MembershipUpsellInfo = {
  hasActivePlans: false,
  isMember: false,
  topMemberDiscountPercent: 0,
};

/**
 * Public: lightweight gating info for the Beauty Bank / membership upsell shown
 * in the booking flow. Returns a safe empty shape (no upsell) on any auth/lookup
 * miss — callers render it unconditionally, so it must never throw.
 */
export async function getMembershipUpsellInfo(
  clientId: string,
): Promise<MembershipUpsellInfo> {
  const session = await getBookingSession();
  if (!session || session !== clientId) return NO_UPSELL;
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) return NO_UPSELL;

  return withTenantDb(slug, async (db, { membershipPlans, clientMemberships }) => {
    const plans = await db
      .select({ discount: membershipPlans.retailDiscountPercent })
      .from(membershipPlans)
      .where(eq(membershipPlans.isActive, 1));
    const [member] = await db
      .select({ id: clientMemberships.id })
      .from(clientMemberships)
      .where(
        and(
          eq(clientMemberships.clientId, clientId),
          eq(clientMemberships.status, "active"),
        ),
      )
      .limit(1);
    return {
      hasActivePlans: plans.length > 0,
      isMember: Boolean(member),
      topMemberDiscountPercent: plans.reduce(
        (max, p) => Math.max(max, p.discount ?? 0),
        0,
      ),
    };
  });
}

/** Admin: read the Beauty Bank credit-expiry window (months; null = never). */
export async function getStoredValueExpiryMonths(): Promise<number | null> {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [p] = await db
      .select({ m: businessSettings.storedValueExpiryMonths })
      .from(businessSettings)
      .limit(1);
    return p?.m ?? null;
  });
}

/** Admin: set the Beauty Bank credit-expiry window. null/0 disables expiry. */
export async function setStoredValueExpiryMonths(months: number | null) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  const value =
    months != null && Number.isFinite(months) && months > 0
      ? Math.min(120, Math.round(months))
      : null;
  await withTenantDb(slug, async (db, { businessSettings }) => {
    // Ensure a policy row exists, then update.
    const [existing] = await db
      .select({ id: businessSettings.id })
      .from(businessSettings)
      .limit(1);
    if (existing) {
      await db
        .update(businessSettings)
        .set({ storedValueExpiryMonths: value, updatedAt: new Date() })
        .where(eq(businessSettings.id, existing.id));
    } else {
      await db.insert(businessSettings).values({ storedValueExpiryMonths: value });
    }
  });
  revalidatePath("/settings/memberships");
  return { success: true as const };
}

export interface MembershipOverviewRow {
  clientId: string;
  clientName: string;
  planName: string;
  monthlyAmountCents: number;
  status: string;
  currentPeriodEnd: Date | null;
}

/** Admin: active membership roster + simple MRR for the settings overview. */
export async function listActiveMemberships(): Promise<{
  memberships: MembershipOverviewRow[];
  mrrCents: number;
  count: number;
}> {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  return withTenantDb(
    slug,
    async (db, { clientMemberships, membershipPlans, clients }) => {
      const rows = await db
        .select({
          clientId: clientMemberships.clientId,
          clientName: clients.name,
          planName: membershipPlans.name,
          monthlyAmountCents: sql<number>`coalesce(${clientMemberships.monthlyAmountCents}, ${membershipPlans.monthlyAmountCents})`,
          status: clientMemberships.status,
          currentPeriodEnd: clientMemberships.currentPeriodEnd,
        })
        .from(clientMemberships)
        .innerJoin(
          membershipPlans,
          eq(clientMemberships.planId, membershipPlans.id),
        )
        .innerJoin(clients, eq(clientMemberships.clientId, clients.id))
        .where(eq(clientMemberships.status, "active"))
        .orderBy(asc(clients.name));
      const mrrCents = rows.reduce((sum, r) => sum + r.monthlyAmountCents, 0);
      return { memberships: rows, mrrCents, count: rows.length };
    },
  );
}

export async function listMembershipPlans() {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  return withTenantDb(slug, async (db, { membershipPlans }) => {
    return db
      .select()
      .from(membershipPlans)
      .orderBy(desc(membershipPlans.createdAt));
  });
}

/** What a plan gives members, and the credit settings that go with it. */
const planKindSchema = z.enum(["stored_value", "credits", "discount"]);
const creditSettingsSchema = z.object({
  kind: planKindSchema.optional(),
  creditsPerPeriod: z.number().int().min(1).max(30).nullable().optional(),
  rolloverMax: z.number().int().min(0).max(10).optional(),
  eligibleServiceIds: z.array(z.string().uuid()).optional(),
});

type PlanCreditSettings = z.input<typeof creditSettingsSchema>;

/** Validates the credit fields. A credits plan must say how many credits each month. */
function parseCreditSettings(
  data: PlanCreditSettings,
  existingKind?: string,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = creditSettingsSchema.safeParse({
    kind: data.kind,
    creditsPerPeriod: data.creditsPerPeriod,
    rolloverMax: data.rolloverMax,
    eligibleServiceIds: data.eligibleServiceIds,
  });
  if (!parsed.success) {
    return { ok: false, error: "Check the monthly credit settings: 1 to 30 each month, 0 to 10 carried over." };
  }
  const v = parsed.data;
  const kind = v.kind ?? existingKind;
  if (kind === "credits" && !v.creditsPerPeriod) {
    return { ok: false, error: "Say how many each month." };
  }
  const values: Record<string, unknown> = {};
  if (v.kind !== undefined) values.kind = v.kind;
  if (v.kind === "credits") {
    values.creditsPerPeriod = v.creditsPerPeriod;
    if (v.rolloverMax !== undefined) values.rolloverMax = v.rolloverMax;
    if (v.eligibleServiceIds !== undefined) values.eligibleServiceIds = v.eligibleServiceIds;
  } else if (v.kind !== undefined) {
    // Other kinds carry no credit settings.
    values.creditsPerPeriod = null;
    values.rolloverMax = 0;
    values.eligibleServiceIds = [];
  }
  return { ok: true, values };
}

export async function createMembershipPlan(data: {
  name: string;
  monthlyAmountCents: number;
  retailDiscountPercent?: number;
  priorityBooking?: boolean;
  priorityBookingDays?: number;
  description?: string;
  allowCustomAmount?: boolean;
} & PlanCreditSettings) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();

  const credit = parseCreditSettings(data, "stored_value");
  if (!credit.ok) return { success: false as const, error: credit.error };

  const [plan] = await withTenantDb(slug, async (db, { membershipPlans }) => {
    return db
      .insert(membershipPlans)
      .values({
        name: data.name,
        monthlyAmountCents: data.monthlyAmountCents,
        retailDiscountPercent: data.retailDiscountPercent ?? 0,
        priorityBooking: data.priorityBooking ? 1 : 0,
        priorityBookingDays: data.priorityBookingDays ?? 14,
        description: data.description ?? null,
        allowCustomAmount: data.allowCustomAmount ? 1 : 0,
        isActive: 1,
        ...credit.values,
      })
      .returning();
  });

  const stripe = getStripe();
  const product = await stripe.products.create({
    name: `${data.name} — ${slug}`,
    metadata: { tenantSlug: slug, planId: plan.id, purpose: "beauty_bank_plan" },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: data.monthlyAmountCents,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { tenantSlug: slug, planId: plan.id, purpose: "beauty_bank_plan" },
  });

  await withTenantDb(slug, async (db, { membershipPlans }) => {
    await db
      .update(membershipPlans)
      .set({
        stripeProductId: product.id,
        stripePriceId: price.id,
        updatedAt: new Date(),
      })
      .where(eq(membershipPlans.id, plan.id));
  });

  revalidatePath("/settings/memberships");
  trackEvent("membership.plan_created", { planId: plan.id }, { tenantSlug: slug });
  return { success: true as const, planId: plan.id };
}

export async function updateMembershipPlan(
  planId: string,
  data: Partial<{
    name: string;
    isActive: boolean;
    retailDiscountPercent: number;
    priorityBooking: boolean;
    priorityBookingDays: number;
    description: string | null;
    monthlyAmountCents: number;
    allowCustomAmount: boolean;
  }> &
    PlanCreditSettings,
) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();

  const credit = parseCreditSettings(data);
  if (!credit.ok) return { success: false as const, error: credit.error };

  // Stripe prices are immutable. To change the monthly amount we create a fresh
  // recurring price on the same product and archive the old one. NOTE: this only
  // affects NEW enrollments — existing subscribers keep the price they signed up
  // at until they cancel and re-enroll.
  let newStripePriceId: string | undefined;
  if (
    data.monthlyAmountCents !== undefined &&
    data.monthlyAmountCents > 0
  ) {
    const [plan] = await withTenantDb(slug, async (db, { membershipPlans }) => {
      return db
        .select({
          stripeProductId: membershipPlans.stripeProductId,
          stripePriceId: membershipPlans.stripePriceId,
          monthlyAmountCents: membershipPlans.monthlyAmountCents,
        })
        .from(membershipPlans)
        .where(eq(membershipPlans.id, planId))
        .limit(1);
    });
    if (
      plan &&
      plan.stripeProductId &&
      plan.monthlyAmountCents !== data.monthlyAmountCents
    ) {
      const stripe = getStripe();
      const price = await stripe.prices.create({
        product: plan.stripeProductId,
        unit_amount: data.monthlyAmountCents,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { tenantSlug: slug, planId, purpose: "beauty_bank_plan" },
      });
      newStripePriceId = price.id;
      if (plan.stripePriceId) {
        try {
          await stripe.prices.update(plan.stripePriceId, { active: false });
        } catch (err) {
          console.error("[Membership] Failed to archive old price:", err);
        }
      }
    }
  }

  await withTenantDb(slug, async (db, { membershipPlans }) => {
    await db
      .update(membershipPlans)
      .set({
        ...("name" in data && data.name !== undefined
          ? { name: data.name }
          : {}),
        ...("isActive" in data && data.isActive !== undefined
          ? { isActive: data.isActive ? 1 : 0 }
          : {}),
        ...("retailDiscountPercent" in data &&
        data.retailDiscountPercent !== undefined
          ? { retailDiscountPercent: data.retailDiscountPercent }
          : {}),
        ...("priorityBooking" in data && data.priorityBooking !== undefined
          ? { priorityBooking: data.priorityBooking ? 1 : 0 }
          : {}),
        ...("priorityBookingDays" in data &&
        data.priorityBookingDays !== undefined
          ? { priorityBookingDays: data.priorityBookingDays }
          : {}),
        ...("description" in data ? { description: data.description } : {}),
        ...("allowCustomAmount" in data && data.allowCustomAmount !== undefined
          ? { allowCustomAmount: data.allowCustomAmount ? 1 : 0 }
          : {}),
        ...(data.monthlyAmountCents !== undefined && data.monthlyAmountCents > 0
          ? { monthlyAmountCents: data.monthlyAmountCents }
          : {}),
        ...(newStripePriceId ? { stripePriceId: newStripePriceId } : {}),
        ...credit.values,
        updatedAt: new Date(),
      })
      .where(eq(membershipPlans.id, planId));
  });
  revalidatePath("/settings/memberships");
  trackEvent("membership.plan_updated", { planId }, { tenantSlug: slug });
  return { success: true as const };
}

async function ensureStripeCustomer(
  slug: string,
  clientId: string,
): Promise<string> {
  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });
  if (!client) throw new Error("Client not found");
  if (client.stripeCustomerId) return client.stripeCustomerId;
  const customer = await getStripe().customers.create({
    email: client.email ?? undefined,
    phone: client.phone ?? undefined,
    metadata: { clientId, tenantSlug: slug },
  });
  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
  });
  await publicDb
    .insert(webhookLookup)
    .values({
      lookupType: "stripe_customer",
      externalId: customer.id,
      tenantSlug: slug,
    })
    .onConflictDoNothing();
  return customer.id;
}

type TenantRow = NonNullable<Awaited<ReturnType<typeof getTenantBySlug>>>;

/**
 * Creates Stripe subscription + client_memberships row + webhook_lookup.
 * Shared by admin enroll and public self-serve subscribe.
 */
async function createStoredValueSubscriptionAndRecord(params: {
  slug: string;
  tenant: TenantRow;
  clientId: string;
  planId: string;
  /** Client-chosen amount (>= plan minimum) when the plan allows custom amounts. */
  customAmountCents?: number | null;
  defaultPaymentMethodId?: string | null;
  requireActivePlan?: boolean;
  requireUsableStatus?: boolean;
  /** Message, or a lazy resolver so translated copy is only built when needed. */
  openMembershipError?: string | (() => Promise<string>);
}): Promise<
  | { success: true; subscriptionId: string }
  | { success: false; error: string }
> {
  const {
    slug,
    tenant,
    clientId,
    planId,
    customAmountCents = null,
    defaultPaymentMethodId,
    requireActivePlan = false,
    requireUsableStatus = false,
    openMembershipError = "Client already has a membership in progress",
  } = params;

  const [plan] = await withTenantDb(slug, async (db, { membershipPlans }) => {
    return db
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.id, planId))
      .limit(1);
  });
  if (!plan) {
    return { success: false as const, error: "Plan not found" };
  }
  if (requireActivePlan && plan.isActive !== 1) {
    return { success: false as const, error: "Plan is no longer available" };
  }
  if (!plan.stripePriceId) {
    return { success: false as const, error: "Plan has no Stripe price" };
  }

  // Resolve the effective amount + Stripe price. For a custom amount we
  // create-or-reuse a recurring price on the plan's product (one product, many
  // prices) rather than minting a product per amount.
  const planAmountCents = plan.monthlyAmountCents;
  let effectiveAmountCents = planAmountCents;
  let priceId = plan.stripePriceId;

  if (customAmountCents != null && customAmountCents !== planAmountCents) {
    const amountError = customAmountError(plan, customAmountCents);
    if (amountError) {
      return { success: false as const, error: amountError };
    }
    priceId = await getOrCreateMonthlyPrice(getStripe(), {
      // customAmountError guarantees stripeProductId is set.
      productId: plan.stripeProductId!,
      unitAmountCents: customAmountCents,
      slug,
      planId,
    });
    effectiveAmountCents = customAmountCents;
  }

  const [existing] = await withTenantDb(slug, async (db, { clientMemberships }) => {
    return db
      .select({
        id: clientMemberships.id,
        status: clientMemberships.status,
      })
      .from(clientMemberships)
      .where(
        and(
          eq(clientMemberships.clientId, clientId),
          ne(clientMemberships.status, "cancelled"),
        ),
      )
      .orderBy(desc(clientMemberships.createdAt))
      .limit(1);
  });
  if (existing) {
    return {
      success: false as const,
      error:
        typeof openMembershipError === "function"
          ? await openMembershipError()
          : openMembershipError,
    };
  }

  const customerId = await ensureStripeCustomer(slug, clientId);
  const connect = await getConnectChargeParams(slug, effectiveAmountCents);
  const feePercent = applicationFeePercentForTenant(tenant);

  const subParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: priceId }],
    metadata: {
      tenantSlug: slug,
      clientId,
      planId,
      purpose: "beauty_bank_membership",
    },
  };
  if (defaultPaymentMethodId) {
    subParams.default_payment_method = defaultPaymentMethodId;
  }
  if (connect) {
    subParams.transfer_data = { destination: connect.connectAccountId };
    if (feePercent > 0) {
      subParams.application_fee_percent = feePercent;
    }
  }
  // Dedupe rapid double-submits, but still allow legitimate resubscribe attempts later.
  const idempotencyWindow = Math.floor(Date.now() / (1000 * 60 * 10));

  const subscription = await getStripe().subscriptions.create(subParams, {
    idempotencyKey: `beauty-bank-membership:${slug}:${clientId}:${planId}:${effectiveAmountCents}:${idempotencyWindow}`,
  });
  const sub = subscription as unknown as {
    id: string;
    status: Stripe.Subscription.Status;
    current_period_start?: number;
    current_period_end?: number;
  };
  const membershipStatus = mapMembershipSubscriptionStatus(sub.status);

  await withTenantDb(slug, async (db, { clientMemberships }) => {
    await db.insert(clientMemberships).values({
      clientId,
      planId,
      monthlyAmountCents: effectiveAmountCents,
      stripePriceId: priceId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      status: membershipStatus,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
    });
  });

  await publicDb
    .insert(webhookLookup)
    .values({
      lookupType: "stripe_subscription",
      externalId: sub.id,
      tenantSlug: slug,
    })
    .onConflictDoNothing();

  if (requireUsableStatus && !isStripeSubscriptionImmediatelyUsable(sub.status)) {
    return {
      success: false as const,
      error: (await getT("errors", slug))("membership.notActivated"),
    };
  }

  return { success: true as const, subscriptionId: sub.id };
}

/** Public: active membership plans for subscribe page (no auth). */
export async function listActiveMembershipPlansPublic(slug: string) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return [];

  return withTenantDb(slug, async (db, { membershipPlans }) => {
    return db
      .select({
        id: membershipPlans.id,
        name: membershipPlans.name,
        monthlyAmountCents: membershipPlans.monthlyAmountCents,
        retailDiscountPercent: membershipPlans.retailDiscountPercent,
        priorityBooking: membershipPlans.priorityBooking,
        priorityBookingDays: membershipPlans.priorityBookingDays,
        description: membershipPlans.description,
        allowCustomAmount: membershipPlans.allowCustomAmount,
      })
      .from(membershipPlans)
      .where(eq(membershipPlans.isActive, 1))
      .orderBy(desc(membershipPlans.createdAt));
  });
}

/** Public: start Beauty Bank subscription after booking session + card on file. */
export async function startStoredValueSubscriptionPublic(data: {
  clientId: string;
  planId: string;
  /** Client-chosen monthly amount when the plan allows custom amounts. */
  customAmountCents?: number;
  /** When the client just completed SetupIntent, pass PM id so we do not wait on webhook. */
  stripePaymentMethodId?: string;
}) {
  const session = await getBookingSession();
  if (!session || session !== data.clientId) {
    return { success: false as const, error: "Unauthorized" };
  }
  const slug = await getTenantSlugForBookingClient(data.clientId);
  if (!slug) {
    return {
      success: false as const,
      error: (await getT("errors"))("membership.noPlace"),
    };
  }
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return { success: false as const, error: "Tenant not found" };
  }

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({ stripePaymentMethodId: clients.stripePaymentMethodId })
      .from(clients)
      .where(eq(clients.id, data.clientId))
      .limit(1);
  });
  const paymentMethodId =
    data.stripePaymentMethodId ?? client?.stripePaymentMethodId ?? null;
  if (!paymentMethodId) {
    return {
      success: false as const,
      error: "Save a card on file before subscribing",
    };
  }

  const result = await createStoredValueSubscriptionAndRecord({
    slug,
    tenant,
    clientId: data.clientId,
    planId: data.planId,
    customAmountCents: data.customAmountCents ?? null,
    defaultPaymentMethodId: paymentMethodId,
    requireActivePlan: true,
    requireUsableStatus: true,
    openMembershipError: async () =>
      (await getT("errors", slug))("membership.openSubscription"),
  });
  if (!result.success) {
    return result;
  }

  if (data.stripePaymentMethodId) {
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({
          stripePaymentMethodId: data.stripePaymentMethodId,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, data.clientId));
    });
  }

  revalidatePath("/account");
  trackEvent(
    "membership.enrolled_public",
    {
      clientId: data.clientId,
      planId: data.planId,
      amountCents: data.customAmountCents ?? null,
    },
    { tenantSlug: slug },
  );
  return {
    success: true as const,
    subscriptionId: result.subscriptionId,
  };
}

export async function enrollClientInMembershipPlan(data: {
  clientId: string;
  planId: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new Error("Tenant not found");

  const [clientPm] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({ stripePaymentMethodId: clients.stripePaymentMethodId })
      .from(clients)
      .where(eq(clients.id, data.clientId))
      .limit(1);
  });

  const result = await createStoredValueSubscriptionAndRecord({
    slug,
    tenant,
    clientId: data.clientId,
    planId: data.planId,
    defaultPaymentMethodId: clientPm?.stripePaymentMethodId ?? null,
  });

  if (!result.success) {
    return result;
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${data.clientId}`);
  trackEvent(
    "membership.enrolled",
    { clientId: data.clientId, planId: data.planId },
    { tenantSlug: slug },
  );
  return { success: true as const };
}

export async function cancelClientMembership(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();

  const [membership] = await withTenantDb(slug, async (db, { clientMemberships }) => {
    return db
      .select()
      .from(clientMemberships)
      .where(
        and(
          eq(clientMemberships.clientId, clientId),
          eq(clientMemberships.status, "active"),
        ),
      )
      .limit(1);
  });

  if (!membership?.stripeSubscriptionId) {
    return { success: false as const, error: "No active membership" };
  }

  await getStripe().subscriptions.cancel(membership.stripeSubscriptionId);

  await withTenantDb(slug, async (db, { clientMemberships }) => {
    await db
      .update(clientMemberships)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clientMemberships.id, membership.id));
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { success: true as const };
}

/**
 * Public (booking session) — balance, membership, transactions without admin auth.
 */
export async function getClientStoredValuePublic(clientId: string) {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    throw new Error("Unauthorized");
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    throw new Error("Not found");
  }
  return withTenantDb(slug, async (db, tables) => {
    const { clientMemberships, membershipPlans, clients } = tables;
    const [membership] = await db
      .select({
        id: clientMemberships.id,
        status: clientMemberships.status,
        stripeSubscriptionId: clientMemberships.stripeSubscriptionId,
        currentPeriodEnd: clientMemberships.currentPeriodEnd,
        planName: membershipPlans.name,
        planId: membershipPlans.id,
        monthlyAmountCents: sql<number>`coalesce(${clientMemberships.monthlyAmountCents}, ${membershipPlans.monthlyAmountCents})`,
      })
      .from(clientMemberships)
      .innerJoin(
        membershipPlans,
        eq(clientMemberships.planId, membershipPlans.id),
      )
      .where(
        and(
          eq(clientMemberships.clientId, clientId),
          eq(clientMemberships.status, "active"),
        ),
      )
      .limit(1);

    const balance = await getStoredValueBalanceCents(db, tables, clientId);
    const [clientRow] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    const txns = await listStoredValueTransactions(db, tables, clientId, 40);

    return {
      clientName: clientRow?.name ?? "Client",
      balanceCents: balance,
      membership: membership ?? null,
      transactions: txns,
    };
  });
}

export async function getClientMembershipAndStoredValue(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  return withTenantDb(slug, async (db, tables) => {
    const { clientMemberships, membershipPlans, clients } = tables;
    const [membership] = await db
      .select({
        id: clientMemberships.id,
        status: clientMemberships.status,
        stripeSubscriptionId: clientMemberships.stripeSubscriptionId,
        currentPeriodEnd: clientMemberships.currentPeriodEnd,
        planName: membershipPlans.name,
        planId: membershipPlans.id,
        monthlyAmountCents: sql<number>`coalesce(${clientMemberships.monthlyAmountCents}, ${membershipPlans.monthlyAmountCents})`,
      })
      .from(clientMemberships)
      .innerJoin(
        membershipPlans,
        eq(clientMemberships.planId, membershipPlans.id),
      )
      .where(
        and(
          eq(clientMemberships.clientId, clientId),
          eq(clientMemberships.status, "active"),
        ),
      )
      .limit(1);

    const balance = await getStoredValueBalanceCents(db, tables, clientId);
    const [clientRow] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    const txns = await listStoredValueTransactions(db, tables, clientId, 40);

    return {
      clientName: clientRow?.name ?? "Client",
      balanceCents: balance,
      membership: membership ?? null,
      transactions: txns,
    };
  });
}

export async function adminTransferStoredValue(data: {
  fromClientId: string;
  toClientId: string;
  amountCents: number;
}) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  const session = await auth.api.getSession({ headers: await headers() });
  const createdBy = session?.user?.id ?? "admin";

  await withTenantDb(slug, async (db, tables) => {
    return db.transaction(async (tx) => {
      await transferStoredValueBetweenClients(tx, tables, {
        fromClientId: data.fromClientId,
        toClientId: data.toClientId,
        amountCents: data.amountCents,
        createdBy,
      });
    });
  });

  revalidatePath(`/clients/${data.fromClientId}`);
  revalidatePath(`/clients/${data.toClientId}`);
  return { success: true as const };
}

export async function adminAdjustStoredValue(data: {
  clientId: string;
  amountCents: number;
  note?: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  await requireSettings();
  if (data.amountCents === 0) {
    return { success: false as const, error: "Amount must not be zero" };
  }

  const type = data.amountCents > 0 ? "admin_credit" : "admin_debit";

  const session = await auth.api.getSession({ headers: await headers() });
  const createdBy = session?.user?.id ?? "admin";

  await withTenantDb(slug, async (db, tables) => {
    return db.transaction(async (tx) => {
      await appendStoredValueLedger(tx, tables, {
        clientId: data.clientId,
        type,
        amountCents: data.amountCents,
        note: data.note ?? "Manual adjustment",
        createdBy,
      });
    });
  });

  revalidatePath(`/clients/${data.clientId}`);
  return { success: true as const };
}

export async function createStoredValueTopUpPaymentIntent(data: {
  clientId: string;
  amountCents: number;
}) {
  const session = await getBookingSession();
  if (!session || session !== data.clientId) {
    return { success: false as const, error: "Unauthorized" };
  }
  const slug = await getTenantSlugForBookingClient(data.clientId);
  if (!slug) {
    return {
      success: false as const,
      error: (await getT("errors"))("membership.noPlace"),
    };
  }
  if (data.amountCents < 50) {
    return { success: false as const, error: "Minimum top-up is $0.50" };
  }

  const customerId = await ensureStripeCustomer(slug, data.clientId);
  const connectParams = await getConnectChargeParams(slug, data.amountCents);

  const intentParams: Stripe.PaymentIntentCreateParams = {
    amount: data.amountCents,
    currency: "usd",
    customer: customerId,
    metadata: {
      tenantSlug: slug,
      clientId: data.clientId,
      purpose: "beauty_bank_topup",
    },
    automatic_payment_methods: { enabled: true },
  };

  if (connectParams) {
    intentParams.transfer_data = {
      destination: connectParams.connectAccountId,
    };
    if (connectParams.platformFeeCents > 0) {
      intentParams.application_fee_amount = connectParams.platformFeeCents;
    }
  }

  const pi = await getStripe().paymentIntents.create(intentParams);
  return { success: true as const, clientSecret: pi.client_secret };
}

// Fee percentage now lives in the shared platform-pricing module (single source
// of truth for the per-transaction application fee and the billing preview).
function applicationFeePercentForTenant(tenant: {
  plan: string;
  platformFeePercent: number | null;
}): number {
  return feePercentForTenant(tenant);
}
