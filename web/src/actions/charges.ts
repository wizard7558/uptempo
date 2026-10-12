"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { getT } from "@/lib/terms/server";
import { getEmailT } from "@/lib/terms/email";
import { withTenantDb } from "@/lib/db/tenant";
import { getStripe } from "@/lib/stripe/server";
import {
  calculateFee,
  calculateAppointmentPrice,
  isWithinCancellationWindow,
} from "@/lib/services/policy-engine";
import { processOffSessionCharge } from "@/lib/services/charge-processing";
import { creditStoredValueIdempotent } from "@/lib/services/stored-value-ledger";
import { getAppointment, cancelBooking } from "@/actions/appointments";
import { getBusinessSettings } from "@/actions/policies";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { sendEmail } from "@/lib/email/send";

async function getAppointmentServicePrices(appointmentId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { appointmentServices, services }) => {
    return db
      .select({
        priceChargedCents: appointmentServices.priceChargedCents,
        priceCents: services.priceCents,
      })
      .from(appointmentServices)
      .innerJoin(services, eq(appointmentServices.serviceId, services.id))
      .where(eq(appointmentServices.appointmentId, appointmentId));
  });
}

async function getClientStripeIds(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();
  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        stripeCustomerId: clients.stripeCustomerId,
        stripePaymentMethodId: clients.stripePaymentMethodId,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
  });
  return client;
}

async function sendChargeEmail(
  clientEmail: string | null,
  clientName: string,
  feeCents: number,
  reason: "no_show" | "late_cancellation",
  appointmentStart: Date,
) {
  const { tenantSlug: slug } = await requireStaff();
  if (!clientEmail) return;

  try {
    const reasonLabel =
      reason === "no_show" ? "no-show fee" : "late cancellation fee";
    const emailT = await getEmailT(slug, "emails");
    const policyNote =
      reason === "no_show"
        ? emailT("charges.noShowPolicy")
        : emailT("charges.cancellationPolicy");

    await sendEmail({
      to: clientEmail,
      subject: "Charge notification",
      html: `<p>Hi ${clientName},</p><p>A <strong>${reasonLabel}</strong> of <strong>$${(feeCents / 100).toFixed(2)}</strong> has been charged to your card on file for your appointment on ${appointmentStart.toLocaleDateString()}.</p><p>${policyNote}</p><p>${emailT("charges.contactDirectly")}</p>`,
    });
  } catch {
    // Email failure should not fail the charge action
  }
}

export async function chargeNoShowFee(appointmentId: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {
    const appointment = await getAppointment(appointmentId);
    if (!appointment) {
      return { success: false as const, error: "Appointment not found" };
    }
    if (appointment.status === "cancelled") {
      return {
        success: false as const,
        error: "Cannot charge no-show fee for a cancelled appointment",
      };
    }

    const policy = await getBusinessSettings();
    const apptServices = await getAppointmentServicePrices(appointmentId);
    const totalPrice = calculateAppointmentPrice(apptServices);
    const fee = calculateFee(totalPrice, policy.noShowFeePercent, "no_show");

    if (fee.feeCents <= 0) {
      // Update appointment status to no_show even with $0 fee
      await withTenantDb(slug, async (db, { appointments }) => {
        await db
          .update(appointments)
          .set({ status: "no_show", updatedAt: new Date() })
          .where(eq(appointments.id, appointmentId));
      });
      revalidatePath("/schedule");
      return { success: true as const, waived: true, reason: "Fee is $0" };
    }

    const clientStripe = await getClientStripeIds(appointment.client.id);
    if (
      !clientStripe?.stripeCustomerId ||
      !clientStripe?.stripePaymentMethodId
    ) {
      // Still mark as no-show even without card
      await withTenantDb(slug, async (db, { appointments }) => {
        await db
          .update(appointments)
          .set({ status: "no_show", updatedAt: new Date() })
          .where(eq(appointments.id, appointmentId));
      });
      revalidatePath("/schedule");
      return {
        success: false as const,
        error: "No payment method on file",
        markedNoShow: true,
      };
    }

    const { getConnectChargeParams } = await import("@/lib/stripe/connect-charge-params");
    const connectParams = await getConnectChargeParams(slug, fee.feeCents);

    const chargeResult = await processOffSessionCharge({
      amountCents: fee.feeCents,
      stripeCustomerId: clientStripe.stripeCustomerId,
      stripePaymentMethodId: clientStripe.stripePaymentMethodId,
      metadata: {
        appointmentId,
        reason: "no_show",
        clientId: appointment.client.id,
        tenantSlug: slug,
      },
      ...(connectParams
        ? {
            connectAccountId: connectParams.connectAccountId,
            platformFeeCents: connectParams.platformFeeCents,
          }
        : {}),
    });

    const [charge] = await withTenantDb(slug, async (db, { charges, appointments }) => {
      const [chargeRow] = await db
        .insert(charges)
        .values({
          appointmentId,
          clientId: appointment.client.id,
          stripePaymentIntentId: chargeResult.stripePaymentIntentId,
          amountCents: fee.feeCents,
          reason: "no_show",
          status: chargeResult.status,
          failureReason: chargeResult.failureReason,
          platformFeeCents: connectParams?.platformFeeCents ?? null,
          connectAccountId: connectParams?.connectAccountId ?? null,
        })
        .returning({ id: charges.id });

      // Update appointment status to no_show
      await db
        .update(appointments)
        .set({ status: "no_show", updatedAt: new Date() })
        .where(eq(appointments.id, appointmentId));

      return [chargeRow];
    });

    // Send email notification on successful charge
    if (chargeResult.status === "completed") {
      trackEvent("charge.created", { chargeId: charge.id, reason: "no_show", amountCents: fee.feeCents, appointmentId }, { tenantSlug: slug });
      await sendChargeEmail(
        appointment.client.email,
        appointment.client.name,
        fee.feeCents,
        "no_show",
        appointment.start,
      );
    } else if (chargeResult.status === "failed") {
      trackEvent("charge.failed", { chargeId: charge.id, reason: "no_show", amountCents: fee.feeCents, appointmentId }, { tenantSlug: slug });
    }

    revalidatePath("/schedule");
    revalidatePath("/charges");

    return {
      success: true as const,
      chargeId: charge.id,
      amountCents: fee.feeCents,
      status: chargeResult.status,
    };
  } catch {
    return {
      success: false as const,
      error: "Failed to charge no-show fee",
    };
  }
}

