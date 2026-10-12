"use server";

import { and, eq } from "drizzle-orm";
import {
  getBookingSession,
  clearBookingSession,
} from "@/lib/booking/session-cookie";
import { getTenantSlugForBookingClient } from "@/lib/tenant/registry";
import { withTenantDb } from "@/lib/db/tenant";
import { getStripe } from "@/lib/stripe/server";

/**
 * Self-serve deletion of the signed-in booking client's account.
 *
 * Required for App Store compliance (Apple Guideline 5.1.1(v): apps that let
 * users create an account must let them delete it in-app).
 *
 * Strategy: stop all future billing, detach payment data from Stripe, then
 * anonymize the client record rather than hard-deleting it — appointment and
 * charge history reference the client row and must stay referentially intact
 * for the salon's financial records. After this runs there is no PII left and
 * the session is cleared.
 */
export async function deleteMyClientAccount(): Promise<
  { success: true } | { success: false; error: string }
> {
  const clientId = await getBookingSession();
  if (!clientId) {
    return { success: false, error: "You are not signed in." };
  }

  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    // No resolvable salon for this client — nothing to delete; just sign out.
    await clearBookingSession();
    return { success: true };
  }

  try {
    // 1) Cancel any non-cancelled membership subscription so billing stops.
    const memberships = await withTenantDb(
      slug,
      async (db, { clientMemberships }) =>
        db
          .select({
            id: clientMemberships.id,
            status: clientMemberships.status,
            stripeSubscriptionId: clientMemberships.stripeSubscriptionId,
          })
          .from(clientMemberships)
          .where(eq(clientMemberships.clientId, clientId)),
    );

    for (const m of memberships) {
      if (m.status !== "cancelled" && m.stripeSubscriptionId) {
        try {
          await getStripe().subscriptions.cancel(m.stripeSubscriptionId);
        } catch {
          // Already cancelled / not found — proceed to mark it locally.
        }
      }
    }

    // 2) Detach the saved payment method from Stripe.
    const [client] = await withTenantDb(slug, async (db, { clients }) =>
      db
        .select({
          stripePaymentMethodId: clients.stripePaymentMethodId,
        })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1),
    );

    if (client?.stripePaymentMethodId) {
      try {
        await getStripe().paymentMethods.detach(client.stripePaymentMethodId);
      } catch {
        // If detach fails (already detached) continue clearing local data.
      }
    }

    // 3) Anonymize the client row + mark memberships cancelled.
    await withTenantDb(slug, async (db, { clients, clientMemberships }) => {
      await db
        .update(clients)
        .set({
          name: "Deleted client",
          email: null,
          phone: null,
          notes: null,
          stripeCustomerId: null,
          stripePaymentMethodId: null,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId));

      await db
        .update(clientMemberships)
        .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(clientMemberships.clientId, clientId),
            // Leave already-cancelled rows untouched.
            eq(clientMemberships.status, "active"),
          ),
        );
    });

    await clearBookingSession();
    return { success: true };
  } catch (error) {
    console.error("[Account] deleteMyClientAccount failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to delete account";
    return { success: false, error: message };
  }
}
