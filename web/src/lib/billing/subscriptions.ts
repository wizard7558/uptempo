import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { EvidenceConflict } from "@/lib/billing/subscription-webhook";
import { HOSTED_PLAN_PURPOSE } from "@/lib/billing/hosted-catalog";
import {
  reconcileHostedTextMeter,
  type TextMeterResult,
} from "@/lib/billing/hosted-text-lifecycle";
import {
  extraStaffQuantity,
  HOSTED_BASE_MONTHLY_LOOKUP_KEY,
  HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY,
  HOSTED_TEXT_LINE_MONTHLY_LOOKUP_KEY,
  HOSTED_TEXTS_METERED_LOOKUP_KEY,
} from "@/lib/billing/hosted-pricing";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe/server";

export type DesiredItem = { lookupKey: string; quantity?: number };

export type SkipReason =
  | "single_mode"
  | "comped"
  | "exists"
  | "awaiting_switch"
  | "no_tenant"
  | "no_subscription";

/** Public database handle supplied by a caller that already holds a tenant lock. */
export type BillingDatabaseContext = typeof publicDb;

const STRIPE_READ_OPTIONS = { timeout: 5_000, maxNetworkRetries: 0 } as const;
const STRIPE_WRITE_OPTIONS = { timeout: 30_000, maxNetworkRetries: 0 } as const;

/**
 * The metered texts item is owned by the hosted text lifecycle. A caller that
 * supplies its own transaction cannot persist a durable meter operation, so it
 * must defer the meter and reconcile it after commit.
 */
type TextMeterMode =
  | { db?: undefined; textMeter?: "reconcile" }
  | {
      /** Reuse the caller's transaction for every public tenant read and write. */
      db: BillingDatabaseContext;
      textMeter: "defer";
    };

type HostedSubscriptionOptions = {
  trialDays: number;
  collection?: "charge_automatically" | "send_invoice";
  /** Reserved for the automatic 6.5b transition. */
  billingSwitch?: boolean;
  /** Owner address from the existing billing-notice resolver. */
  ownerEmail?: string;
} & TextMeterMode;

type SubscriptionSyncOptions = {
  /** Add shared-line items before the final switch marker is committed. */
  billingSwitch?: boolean;
} & TextMeterMode;

/** Runtime guard for untyped callers: a supplied db and "defer" always travel together. */
function deferTextMeter(options: TextMeterMode): boolean {
  const mode: string | undefined = options.textMeter;
  if ((options.db != null) !== (mode === "defer")) {
    throw new Error("A supplied billing transaction requires textMeter: 'defer'.");
  }
  return mode === "defer";
}

/**
 * The subscription items a business should have right now. Base and extra
 * staff are always present (extra staff at quantity 0 is kept so a later staff
 * change is a quantity update). The text line and metered texts are present
 * only when the business pays for them: an active own line, or the shared line
 * after the business has switched to hosted billing (D7, D8).
 */
export function desiredItems(input: {
  billableStaff: number;
  smsLineStatus?: string | null;
  billingSwitched?: boolean;
}): DesiredItem[] {
  const items: DesiredItem[] = [
    { lookupKey: HOSTED_BASE_MONTHLY_LOOKUP_KEY, quantity: 1 },
    {
      lookupKey: HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY,
      quantity: extraStaffQuantity(Math.max(1, input.billableStaff)),
    },
  ];
  const textsOn =
    input.smsLineStatus === "active" ||
    (input.smsLineStatus === "shared" && input.billingSwitched === true);
  if (textsOn) {
    items.push({ lookupKey: HOSTED_TEXT_LINE_MONTHLY_LOOKUP_KEY, quantity: 1 });
    items.push({ lookupKey: HOSTED_TEXTS_METERED_LOOKUP_KEY });
  }
  return items;
}

/** desiredItems without the metered texts item, which the text lifecycle owns. */
export function licensedItems(
  input: Parameters<typeof desiredItems>[0],
): DesiredItem[] {
  return desiredItems(input).filter(
    (item) => item.lookupKey !== HOSTED_TEXTS_METERED_LOOKUP_KEY,
  );
}

