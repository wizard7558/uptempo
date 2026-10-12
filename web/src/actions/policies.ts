"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { getEmailT } from "@/lib/terms/email";
import { getT } from "@/lib/terms/server";
import { withTenantDb } from "@/lib/db/tenant";
import { resolveTenantSlugForAppointment } from "@/lib/tenant/registry";
import { updatePolicySchema, updatePaymentMethodsSchema } from "@/lib/validators/policy";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import {
  createIntakeToken,
  verifyActionToken,
} from "@/lib/email/tokens";
import { getBaseUrl } from "@/lib/utils";
import { getStripe } from "@/lib/stripe/server";
import { sendEmail } from "@/lib/email/send";
import { getEmailBranding } from "@/lib/email/branding";
import { getBusinessSettingsForTenant, mapPolicyToPaymentMethodSettings } from "@/lib/policies/salon-policy";

export async function getBusinessSettings() {
  const { tenantSlug: slug } = await requireStaff();
  return getBusinessSettingsForTenant(slug);
}

export async function updateBusinessSettings(data: {
  timezone?: string;
  cancellationWindowHours?: number;
  cancellationFeePercent?: number;
  noShowFeePercent?: number;
  requireCardOnFile?: number;
  policyText?: string | null;
  onlineBookingAudience?: "both" | "existing_only" | "new_only";
  depositEnabled?: number;
  depositDefaultType?: "percent" | "fixed";
  depositDefaultAmount?: number;
  depositDurationThresholdMinutes?: number | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updatePolicySchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {

    // Ensure a policy row exists first
    const existingPolicy = await getBusinessSettings();

    const result = await withTenantDb(slug, async (db, { businessSettings }) => {
      return db
        .update(businessSettings)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(businessSettings.id, existingPolicy.id))
        .returning({ id: businessSettings.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Policy not found",
        },
      };
    }

    revalidatePath("/settings/policies");
    revalidatePath("/settings/general");
    trackEvent("policy.updated", {}, { tenantSlug: slug });
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update policy",
      },
    };
  }
}

/**
 * Read the payment method toggle settings from the salon's policy.
 * Defaults all methods to enabled (1) if the columns are not yet present
 * (covers tenants that haven't run migration 0002).
 */
export async function getPaymentMethodSettings() {
  await requireStaff();
  const policy = await getBusinessSettings();
  return mapPolicyToPaymentMethodSettings(policy);
}

/**
 * Update payment method toggle settings for the salon.
 * Validates input with updatePaymentMethodsSchema and persists to salon_policies.
 */
export async function updatePaymentMethods(data: {
  applePayEnabled?: number;
  googlePayEnabled?: number;
  afterpayEnabled?: number;
  cashappEnabled?: number;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updatePaymentMethodsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const existingPolicy = await getBusinessSettings();

    const result = await withTenantDb(slug, async (db, { businessSettings }) => {
      return db
        .update(businessSettings)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(businessSettings.id, existingPolicy.id))
        .returning({ id: businessSettings.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Policy not found",
        },
      };
    }

    revalidatePath("/settings/payments");
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update payment methods",
      },
    };
  }
}

/**
 * Send an intake link to the client of an appointment so they can review and
 * sign salon policies and add a card on file. Mirrors the form-request /
 * aftercare send pipeline.
 */
export async function sendIntakeRequest(input: { appointmentId: string }) {
  const { tenantSlug: slug } = await requireStaff();
  const { appointmentId } = input;
  if (!appointmentId) {
    return { success: false as const, error: "Missing appointment id" };
  }

  try {

    const data = await withTenantDb(
      slug,
      async (
        db,
        { appointments, clients, businessSettings, policySignatures },
      ) => {
        const [appt] = await db
          .select({ id: appointments.id, clientId: appointments.clientId })
          .from(appointments)
          .where(eq(appointments.id, appointmentId))
          .limit(1);
        if (!appt) return { error: "Appointment not found" as const };

        const [client] = await db
          .select({
            id: clients.id,
            name: clients.name,
            email: clients.email,
            phone: clients.phone,
          })
          .from(clients)
          .where(eq(clients.id, appt.clientId))
          .limit(1);
        if (!client) return { error: "Client not found" as const };
        if (!client.email && !client.phone) {
          return {
            error: "Client has no email or phone on file" as const,
          };
        }

        const [policy] = await db
          .select({ policyText: businessSettings.policyText })
          .from(businessSettings)
          .limit(1);
        const policyText = (policy?.policyText ?? "").trim();
        if (!policyText) {
          return {
            error: (await getT("errors", slug))("policies.addPolicies"),
          };
        }

        const [signature] = await db
          .insert(policySignatures)
          .values({
            clientId: client.id,
            appointmentId: appt.id,
            policyText,
          })
          .returning({ id: policySignatures.id });

        return { client, signatureId: signature.id, policyText };
      },
    );

    if ("error" in data) {
      return { success: false as const, error: data.error };
    }

    const { client, signatureId } = data;

    const token = createIntakeToken(signatureId, appointmentId);
    const intakeUrl = `${getBaseUrl()}/intake/${token}`;

    const [branding, emailT] = await Promise.all([
      getEmailBranding(slug),
      getEmailT(slug, "emails"),
    ]);
    const salonName = branding.salonName;

    if (client.email) {
      const { IntakeRequestEmail } = await import("@/emails/intake-request");
      await sendEmail({
        to: client.email,
        subject: emailT("intakeMail.subject", { business: salonName }),
        react: IntakeRequestEmail({
          t: emailT,
          salonName,
          clientName: client.name,
          intakeUrl,
          logoUrl: branding.logoUrl,
          brandColor: branding.brandColor,
        }),
        salonName,
      });
    }

    const settings = await withTenantDb(slug, async (db, { businessSettings }) => {
      const [p] = await db
        .select({
          smsIntakeRequestsEnabled: businessSettings.smsIntakeRequestsEnabled,
        })
        .from(businessSettings)
        .limit(1);
      return p;
    });

    if (
      settings?.smsIntakeRequestsEnabled === 1 &&
      client.phone
    ) {
      const { sendSms } = await import("@/lib/sms/send");
      await sendSms({
        to: client.phone,
        body: emailT("intake.sms", { placeName: salonName, url: intakeUrl }),
        tenantSlug: slug,
        clientId: client.id,
        appointmentId,
        messageType: "intake_request",
      });
    }

    trackEvent(
      "intake.requested",
      { appointmentId, signatureId },
      { tenantSlug: slug },
    );

    return { success: true as const };
  } catch (err) {
    console.error("[Intake] sendIntakeRequest failed:", err);
    return {
      success: false as const,
      error: "Could not send intake link",
    };
  }
}