export async function chargeCancellationFee(appointmentId: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {
    const appointment = await getAppointment(appointmentId);
    if (!appointment) {
      return { success: false as const, error: "Appointment not found" };
    }

    const policy = await getBusinessSettings();

    if (
      !isWithinCancellationWindow(
        appointment.start,
        policy.cancellationWindowHours,
      )
    ) {
      return {
        success: true as const,
        feeCharged: false,
        reason: "Outside cancellation window",
      };
    }

    const apptServices = await getAppointmentServicePrices(appointmentId);
    const totalPrice = calculateAppointmentPrice(apptServices);
    const fee = calculateFee(
      totalPrice,
      policy.cancellationFeePercent,
      "late_cancellation",
    );

    if (fee.feeCents <= 0) {
      await cancelBooking({ appointmentId });
      return {
        success: true as const,
        feeCharged: false,
        reason: "Fee is $0",
      };
    }

    const clientStripe = await getClientStripeIds(appointment.client.id);
    if (
      !clientStripe?.stripeCustomerId ||
      !clientStripe?.stripePaymentMethodId
    ) {
      // Still cancel but note no card on file
      await cancelBooking({ appointmentId });
      return {
        success: true as const,
        feeCharged: false,
        reason: "No payment method on file",
      };
    }

    const { getConnectChargeParams } = await import("@/lib/stripe/connect-charge-params");
    const connectParams = await getConnectChargeParams(slug, fee.feeCents);

    const chargeResult = await processOffSessionCharge({
      amountCents: fee.feeCents,
      stripeCustomerId: clientStripe.stripeCustomerId,
      stripePaymentMethodId: clientStripe.stripePaymentMethodId,
      metadata: {
        appointmentId,
        reason: "late_cancellation",
        clientId: appointment.client.id,
        tenantSlug: slug,
      },
      ...(connectParams
        ? {
            connectAccountId: connectParams.connectAccountId,
            platformFeeCents: connectParams.platformFeeCents,
          }
        : {}),
    });

    const [charge] = await withTenantDb(slug, async (db, { charges }) => {
      return db
        .insert(charges)
        .values({
          appointmentId,
          clientId: appointment.client.id,
          stripePaymentIntentId: chargeResult.stripePaymentIntentId,
          amountCents: fee.feeCents,
          reason: "late_cancellation",
          status: chargeResult.status,
          failureReason: chargeResult.failureReason,
          platformFeeCents: connectParams?.platformFeeCents ?? null,
          connectAccountId: connectParams?.connectAccountId ?? null,
        })
        .returning({ id: charges.id });
    });

    // Cancel the appointment
    await cancelBooking({ appointmentId });

    // Send email notification on successful charge
    if (chargeResult.status === "completed") {
      trackEvent("charge.created", { chargeId: charge.id, reason: "late_cancellation", amountCents: fee.feeCents, appointmentId }, { tenantSlug: slug });
      await sendChargeEmail(
        appointment.client.email,
        appointment.client.name,
        fee.feeCents,
        "late_cancellation",
        appointment.start,
      );
    } else if (chargeResult.status === "failed") {
      trackEvent("charge.failed", { chargeId: charge.id, reason: "late_cancellation", amountCents: fee.feeCents, appointmentId }, { tenantSlug: slug });
    }

    revalidatePath("/schedule");
    revalidatePath("/charges");

    return {
      success: true as const,
      feeCharged: true,
      chargeId: charge.id,
      amountCents: fee.feeCents,
      status: chargeResult.status,
    };
  } catch {
    return {
      success: false as const,
      error: "Failed to charge cancellation fee",
    };
  }
}

