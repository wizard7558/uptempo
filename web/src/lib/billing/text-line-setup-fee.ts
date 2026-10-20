import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { publicDb } from "@/lib/db";
import { tenants, type SmsRegistrationState } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe/server";

const SETUP_FEE_KEY_PREFIX = "text-line-setup-fee:";
const SETUP_FEE_LEASE_MS = 10 * 60_000;
const SETUP_FEE_METADATA_PURPOSE = "text_line_setup_fee";
// 20 sequential requests × 5 seconds stays well inside the durable fee lease.
const RECOVERY_PAGE_LIMIT = 20;
const RECOVERY_REQUEST_OPTIONS = {
  timeout: 5_000,
  maxNetworkRetries: 0,
} as const;

export interface SetupFeeTenant {
  slug: string;
  name: string;
  comped: number;
  smsLineStatus: string;
  smsRegistration: SmsRegistrationState | null;
  platformStripeCustomerId: string | null;
}

export interface SetupFeeRepository {
  load(slug: string): Promise<SetupFeeTenant | null>;
  claim(
    slug: string,
    lease: { token: string; expiresAt: string },
  ): Promise<boolean>;
  save(
    slug: string,
    token: string,
    registration: SmsRegistrationState,
    customerId?: string,
  ): Promise<boolean>;
  release(slug: string, token: string): Promise<void>;
}

export interface SetupFeeStripe {
  invoiceItems: Pick<Stripe.InvoiceItemsResource, "list" | "create">;
}

export type SetupFeeResult =
  | { ok: true; status: "added" | "waived" | "already_added" }
  | { ok: false; error: "setup_fee_busy" | "setup_fee_unavailable" };

function quoteSqlLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

const databaseRepository: SetupFeeRepository = {
  async load(slug) {
    const [row] = await publicDb
      .select({
        slug: tenants.slug,
        name: tenants.name,
        comped: tenants.comped,
        smsLineStatus: tenants.smsLineStatus,
        smsRegistration: tenants.smsRegistration,
        platformStripeCustomerId: tenants.platformStripeCustomerId,
      })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    return row ?? null;
  },
  async claim(slug, lease) {
    const leaseJson = JSON.stringify(lease);
    const now = new Date().toISOString();
    const [row] = await publicDb
      .update(tenants)
      .set({
        smsRegistration: sql.raw(
          "jsonb_set(coalesce(sms_registration, '{}'::jsonb), '{setupFeeLease}', " +
            quoteSqlLiteral(leaseJson) +
            "::jsonb, true)",
        ),
      })
      .where(
        and(
          eq(tenants.slug, slug),
          sql.raw(
            "(sms_registration->'setupFeeLease' IS NULL OR " +
              "(sms_registration->'setupFeeLease'->>'expiresAt')::timestamptz < " +
              quoteSqlLiteral(now) +
              "::timestamptz)",
          ),
        ),
      )
      .returning({ slug: tenants.slug });
    return Boolean(row);
  },
  async save(slug, token, registration, customerId) {
    const [row] = await publicDb
      .update(tenants)
      .set({
        smsRegistration: registration,
        ...(customerId ? { platformStripeCustomerId: customerId } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenants.slug, slug),
          sql.raw(
            "sms_registration->'setupFeeLease'->>'token' = " +
              quoteSqlLiteral(token),
          ),
        ),
      )
      .returning({ slug: tenants.slug });
    return Boolean(row);
  },
  async release(slug, token) {
    await publicDb
      .update(tenants)
      .set({
        smsRegistration: sql.raw("sms_registration - 'setupFeeLease'"),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenants.slug, slug),
          sql.raw(
            "sms_registration->'setupFeeLease'->>'token' = " +
              quoteSqlLiteral(token),
          ),
        ),
      );
  },
};

function isFeeExempt(
  tenant: SetupFeeTenant,
  state: SmsRegistrationState,
): boolean {
  return (
    tenant.comped === 1 ||
    tenant.smsLineStatus === "shared" ||
    state.startedFromShared === true ||
    state.setupFeeEligible === false ||
    state.setupFeeWaived === true
  );
}

function fakeInvoiceItemId(slug: string): string {
  return (
    "ii_fake_" + createHash("sha256").update(slug).digest("hex").slice(0, 24)
  );
}

async function findSetupFeeInvoiceItem(
  stripe: SetupFeeStripe,
  customerId: string,
  slug: string,
): Promise<string | null> {
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < RECOVERY_PAGE_LIMIT; pageNumber++) {
    const page = await stripe.invoiceItems.list(
      {
        customer: customerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      RECOVERY_REQUEST_OPTIONS,
    );
    const match = page.data.find(
      (item) =>
        item.metadata?.tenantSlug === slug &&
        item.metadata?.purpose === SETUP_FEE_METADATA_PURPOSE &&
        item.metadata?.feeKey === SETUP_FEE_KEY_PREFIX + slug,
    );
    if (match) return match.id;
    if (!page.has_more) return null;
    const last = page.data.at(-1);
    if (!last) throw new Error("stripe_invoice_item_history_unavailable");
    startingAfter = last.id;
  }
  // Fail closed if the item might be older than the bounded recovery scan.
  throw new Error("stripe_invoice_item_history_limit");
}

