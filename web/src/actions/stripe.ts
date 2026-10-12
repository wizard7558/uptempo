"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { getT } from "@/lib/terms/server";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlugForBookingClient } from "@/lib/tenant/registry";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getStripe } from "@/lib/stripe/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Create a Stripe SetupIntent for a client.
 * If the client has no Stripe Customer, one is created first.
 * Returns the clientSecret for the deferred intent flow.
 */
export async function createSetupIntent(clientId: string) {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    throw new Error("Unauthorized");
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    throw new Error((await getT("errors"))("stripe.noPlace"));
  }

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client) {
    throw new Error("Client not found");
  }

  let stripeCustomerId = client.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      email: client.email ?? undefined,
      phone: client.phone ?? undefined,
      metadata: { clientId, tenantSlug: slug },
    });
    stripeCustomerId = customer.id;
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(clients.id, clientId));
    });
  }

  const setupIntent = await getStripe().setupIntents.create({
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    usage: "off_session",
    metadata: { clientId, tenantSlug: slug },
  });

  trackEvent("stripe.setup_intent_created", { clientId }, { tenantSlug: slug });

  return { clientSecret: setupIntent.client_secret };
}

/**
 * Get the payment method info for a client.
 * Returns card details (last4, brand) if a card is saved.
 */
export async function getClientPaymentMethod(clientId: string) {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    return { hasCard: false as const };
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { hasCard: false as const };
  }

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        stripePaymentMethodId: clients.stripePaymentMethodId,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client?.stripePaymentMethodId) {
    return { hasCard: false as const };
  }

  try {
    const pm = await getStripe().paymentMethods.retrieve(
      client.stripePaymentMethodId,
    );
    return {
      hasCard: true as const,
      paymentMethodId: client.stripePaymentMethodId,
      last4: pm.card?.last4,
      brand: pm.card?.brand,
    };
  } catch {
    // Payment method no longer valid on Stripe side
    return { hasCard: false as const };
  }
}

/**
 * Remove a saved payment method from a client.
 * Detaches the payment method from the Stripe Customer and clears the client record.
 */
export async function removePaymentMethod(clientId: string) {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    return { success: false as const };
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { success: false as const };
  }

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        stripePaymentMethodId: clients.stripePaymentMethodId,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client?.stripePaymentMethodId) {
    return { success: true as const };
  }

  try {
    await getStripe().paymentMethods.detach(client.stripePaymentMethodId);
  } catch {
    // If detach fails (e.g., already detached), continue to clear local record
  }

  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ stripePaymentMethodId: null, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
  });

  trackEvent("stripe.payment_method_removed", { clientId }, { tenantSlug: slug });

  return { success: true as const };
}

/**
 * Admin-scoped: get the saved card details (brand + last4) for a client in the
 * current tenant. Returns `{ hasCard: false }` if none on file.
 */
export async function getClientCardForAdmin(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({ stripePaymentMethodId: clients.stripePaymentMethodId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client?.stripePaymentMethodId) {
    return { hasCard: false as const };
  }

  try {
    const pm = await getStripe().paymentMethods.retrieve(
      client.stripePaymentMethodId,
    );
    return {
      hasCard: true as const,
      paymentMethodId: client.stripePaymentMethodId,
      last4: pm.card?.last4 ?? null,
      brand: pm.card?.brand ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
    };
  } catch {
    return { hasCard: false as const };
  }
}

/**
 * Admin-scoped: create a SetupIntent for a client (creating a Stripe Customer
 * if the client doesn't have one yet). Returns the client secret for use with
 * Stripe Elements in the admin UI.
 */
export async function createClientSetupIntentForAdmin(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        id: clients.id,
        email: clients.email,
        phone: clients.phone,
        stripeCustomerId: clients.stripeCustomerId,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client) {
    return { success: false as const, error: "Client not found" };
  }

  let stripeCustomerId = client.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      email: client.email ?? undefined,
      phone: client.phone ?? undefined,
      metadata: { clientId, tenantSlug: slug },
    });
    stripeCustomerId = customer.id;
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(clients.id, clientId));
    });
  }

  const setupIntent = await getStripe().setupIntents.create({
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    usage: "off_session",
    metadata: { clientId, tenantSlug: slug, source: "admin" },
  });

  trackEvent(
    "stripe.setup_intent_created",
    { clientId, source: "admin" },
    { tenantSlug: slug },
  );

  return { success: true as const, clientSecret: setupIntent.client_secret };
}

/**
 * Admin-scoped: attach a confirmed PaymentMethod to the client record, replacing
 * any prior card on file (the prior PM is detached from Stripe).
 */
export async function attachClientPaymentMethodForAdmin(input: {
  clientId: string;
  paymentMethodId: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const { clientId, paymentMethodId } = input;
  if (!paymentMethodId.startsWith("pm_")) {
    return { success: false as const, error: "Invalid payment method" };
  }


  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        id: clients.id,
        stripePaymentMethodId: clients.stripePaymentMethodId,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client) {
    return { success: false as const, error: "Client not found" };
  }

  // Detach the prior PM (if any and different) so the customer doesn't accrue
  // dangling cards.
  if (
    client.stripePaymentMethodId &&
    client.stripePaymentMethodId !== paymentMethodId
  ) {
    try {
      await getStripe().paymentMethods.detach(client.stripePaymentMethodId);
    } catch {
      // Already detached or otherwise unrecoverable — proceed.
    }
  }

  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ stripePaymentMethodId: paymentMethodId, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
  });

  trackEvent(
    "stripe.payment_method_attached",
    { clientId, source: "admin" },
    { tenantSlug: slug },
  );

  revalidatePath(`/clients/${clientId}`);
  return { success: true as const };
}

/**
 * Admin-scoped: detach the client's saved card and clear the field.
 */
export async function removeClientCardForAdmin(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({ stripePaymentMethodId: clients.stripePaymentMethodId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });

  if (!client?.stripePaymentMethodId) {
    return { success: true as const };
  }

  try {
    await getStripe().paymentMethods.detach(client.stripePaymentMethodId);
  } catch {
    // Continue and clear the local record even if detach failed.
  }

  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ stripePaymentMethodId: null, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
  });

  trackEvent(
    "stripe.payment_method_removed",
    { clientId, source: "admin" },
    { tenantSlug: slug },
  );

  revalidatePath(`/clients/${clientId}`);
  return { success: true as const };
}