export type CurrentItem = { id: string; quantity?: number | null };

export type ItemPlan = {
  create: DesiredItem[];
  update: Array<{
    id: string;
    lookupKey: string;
    from: number | null;
    quantity: number;
  }>;
  remove: Array<{ id: string; lookupKey: string }>;
};

/**
 * What to change so a subscription's items (by price lookup key) match the
 * wanted items: create the missing, update changed quantities, remove the rest.
 * Metered items have no quantity and are never updated.
 */
export function diffItems(
  current: Map<string, CurrentItem>,
  wanted: DesiredItem[],
): ItemPlan {
  const wantedKeys = new Set(wanted.map((i) => i.lookupKey));
  const plan: ItemPlan = { create: [], update: [], remove: [] };
  for (const item of wanted) {
    const existing = current.get(item.lookupKey);
    if (!existing) {
      plan.create.push(item);
    } else if (
      item.quantity !== undefined &&
      existing.quantity !== item.quantity
    ) {
      plan.update.push({
        id: existing.id,
        lookupKey: item.lookupKey,
        from: existing.quantity ?? null,
        quantity: item.quantity,
      });
    }
  }
  for (const [lookupKey, existing] of current) {
    if (!wantedKeys.has(lookupKey))
      plan.remove.push({ id: existing.id, lookupKey });
  }
  return plan;
}

const priceIdCache = new Map<string, string>();

export function resetHostedPriceCacheForTests(): void {
  priceIdCache.clear();
}

/** Look up Stripe price ids by lookup key, cached per process. */
export async function resolvePriceIds(
  lookupKeys: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const missing: string[] = [];
  for (const key of lookupKeys) {
    const cached = priceIdCache.get(key);
    if (cached) result.set(key, cached);
    else missing.push(key);
  }
  if (missing.length > 0) {
    const list = await getStripe().prices.list({
      lookup_keys: missing,
      active: true,
      limit: 100,
    });
    for (const price of list.data) {
      if (price.lookup_key) {
        priceIdCache.set(price.lookup_key, price.id);
        result.set(price.lookup_key, price.id);
      }
    }
  }
  const stillMissing = lookupKeys.filter((key) => !result.has(key));
  if (stillMissing.length > 0) {
    throw new Error(
      `Stripe price(s) not found for lookup key(s): ${stillMissing.join(", ")}. ` +
        "Run scripts/stripe/ensure-hosted-catalog.ts to create the hosted catalog.",
    );
  }
  return result;
}

async function loadTenant(
  slug: string,
  db: BillingDatabaseContext = publicDb,
) {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return tenant ?? null;
}

function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function assertHostedCustomerOwner(
  customer: Stripe.Customer,
  slug: string,
): void {
  const tenantSlug = customer.metadata?.tenantSlug;
  const purpose = customer.metadata?.purpose;
  if (tenantSlug && tenantSlug !== slug) {
    throw new Error("Hosted billing customer is bound to a different tenant.");
  }
  if (purpose && purpose !== HOSTED_PLAN_PURPOSE) {
    throw new Error("Hosted billing customer has a different purpose.");
  }
}

async function retrieveHostedCustomer(
  slug: string,
  customerId: string,
  stripe: ReturnType<typeof getStripe>,
  ownerEmail?: string,
): Promise<Stripe.Customer> {
  const retrieved = await stripe.customers.retrieve(
    customerId,
    { expand: ["invoice_settings.default_payment_method", "default_source"] },
    STRIPE_READ_OPTIONS,
  );
  if ("deleted" in retrieved && retrieved.deleted) {
    throw new Error("Hosted billing customer has been deleted.");
  }
  let customer = retrieved as Stripe.Customer;
  assertHostedCustomerOwner(customer, slug);

  if (ownerEmail && customer.email !== ownerEmail) {
    const updated = await stripe.customers.update(
      customerId,
      { email: ownerEmail },
      STRIPE_WRITE_OPTIONS,
    );
    assertHostedCustomerOwner(updated, slug);
    customer = updated;
  }
  return customer;
}