/**
 * Idempotently adds the one-time setup fee to the next invoice. The durable
 * tenant marker and lease cover retries beyond Stripe's idempotency window;
 * Stripe metadata recovers the invoice item if its creation response was lost.
 */
export async function ensureTextLineSetupFeeWithDeps(
  slug: string,
  deps: {
    repository: SetupFeeRepository;
    stripe: SetupFeeStripe | null;
    getStripe?: () => SetupFeeStripe;
    ensureCustomer?: (slug: string) => Promise<string | null>;
    useFakePayments?: boolean;
    now?: () => Date;
  },
): Promise<SetupFeeResult> {
  const initial = await deps.repository.load(slug);
  if (!initial) return { ok: false, error: "setup_fee_unavailable" };
  const initialState = initial.smsRegistration ?? {};
  if (initialState.setupFeeInvoiceItemId) {
    return { ok: true, status: "already_added" };
  }
  if (initialState.setupFeeWaived || initialState.setupFeeState === "waived") {
    return { ok: true, status: "waived" };
  }

  const now = deps.now ?? (() => new Date());
  const lease = {
    token: randomUUID(),
    expiresAt: new Date(now().getTime() + SETUP_FEE_LEASE_MS).toISOString(),
  };
  if (!(await deps.repository.claim(slug, lease))) {
    return { ok: false, error: "setup_fee_busy" };
  }

  try {
    const tenant = await deps.repository.load(slug);
    if (!tenant) return { ok: false, error: "setup_fee_unavailable" };
    const state = { ...(tenant.smsRegistration ?? {}), setupFeeLease: lease };
    if (state.setupFeeInvoiceItemId) {
      return { ok: true, status: "already_added" };
    }
    if (state.setupFeeWaived || state.setupFeeState === "waived") {
      return { ok: true, status: "waived" };
    }

    if (isFeeExempt(tenant, state)) {
      const waived: SmsRegistrationState = {
        ...state,
        setupFeeEligible: false,
        setupFeeWaived: true,
        setupFeeState: "waived",
      };
      if (!(await deps.repository.save(slug, lease.token, waived))) {
        return { ok: false, error: "setup_fee_unavailable" };
      }
      return { ok: true, status: "waived" };
    }

    const eligible: SmsRegistrationState = {
      ...state,
      setupFeeEligible: true,
      setupFeeWaived: false,
    };
    if (!(await deps.repository.save(slug, lease.token, eligible))) {
      return { ok: false, error: "setup_fee_unavailable" };
    }

    let invoiceItemId: string;
    let customerId = tenant.platformStripeCustomerId ?? undefined;
    if (deps.useFakePayments) {
      invoiceItemId = fakeInvoiceItemId(slug);
    } else {
      const stripe = deps.stripe ?? deps.getStripe?.() ?? null;
      if (!stripe) return { ok: false, error: "setup_fee_unavailable" };
      customerId =
        tenant.platformStripeCustomerId ??
        (await deps.ensureCustomer?.(slug)) ??
        undefined;
      if (!customerId) return { ok: false, error: "setup_fee_unavailable" };
      if (
        !tenant.platformStripeCustomerId &&
        !(await deps.repository.save(slug, lease.token, eligible, customerId))
      ) {
        return { ok: false, error: "setup_fee_unavailable" };
      }

      invoiceItemId =
        (await findSetupFeeInvoiceItem(stripe, customerId, slug)) ??
        (
          await stripe.invoiceItems.create(
            {
              customer: customerId,
              amount: 1900,
              currency: "usd",
              description: "Text line registration setup",
              metadata: {
                tenantSlug: slug,
                purpose: SETUP_FEE_METADATA_PURPOSE,
                feeKey: SETUP_FEE_KEY_PREFIX + slug,
              },
            },
            {
              idempotencyKey: SETUP_FEE_KEY_PREFIX + slug,
              timeout: 30_000,
              maxNetworkRetries: 0,
            },
          )
        ).id;
    }

    const added: SmsRegistrationState = {
      ...eligible,
      setupFeeState: "added",
      setupFeeInvoiceItemId: invoiceItemId,
    };
    if (!(await deps.repository.save(slug, lease.token, added, customerId))) {
      return { ok: false, error: "setup_fee_unavailable" };
    }
    return { ok: true, status: "added" };
  } catch {
    // Provider errors may contain request details. Return only a stable code.
    return { ok: false, error: "setup_fee_unavailable" };
  } finally {
    try {
      await deps.repository.release(slug, lease.token);
    } catch {
      // The bounded lease expiry is the recovery path if cleanup fails.
    }
  }
}

export async function ensureTextLineSetupFee(
  slug: string,
): Promise<SetupFeeResult> {
  const useFakePayments =
    process.env.PAYMENTS_FAKE === "1" && process.env.NODE_ENV !== "production";
  try {
    return await ensureTextLineSetupFeeWithDeps(slug, {
      repository: databaseRepository,
      stripe: null,
      ...(!useFakePayments
        ? { getStripe: () => getStripe() as unknown as SetupFeeStripe }
        : {}),
      ensureCustomer: async (tenantSlug) => {
        const billing = await import("@/lib/billing/subscriptions");
        return billing.ensureHostedCustomer(tenantSlug);
      },
      useFakePayments,
    });
  } catch {
    return { ok: false, error: "setup_fee_unavailable" };
  }
}