interface IntakeContext {
  signatureId: string;
  appointmentId: string;
  tenantSlug: string;
  policyText: string;
  signedAt: Date | null;
  clientId: string;
  clientName: string;
  salonName: string;
  logoUrl: string | null;
}

/**
 * Verify an intake token and return everything the public page needs.
 * Returns null when the token is missing/expired/invalid.
 */
export async function getIntakeByToken(
  token: string,
): Promise<IntakeContext | null> {
  const payload = verifyActionToken(token);
  if (!payload || payload.action !== "intake" || !payload.intakeSignatureId) {
    return null;
  }

  const slug = await resolveTenantSlugForAppointment(payload.appointmentId);
  if (!slug) return null;

  const ctx = await withTenantDb(
    slug,
    async (db, { policySignatures, clients }) => {
      const [sig] = await db
        .select({
          id: policySignatures.id,
          appointmentId: policySignatures.appointmentId,
          policyText: policySignatures.policyText,
          signedAt: policySignatures.signedAt,
          clientId: policySignatures.clientId,
        })
        .from(policySignatures)
        .where(eq(policySignatures.id, payload.intakeSignatureId!))
        .limit(1);
      if (!sig) return null;

      const [client] = await db
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, sig.clientId))
        .limit(1);
      if (!client) return null;

      return { sig, client };
    },
  );
  if (!ctx) return null;

  const branding = await getEmailBranding(slug);

  return {
    signatureId: ctx.sig.id,
    appointmentId: ctx.sig.appointmentId ?? payload.appointmentId,
    tenantSlug: slug,
    policyText: ctx.sig.policyText,
    signedAt: ctx.sig.signedAt,
    clientId: ctx.sig.clientId,
    clientName: ctx.client.name,
    salonName: branding.salonName,
    logoUrl: branding.logoUrl,
  };
}

/**
 * Create a SetupIntent for the client referenced by an intake token.
 * Public; gated by token verification only.
 */
export async function createIntakeSetupIntent(token: string) {
  const intake = await getIntakeByToken(token);
  if (!intake) {
    return { error: "Link is invalid or has expired" as const };
  }
  if (intake.signedAt) {
    return { error: "This intake has already been completed" as const };
  }

  const slug = intake.tenantSlug;

  const [client] = await withTenantDb(slug, async (db, { clients }) => {
    return db
      .select({
        id: clients.id,
        email: clients.email,
        phone: clients.phone,
        stripeCustomerId: clients.stripeCustomerId,
      })
      .from(clients)
      .where(eq(clients.id, intake.clientId))
      .limit(1);
  });
  if (!client) {
    return { error: "Client not found" as const };
  }

  let stripeCustomerId = client.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      email: client.email ?? undefined,
      phone: client.phone ?? undefined,
      metadata: { clientId: client.id, tenantSlug: slug },
    });
    stripeCustomerId = customer.id;
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(clients.id, client.id));
    });
  }

  const setupIntent = await getStripe().setupIntents.create({
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    usage: "off_session",
    metadata: {
      clientId: client.id,
      tenantSlug: slug,
      intakeSignatureId: intake.signatureId,
    },
  });

  return { clientSecret: setupIntent.client_secret };
}

/**
 * Mark an intake complete: record the signed name, attach the captured
 * payment method to the client, and stamp signedAt.
 */
export async function finalizeIntake(input: {
  token: string;
  signedName: string;
  paymentMethodId: string;
}) {
  const { token, signedName, paymentMethodId } = input;
  if (!signedName || signedName.trim().length < 2) {
    return { success: false as const, error: "Please type your full name" };
  }
  if (!paymentMethodId.startsWith("pm_")) {
    return { success: false as const, error: "Payment method missing" };
  }

  const intake = await getIntakeByToken(token);
  if (!intake) {
    return {
      success: false as const,
      error: "Link is invalid or has expired",
    };
  }
  if (intake.signedAt) {
    return { success: true as const, alreadyCompleted: true as const };
  }

  const slug = intake.tenantSlug;

  await withTenantDb(slug, async (db, { policySignatures, clients }) => {
    await db
      .update(policySignatures)
      .set({
        signedName: signedName.trim(),
        signedAt: new Date(),
        paymentMethodId,
        updatedAt: new Date(),
      })
      .where(eq(policySignatures.id, intake.signatureId));

    await db
      .update(clients)
      .set({ stripePaymentMethodId: paymentMethodId, updatedAt: new Date() })
      .where(eq(clients.id, intake.clientId));
  });

  trackEvent(
    "intake.completed",
    { signatureId: intake.signatureId, clientId: intake.clientId },
    { tenantSlug: slug },
  );

  return { success: true as const, alreadyCompleted: false as const };
}