async function findHostedCustomer(
  slug: string,
  stripe: ReturnType<typeof getStripe>,
): Promise<string | null> {
  const querySlug = slug.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  try {
    const search = await stripe.customers.search(
      {
        query:
          `metadata['tenantSlug']:'${querySlug}' ` +
          `AND metadata['purpose']:'${HOSTED_PLAN_PURPOSE}'`,
        limit: 100,
      },
      STRIPE_READ_OPTIONS,
    );
    if (search.data.length > 1) {
      throw new Error("Multiple hosted billing customers require manual review.");
    }
    if (search.data.length === 1 && !search.has_more) {
      return search.data[0]!.id;
    }
  } catch (error) {
    if (error instanceof Error && /manual review/.test(error.message)) throw error;
    // Search is eventually consistent; the bounded inventory pass below is
    // the recovery source when it is unavailable or returns an ambiguous page.
  }
  return findHostedCustomerInList(slug, stripe);
}

/** Bounded recovery for missing or ambiguous metadata-search results. */
async function findHostedCustomerInList(
  slug: string,
  stripe: ReturnType<typeof getStripe>,
): Promise<string | null> {
  let startingAfter: string | undefined;
  let match: string | null = null;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const page = await stripe.customers.list(
      {
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      STRIPE_READ_OPTIONS,
    );
    for (const customer of page.data) {
      if (
        customer.metadata?.tenantSlug === slug &&
        customer.metadata?.purpose === HOSTED_PLAN_PURPOSE
      ) {
        if (match && match !== customer.id) {
          throw new Error("Multiple hosted billing customers require manual review.");
        }
        match = customer.id;
      }
    }
    if (!page.has_more) return match;
    const last = page.data.at(-1);
    if (!last) throw new Error("Stripe customer history is unavailable.");
    startingAfter = last.id;
  }
  throw new Error("Stripe customer history exceeds the safe recovery limit.");
}

type HostedCustomerRecord = {
  id: string;
  customer: Stripe.Customer;
};

async function ensureHostedCustomerRecord(
  slug: string,
  options: { db?: BillingDatabaseContext; ownerEmail?: string } = {},
): Promise<HostedCustomerRecord | null> {
  if (isSingleMode()) return null;
  if (options.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.ownerEmail.trim())) {
    throw new Error("A stable owner email is required for hosted billing.");
  }

  const db = options.db ?? publicDb;
  const tenant = await loadTenant(slug, db);
  if (!tenant) return null;
  const stripe = getStripe();
  let customerId = tenant.platformStripeCustomerId;

  if (!customerId) {
    customerId = await findHostedCustomer(slug, stripe);
    if (!customerId) {
      try {
        customerId = (
          await stripe.customers.create(
            {
              name: tenant.name,
              metadata: { tenantSlug: slug, purpose: HOSTED_PLAN_PURPOSE },
            },
            {
              idempotencyKey: `hosted-customer:${slug}`,
              ...STRIPE_WRITE_OPTIONS,
            },
          )
        ).id;
      } catch (error) {
        // Recovery is bounded and happens on every failed create, including
        // retries after Stripe's 24-hour idempotency retention has expired.
        const recovered = await findHostedCustomerInList(slug, stripe);
        if (!recovered) throw error;
        customerId = recovered;
      }
    }
  }

  const customer = await retrieveHostedCustomer(
    slug,
    customerId,
    stripe,
    options.ownerEmail?.trim(),
  );
  if (tenant.platformStripeCustomerId !== customerId) {
    await db
      .update(tenants)
      .set({ platformStripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(tenants.slug, slug));
  }
  return { id: customerId, customer };
}

/** Find or create the platform customer shared by hosted billing operations. */
export async function ensureHostedCustomer(
  slug: string,
  options: { db?: BillingDatabaseContext; ownerEmail?: string } = {},
): Promise<string | null> {
  const record = await ensureHostedCustomerRecord(slug, options);
  return record?.id ?? null;
}

function hasExpiredCard(paymentMethod: Stripe.PaymentMethod): boolean {
  if (paymentMethod.type !== "card" || !paymentMethod.card) return false;
  const now = new Date();
  return (
    paymentMethod.card.exp_year < now.getUTCFullYear() ||
    (paymentMethod.card.exp_year === now.getUTCFullYear() &&
      paymentMethod.card.exp_month < now.getUTCMonth() + 1)
  );
}