export async function waiveCharge(chargeId: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {

    const [charge] = await withTenantDb(slug, async (db, { charges }) => {
      return db
        .select()
        .from(charges)
        .where(eq(charges.id, chargeId))
        .limit(1);
    });

    if (!charge) {
      return { success: false as const, error: "Charge not found" };
    }

    if (charge.status !== "pending" && charge.status !== "completed") {
      return {
        success: false as const,
        error: "Can only waive pending or completed charges",
      };
    }

    let stripeRefundId: string | null = null;

    // If completed and has a Stripe payment, refund it
    if (charge.status === "completed" && charge.stripePaymentIntentId) {
      const refund = await getStripe().refunds.create({
        payment_intent: charge.stripePaymentIntentId,
      });
      stripeRefundId = refund.id;
    }

    await withTenantDb(slug, async (db, { charges }) => {
      await db
        .update(charges)
        .set({
          status: "waived",
          stripeRefundId,
          updatedAt: new Date(),
        })
        .where(eq(charges.id, chargeId));
    });

    trackEvent("charge.waived", { chargeId, hadStripeRefund: !!stripeRefundId }, { tenantSlug: slug });

    revalidatePath("/charges");
    revalidatePath("/schedule");

    return { success: true as const };
  } catch {
    return { success: false as const, error: "Failed to waive charge" };
  }
}

export async function refundCharge(chargeId: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {

    const [charge] = await withTenantDb(slug, async (db, { charges }) => {
      return db
        .select()
        .from(charges)
        .where(eq(charges.id, chargeId))
        .limit(1);
    });

    if (!charge) {
      return { success: false as const, error: "Charge not found" };
    }

    if (charge.status !== "completed") {
      return {
        success: false as const,
        error: "Can only refund completed charges",
      };
    }

    const bbCents = charge.storedValueCents ?? 0;
    if (!charge.stripePaymentIntentId && bbCents <= 0) {
      return {
        success: false as const,
        error: "No payment to refund",
      };
    }

    // Refund the card portion (if any) via Stripe.
    let refundId: string | null = null;
    if (charge.stripePaymentIntentId) {
      const refund = await getStripe().refunds.create({
        payment_intent: charge.stripePaymentIntentId,
        reason: "requested_by_customer",
      });
      refundId = refund.id;
    }

    const refundNote =
      bbCents > 0
        ? (await getT("errors", slug))("charges.refundLedgerNote")
        : "";

    // Credit any Beauty Bank portion back to the client, then mark refunded —
    // in one transaction. Idempotent on the charge id so re-refunding is a no-op.
    await withTenantDb(slug, async (db, tables) => {
      await db.transaction(async (tx) => {
        if (bbCents > 0) {
          await creditStoredValueIdempotent(tx, tables, {
            clientId: charge.clientId,
            type: "refund_credit",
            amountCents: bbCents,
            referenceId: chargeId,
            note: refundNote,
          });
        }
        await tx
          .update(tables.charges)
          .set({
            status: "refunded",
            stripeRefundId: refundId,
            updatedAt: new Date(),
          })
          .where(eq(tables.charges.id, chargeId));
      });
    });

    trackEvent(
      "charge.refunded",
      { chargeId, refundId, storedValueReturnedCents: bbCents },
      { tenantSlug: slug },
    );

    revalidatePath("/charges");
    revalidatePath("/schedule");

    return { success: true as const, refundId };
  } catch {
    return { success: false as const, error: "Failed to refund charge" };
  }
}

export async function getChargesForAppointment(appointmentId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { charges }) => {
    return db
      .select({
        id: charges.id,
        amountCents: charges.amountCents,
        reason: charges.reason,
        status: charges.status,
        failureReason: charges.failureReason,
        createdAt: charges.createdAt,
      })
      .from(charges)
      .where(eq(charges.appointmentId, appointmentId))
      .orderBy(desc(charges.createdAt));
  });
}

export async function getChargeLog(
  options?: { limit?: number; offset?: number },
) {
  const { tenantSlug: slug } = await requireStaff();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return withTenantDb(slug, async (db, { charges, clients }) => {
    return db
      .select({
        id: charges.id,
        clientName: clients.name,
        appointmentId: charges.appointmentId,
        amountCents: charges.amountCents,
        reason: charges.reason,
        status: charges.status,
        failureReason: charges.failureReason,
        createdAt: charges.createdAt,
      })
      .from(charges)
      .innerJoin(clients, eq(charges.clientId, clients.id))
      .orderBy(desc(charges.createdAt))
      .limit(limit)
      .offset(offset);
  });
}
