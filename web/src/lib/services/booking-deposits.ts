import { withTenantDb } from "@/lib/db/tenant";
import { destinationRefundParams } from "@/lib/stripe/refund-params";
import { getMultiServiceDuration } from "@/lib/services/duration";
import { resolveBookingDeposit, type DepositPolicy } from "@/lib/services/deposits";
import { processOffSessionCharge } from "@/lib/services/charge-processing";
import { getStripe } from "@/lib/stripe/server";
import { eq, and } from "drizzle-orm";

async function getDepositPolicy(slug: string): Promise<DepositPolicy> {
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [p] = await db
      .select({
        depositEnabled: businessSettings.depositEnabled,
        depositDefaultType: businessSettings.depositDefaultType,
        depositDefaultAmount: businessSettings.depositDefaultAmount,
        depositDurationThresholdMinutes:
          businessSettings.depositDurationThresholdMinutes,
      })
      .from(businessSettings)
      .limit(1);
    return {
      depositEnabled: (p?.depositEnabled ?? 0) === 1,
      depositDefaultType:
        (p?.depositDefaultType as "percent" | "fixed") ?? "percent",
      depositDefaultAmount: p?.depositDefaultAmount ?? 0,
      depositDurationThresholdMinutes:
        p?.depositDurationThresholdMinutes ?? null,
    };
  });
}

export interface BookingDepositPreview {
  enabled: boolean;
  totalCents: number;
  lines: { serviceId: string; serviceName: string; depositCents: number }[];
}

export async function previewBookingDepositForTenant(
  slug: string,
  serviceIds: string[],
  clientId: string | null,
  staffId: string | null = null,
): Promise<BookingDepositPreview> {
  if (serviceIds.length === 0) {
    return { enabled: false, totalCents: 0, lines: [] };
  }
  const [resolved, policy] = await Promise.all([
    getMultiServiceDuration(serviceIds, clientId, staffId),
    getDepositPolicy(slug),
  ]);
  const breakdown = resolveBookingDeposit(
    resolved.services.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      priceCents: s.priceCents,
      durationMinutes: s.durationMinutes,
      depositType: s.depositType,
      depositAmount: s.depositAmount,
    })),
    policy,
  );
  return { enabled: true, ...breakdown };
}

async function getClientStripeIds(slug: string, clientId: string) {
  return withTenantDb(slug, async (db, { clients }) => {
    const [c] = await db
      .select({
        stripeCustomerId: clients.stripeCustomerId,
        stripePaymentMethodId: clients.stripePaymentMethodId,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    return c ?? null;
  });
}

export interface DepositChargeOutcome {
  charged: boolean;
  reason?: "no_deposit" | "no_card" | "already_charged" | "failed";
  status?: "completed" | "failed" | "pending";
  amountCents?: number;
}

export async function chargeBookingDepositForTenant(
  slug: string,
  appointmentId: string,
): Promise<DepositChargeOutcome> {
  const appt = await withTenantDb(slug, async (db, { appointments }) => {
    const [a] = await db
      .select({
        id: appointments.id,
        clientId: appointments.clientId,
        depositCents: appointments.depositCents,
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    return a ?? null;
  });
  if (!appt || appt.depositCents <= 0) {
    return { charged: false, reason: "no_deposit" };
  }

  // Idempotency: skip if a deposit charge is already in flight / done.
  const existing = await withTenantDb(slug, async (db, { charges }) => {
    return db
      .select({ id: charges.id, status: charges.status })
      .from(charges)
      .where(
        and(eq(charges.appointmentId, appointmentId), eq(charges.reason, "deposit")),
      );
  });
  if (existing.some((c) => c.status === "completed" || c.status === "pending")) {
    return { charged: true, reason: "already_charged", status: "completed" };
  }

  const stripeIds = await getClientStripeIds(slug, appt.clientId);
  if (!stripeIds?.stripeCustomerId || !stripeIds?.stripePaymentMethodId) {
    return { charged: false, reason: "no_card" };
  }

  const { getConnectChargeParams } = await import("@/lib/stripe/connect-charge-params");
  const connectParams = await getConnectChargeParams(slug, appt.depositCents);

  const chargeResult = await processOffSessionCharge({
    amountCents: appt.depositCents,
    stripeCustomerId: stripeIds.stripeCustomerId,
    stripePaymentMethodId: stripeIds.stripePaymentMethodId,
    metadata: {
      appointmentId,
      reason: "deposit",
      clientId: appt.clientId,
      tenantSlug: slug,
    },
    ...(connectParams
      ? {
          connectAccountId: connectParams.connectAccountId,
          platformFeeCents: connectParams.platformFeeCents,
        }
      : {}),
  });

  await withTenantDb(slug, async (db, { charges }) => {
    await db.insert(charges).values({
      appointmentId,
      clientId: appt.clientId,
      stripePaymentIntentId: chargeResult.stripePaymentIntentId,
      amountCents: appt.depositCents,
      reason: "deposit",
      status: chargeResult.status,
      failureReason: chargeResult.failureReason,
      platformFeeCents: connectParams?.platformFeeCents ?? null,
      connectAccountId: connectParams?.connectAccountId ?? null,
    });
  });

  return {
    charged: chargeResult.status === "completed",
    status: chargeResult.status,
    amountCents: appt.depositCents,
  };
}

export async function refundBookingDepositForTenant(
  slug: string,
  appointmentId: string,
): Promise<{ refunded: boolean; amountCents?: number }> {
  const rows = await withTenantDb(slug, async (db, { charges }) => {
    return db
      .select({
        id: charges.id,
        stripePaymentIntentId: charges.stripePaymentIntentId,
        amountCents: charges.amountCents,
        status: charges.status,
        connectAccountId: charges.connectAccountId,
      })
      .from(charges)
      .where(
        and(eq(charges.appointmentId, appointmentId), eq(charges.reason, "deposit")),
      );
  });
  const completed = rows.find(
    (c) => c.status === "completed" && c.stripePaymentIntentId,
  );
  if (!completed) return { refunded: false };

  try {
    const refund = await getStripe().refunds.create({
      payment_intent: completed.stripePaymentIntentId!,
      ...destinationRefundParams(completed.connectAccountId),
    });
    await withTenantDb(slug, async (db, { charges }) => {
      await db
        .update(charges)
        .set({
          status: "refunded",
          stripeRefundId: refund.id,
          updatedAt: new Date(),
        })
        .where(eq(charges.id, completed.id));
    });
    return { refunded: true, amountCents: completed.amountCents };
  } catch (err) {
    console.error("[Deposit] Refund failed for appointment:", appointmentId, err);
    return { refunded: false };
  }
}