async function customerHasUsableDefaultPaymentMethod(
  customerId: string,
  customer: Stripe.Customer,
  stripe: ReturnType<typeof getStripe>,
  subscription?: Stripe.Subscription,
): Promise<boolean> {
  const paymentMethodId =
    stripeId(subscription?.default_payment_method) ??
    stripeId(customer.invoice_settings?.default_payment_method);
  if (paymentMethodId) {
    const method = await stripe.paymentMethods.retrieve(
      paymentMethodId,
      {},
      STRIPE_READ_OPTIONS,
    );
    return (
      stripeId(method.customer) === customerId &&
      !hasExpiredCard(method)
    );
  }

  const sourceId =
    stripeId(subscription?.default_source) ?? stripeId(customer.default_source);
  if (!sourceId) return false;
  const source = (await stripe.customers.retrieveSource(
    customerId,
    sourceId,
    {},
    STRIPE_READ_OPTIONS,
  )) as unknown as {
    object?: string;
    status?: string;
    customer?: unknown;
    exp_month?: number;
    exp_year?: number;
  };
  if (stripeId(source.customer) !== customerId) return false;
  if (source.object === "card") {
    if (
      !Number.isInteger(source.exp_month) ||
      !Number.isInteger(source.exp_year) ||
      source.exp_month! < 1 ||
      source.exp_month! > 12
    ) {
      return false;
    }
    const now = new Date();
    return (
      source.exp_year! > now.getUTCFullYear() ||
      (source.exp_year === now.getUTCFullYear() &&
        source.exp_month! >= now.getUTCMonth() + 1)
    );
  }
  return source.status === "chargeable";
}

const TERMINAL_HOSTED_SUBSCRIPTION_STATES = new Set([
  "canceled",
  "incomplete_expired",
]);

function assertHostedSubscriptionBinding(
  subscription: Stripe.Subscription,
  slug: string,
  customerId: string,
): void {
  if (
    stripeId(subscription.customer) !== customerId ||
    subscription.metadata?.tenantSlug !== slug ||
    subscription.metadata?.purpose !== HOSTED_PLAN_PURPOSE
  ) {
    throw new EvidenceConflict("Hosted subscription ownership does not match its tenant.");
  }
}

/**
 * Search every bounded customer-history page before creating a subscription.
 * This also recovers creates whose response was lost more than 24 hours ago.
 */
async function findHostedSubscription(
  customerId: string,
  slug: string,
  stripe: ReturnType<typeof getStripe>,
): Promise<Stripe.Subscription | null> {
  let startingAfter: string | undefined;
  const matches: Stripe.Subscription[] = [];
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const page = await stripe.subscriptions.list(
      {
        customer: customerId,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      STRIPE_READ_OPTIONS,
    );
    for (const subscription of page.data) {
      if (
        subscription.metadata?.purpose === HOSTED_PLAN_PURPOSE &&
        subscription.metadata?.tenantSlug !== slug
      ) {
        throw new Error("Hosted subscription history contains another tenant binding.");
      }
      if (
        subscription.metadata?.tenantSlug === slug &&
        subscription.metadata?.purpose === HOSTED_PLAN_PURPOSE
      ) {
        assertHostedSubscriptionBinding(subscription, slug, customerId);
        matches.push(subscription);
      }
    }
    if (!page.has_more) break;
    const last = page.data.at(-1);
    if (!last) throw new Error("Stripe subscription history is unavailable.");
    startingAfter = last.id;
    if (pageNumber === 19) {
      throw new Error("Stripe subscription history exceeds the safe recovery limit.");
    }
  }

  const nonterminal = matches.filter(
    (subscription) =>
      !TERMINAL_HOSTED_SUBSCRIPTION_STATES.has(subscription.status),
  );
  if (nonterminal.length > 1) {
    throw new Error("Multiple hosted subscriptions require manual review.");
  }
  if (nonterminal.length === 1) {
    return retrieveHostedSubscription(
      nonterminal[0]!.id,
      slug,
      customerId,
      stripe,
    );
  }
  if (matches.length > 0) {
    throw new Error("Terminal hosted subscription history requires manual review.");
  }
  return null;
}

