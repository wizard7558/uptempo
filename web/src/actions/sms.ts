"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlugForBookingClient } from "@/lib/tenant/registry";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordSmsConsent, revokeSmsConsent } from "@/lib/sms/consent";

/**
 * Get SMS-related settings from business_settings.
 */
export async function getSmsSettings() {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [policy] = await db
      .select({
        smsRemindersEnabled: businessSettings.smsRemindersEnabled,
        smsReminderHoursBefore: businessSettings.smsReminderHoursBefore,
        smsReminderBody: businessSettings.smsReminderBody,
      })
      .from(businessSettings)
      .limit(1);

    return (
      policy ?? {
        smsRemindersEnabled: 0,
        smsReminderHoursBefore: 24,
        smsReminderBody: null,
      }
    );
  });
}

const updateSmsSettingsSchema = z.object({
  smsRemindersEnabled: z.number().min(0).max(1).optional(),
  smsReminderHoursBefore: z.number().min(1).max(168).optional(),
  smsReminderBody: z.string().nullable().optional(),
});

/**
 * Update SMS-related settings in business_settings.
 */
export async function updateSmsSettings(data: {
  smsRemindersEnabled?: number;
  smsReminderHoursBefore?: number;
  smsReminderBody?: string | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateSmsSettingsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {

    await withTenantDb(slug, async (db, { businessSettings }) => {
      const [existing] = await db
        .select({ id: businessSettings.id })
        .from(businessSettings)
        .limit(1);

      if (!existing) return;

      await db
        .update(businessSettings)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(businessSettings.id, existing.id));
    });

    revalidatePath("/settings/notifications");
    return { success: true as const };
  } catch (error) {
    console.error("[SMS] Failed to update settings:", error);
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update SMS settings",
      },
    };
  }
}

/**
 * Get SMS consent status for a client — used in admin client profile UI.
 */
export async function getSmsConsentForClient(
  clientId: string,
): Promise<{
  consented: boolean;
  consentedAt: Date | null;
  method: string | null;
}> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { smsConsent }) => {
    const [latest] = await db
      .select({
        consentedAt: smsConsent.consentedAt,
        optedOutAt: smsConsent.optedOutAt,
        consentMethod: smsConsent.consentMethod,
      })
      .from(smsConsent)
      .where(eq(smsConsent.clientId, clientId))
      .orderBy(desc(smsConsent.createdAt))
      .limit(1);

    if (!latest || !latest.consentedAt || latest.optedOutAt) {
      return { consented: false, consentedAt: null, method: null };
    }

    return {
      consented: true,
      consentedAt: latest.consentedAt,
      method: latest.consentMethod,
    };
  });
}

/**
 * Toggle SMS consent for a client from admin UI.
 * Records or revokes consent with method="admin_toggle".
 */
export async function toggleSmsConsentForClient(
  clientId: string,
  phone: string,
  enable: boolean,
): Promise<{ success: boolean }> {
  const { tenantSlug: slug } = await requireStaff();
  try {
    if (enable) {
      await recordSmsConsent(slug, clientId, phone, "admin_toggle", "admin");
    } else {
      await revokeSmsConsent(slug, phone);
    }
    revalidatePath("/clients");
    return { success: true };
  } catch (error) {
    console.error("[SMS] Failed to toggle consent:", error);
    return { success: false };
  }
}

/**
 * SMS consent for logged-in booking session (`/account`), no admin auth.
 */
export async function getSmsConsentForBookingClient(clientId: string): Promise<{
  consented: boolean;
  consentedAt: Date | null;
  method: string | null;
}> {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    return { consented: false, consentedAt: null, method: null };
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { consented: false, consentedAt: null, method: null };
  }
  return withTenantDb(slug, async (db, { smsConsent }) => {
    const [latest] = await db
      .select({
        consentedAt: smsConsent.consentedAt,
        optedOutAt: smsConsent.optedOutAt,
        consentMethod: smsConsent.consentMethod,
      })
      .from(smsConsent)
      .where(eq(smsConsent.clientId, clientId))
      .orderBy(desc(smsConsent.createdAt))
      .limit(1);

    if (!latest || !latest.consentedAt || latest.optedOutAt) {
      return { consented: false, consentedAt: null, method: null };
    }

    return {
      consented: true,
      consentedAt: latest.consentedAt,
      method: latest.consentMethod,
    };
  });
}

export async function toggleSmsConsentForBookingClient(
  clientId: string,
  phone: string,
  enable: boolean,
): Promise<{ success: boolean }> {
  const session = await getBookingSession();
  if (!session || session !== clientId) {
    return { success: false };
  }
  const slug = await getTenantSlugForBookingClient(clientId);
  if (!slug) {
    return { success: false };
  }
  try {
    if (enable) {
      await recordSmsConsent(slug, clientId, phone, "client_account", "account");
    } else {
      await revokeSmsConsent(slug, phone);
    }
    revalidatePath("/account");
    return { success: true };
  } catch (error) {
    console.error("[SMS] Failed to toggle booking consent:", error);
    return { success: false };
  }
}