async function retrieveHostedSubscription(
  id: string,
  slug: string,
  customerId: string,
  stripe: ReturnType<typeof getStripe>,
): Promise<Stripe.Subscription> {
  const subscription = await retrieveHostedSubscriptionInventory(
    id,
    slug,
    customerId,
    stripe,
  );
  if (TERMINAL_HOSTED_SUBSCRIPTION_STATES.has(subscription.status)) {
    throw new Error("Terminal hosted subscription requires manual review.");
  }
  return subscription;
}

/** Ownership-checked subscription with its complete, paginated item inventory. */
export async function retrieveHostedSubscriptionInventory(
  id: string,
  slug: string,
  customerId: string,
  stripe: ReturnType<typeof getStripe> = getStripe(),
): Promise<Stripe.Subscription> {
  const subscription = await stripe.subscriptions.retrieve(
    id,
    {
      expand: [
        "items.data.price",
        "default_payment_method",
        "default_source",
      ],
    },
    STRIPE_READ_OPTIONS,
  );
  assertHostedSubscriptionBinding(subscription, slug, customerId);
  if (!subscription.items.has_more) return subscription;

  const items: Stripe.SubscriptionItem[] = [];
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const page = await stripe.subscriptionItems.list(
      {
        subscription: id,
        limit: 100,
        expand: ["data.price"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      STRIPE_READ_OPTIONS,
    );
    items.push(...page.data);
    if (!page.has_more) {
      return {
        ...subscription,
        items: { ...subscription.items, data: items, has_more: false },
      };
    }
    const last = page.data.at(-1);
    if (!last) throw new EvidenceConflict("Hosted subscription item history is unavailable.");
    startingAfter = last.id;
  }
  throw new EvidenceConflict("Hosted subscription items exceed the safe recovery limit.");
}

async function syncSubscriptionItems(
  slug: string,
  subscription: Stripe.Subscription,
  billableStaff: number,
  smsLineStatus: string | null,
  billingSwitched: boolean,
  stripe: ReturnType<typeof getStripe>,
): Promise<{ created: number; updated: number; removed: number }> {
  const current = new Map<string, CurrentItem>();
  const duplicates: Array<{ id: string; lookupKey: string }> = [];
  for (const item of subscription.items.data) {
    const key = item.price.lookup_key;
    // The meter is never created, updated, or removed here (see
    // hosted-text-lifecycle): Stripe rejects metered item writes while the
    // trial-end pause setting is retained.
    if (!key || key === HOSTED_TEXTS_METERED_LOOKUP_KEY) continue;
    if (current.has(key)) duplicates.push({ id: item.id, lookupKey: key });
    else current.set(key, { id: item.id, quantity: item.quantity });
  }

  const wanted = licensedItems({
    billableStaff,
    smsLineStatus,
    billingSwitched,
  });
  const plan = diffItems(current, wanted);
  const prices =
    plan.create.length > 0
      ? await resolvePriceIds(plan.create.map((item) => item.lookupKey))
      : new Map<string, string>();

  for (const item of plan.create) {
    await stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price: prices.get(item.lookupKey)!,
        ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
        proration_behavior: "none",
      },
      {
        idempotencyKey: `hosted-item:${subscription.id}:${item.lookupKey}`,
        ...STRIPE_WRITE_OPTIONS,
      },
    );
  }
  for (const item of plan.update) {
    await stripe.subscriptionItems.update(
      item.id,
      { quantity: item.quantity, proration_behavior: "none" },
      STRIPE_WRITE_OPTIONS,
    );
  }
  const removals = [...plan.remove, ...duplicates];
  for (const item of removals) {
    await stripe.subscriptionItems.del(
      item.id,
      { proration_behavior: "none" },
      STRIPE_WRITE_OPTIONS,
    );
  }
  return {
    created: plan.create.length,
    updated: plan.update.length,
    removed: removals.length,
  };
}

async function updateCollectionAndResume(
  slug: string,
  customerId: string,
  subscription: Stripe.Subscription,
  collection: "charge_automatically" | "send_invoice",
  stripe: ReturnType<typeof getStripe>,
): Promise<Stripe.Subscription> {
  const params: Stripe.SubscriptionUpdateParams = {
    collection_method: collection,
    proration_behavior: "none",
  };
  if (collection === "send_invoice") params.days_until_due = 14;
  if (subscription.status === "trialing") params.trial_end = "now";

  await stripe.subscriptions.update(
    subscription.id,
    params,
    STRIPE_WRITE_OPTIONS,
  );
  if (subscription.status === "paused") {
    await stripe.subscriptions.resume(
      subscription.id,
      {
        billing_cycle_anchor: "unchanged",
        proration_behavior: "none",
      },
      STRIPE_WRITE_OPTIONS,
    );
  }
  // A request acknowledgement is not proof of the resulting status.
  return retrieveHostedSubscription(subscription.id, slug, customerId, stripe);
}

async function syncExistingHostedSubscription(
  slug: string,
  tenant: NonNullable<Awaited<ReturnType<typeof loadTenant>>>,
  subscription: Stripe.Subscription,
  options: {
    billingSwitch?: boolean;
    collection?: "charge_automatically" | "send_invoice";
    customer?: Stripe.Customer;
    stripe: ReturnType<typeof getStripe>;
  },
): Promise<Stripe.Subscription> {
  if (!tenant.platformStripeCustomerId) {
    throw new Error("Hosted subscription has no recorded customer binding.");
  }
  assertHostedSubscriptionBinding(
    subscription,
    slug,
    tenant.platformStripeCustomerId,
  );
  if (TERMINAL_HOSTED_SUBSCRIPTION_STATES.has(subscription.status)) {
    throw new Error("Terminal hosted subscription requires manual review.");
  }

  await syncSubscriptionItems(
    slug,
    subscription,
    tenant.billableStaff,
    tenant.smsLineStatus,
    options.billingSwitch ?? tenant.billingSwitchedAt != null,
    options.stripe,
  );
  if (!options.billingSwitch) return subscription;

  const customer = options.customer ??
    await retrieveHostedCustomer(
      slug,
      tenant.platformStripeCustomerId,
      options.stripe,
    );
  const collection =
    options.collection ??
    ((await customerHasUsableDefaultPaymentMethod(
      tenant.platformStripeCustomerId,
      customer,
      options.stripe,
      subscription,
    ))
      ? "charge_automatically"
      : "send_invoice");
  return updateCollectionAndResume(
    slug,
    tenant.platformStripeCustomerId,
    subscription,
    collection,
    options.stripe,
  );
}

/** Create the hosted subscription for a business, once. */
export async function ensureHostedSubscription(
  slug: string,
  opts: HostedSubscriptionOptions,
): Promise<
  | { skipped: Exclude<SkipReason, "no_subscription"> }
  | { subscriptionId: string; status: string; textMeter?: TextMeterResult }
> {
  if (isSingleMode()) return { skipped: "single_mode" };
  const deferMeter = deferTextMeter(opts);
  const db = opts.db ?? publicDb;
  const tenant = await loadTenant(slug, db);
  if (!tenant) return { skipped: "no_tenant" };
  if (tenant.comped === 1) return { skipped: "comped" };
  if (opts.billingSwitch && !opts.ownerEmail) {
    throw new Error("A stable owner email is required before hosted billing switch.");
  }
  if (tenant.stripeSubscriptionId && !opts.billingSwitch) {
    return { skipped: "exists" };
  }
  // Existing tenants stay on their recorded terms until the 60-day notice
  // switch. New tenants receive billing_switched_at from the column default.
  if (opts.trialDays > 0 && tenant.billingSwitchedAt == null) {
    return { skipped: "awaiting_switch" };
  }

  const stripe = getStripe();
  const customerRecord = await ensureHostedCustomerRecord(slug, {
    db,
    ownerEmail: opts.ownerEmail,
  });
  if (!customerRecord) return { skipped: "no_tenant" };
  const customerId = customerRecord.id;
  let subscription = tenant.stripeSubscriptionId
    ? await retrieveHostedSubscription(
        tenant.stripeSubscriptionId,
        slug,
        customerId,
        stripe,
      )
    : await findHostedSubscription(customerId, slug, stripe);
  const paymentMethodExists = await customerHasUsableDefaultPaymentMethod(
    customerId,
    customerRecord.customer,
    stripe,
    subscription ?? undefined,
  );
  const collection = opts.billingSwitch
    ? paymentMethodExists
      ? "charge_automatically"
      : "send_invoice"
    : opts.collection ?? "charge_automatically";

  if (subscription) {
    subscription = await syncExistingHostedSubscription(
      slug,
      { ...tenant, platformStripeCustomerId: customerId },
      subscription,
      {
      billingSwitch: opts.billingSwitch,
      collection,
      customer: customerRecord.customer,
      stripe,
      },
    );
  } else {
    const trial = opts.trialDays > 0;
    const itemInput = {
      billableStaff: tenant.billableStaff,
      smsLineStatus: tenant.smsLineStatus,
      billingSwitched: opts.billingSwitch ?? tenant.billingSwitchedAt != null,
    };
    // Stripe rejects a metered item next to the trial-end pause setting, and a
    // deferred caller cannot record the meter operation. Both start licensed
    // only; the text lifecycle attaches the meter once billing is paid.
    const wanted = trial || deferMeter
      ? licensedItems(itemInput)
      : desiredItems(itemInput);
    const prices = await resolvePriceIds(wanted.map((item) => item.lookupKey));
    subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: wanted.map((item) => ({
          price: prices.get(item.lookupKey)!,
          ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
        })),
        metadata: { purpose: HOSTED_PLAN_PURPOSE, tenantSlug: slug },
        ...(trial
          ? {
              trial_period_days: opts.trialDays,
              trial_settings: {
                end_behavior: { missing_payment_method: "pause" as const },
              },
            }
          : {}),
        payment_settings: { save_default_payment_method: "on_subscription" },
        collection_method: collection,
        ...(collection === "send_invoice" ? { days_until_due: 14 } : {}),
      },
      {
        // v2: the item set and trial settings differ from the rejected v1 request.
        idempotencyKey: `hosted-sub-v2:${slug}`,
        ...STRIPE_WRITE_OPTIONS,
      },
    );
  }

  await db
    .update(tenants)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      updatedAt: new Date(),
    })
    .where(eq(tenants.slug, slug));

  const created = { subscriptionId: subscription.id, status: subscription.status };
  if (deferMeter) return created;
  return { ...created, textMeter: await reconcileHostedTextMeter(slug) };
}

/**
 * Bring the subscription's licensed items in line with desiredItems, then (in
 * the default reconcile mode) reconcile the metered texts item.
 */
export async function syncHostedSubscription(
  slug: string,
  opts: SubscriptionSyncOptions = {},
): Promise<
  | { skipped: SkipReason }
  | {
      created: number;
      updated: number;
      removed: number;
      textMeter?: TextMeterResult;
    }
> {
  if (isSingleMode()) return { skipped: "single_mode" };
  const deferMeter = deferTextMeter(opts);
  const tenant = await loadTenant(slug, opts.db ?? publicDb);
  if (!tenant) return { skipped: "no_tenant" };
  if (tenant.comped === 1) return { skipped: "comped" };
  if (!tenant.stripeSubscriptionId) return { skipped: "no_subscription" };

  if (!tenant.platformStripeCustomerId) {
    throw new Error("Hosted subscription has no recorded customer binding.");
  }
  const stripe = getStripe();
  const subscription = await retrieveHostedSubscription(
    tenant.stripeSubscriptionId,
    slug,
    tenant.platformStripeCustomerId,
    stripe,
  );
  const synced = await syncSubscriptionItems(
    slug,
    subscription,
    tenant.billableStaff,
    tenant.smsLineStatus,
    opts.billingSwitch ?? tenant.billingSwitchedAt != null,
    stripe,
  );
  if (deferMeter) return synced;
  return { ...synced, textMeter: await reconcileHostedTextMeter(slug) };
}
