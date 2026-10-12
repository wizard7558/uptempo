"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { trackEvent } from "@/lib/analytics/events";
import { getNotificationSettingsForTenant } from "@/lib/notifications/settings";

const updateNotificationSchema = z.object({
  confirmationEnabled: z.number().min(0).max(1).optional(),
  reminderEnabled: z.number().min(0).max(1).optional(),
  reminderHoursBefore: z.number().min(1).max(168).optional(),
  reminderHoursBefore2: z.number().min(1).max(168).nullable().optional(),
  confirmationGreeting: z.string().nullable().optional(),
  confirmationBody: z.string().nullable().optional(),
  reminderGreeting: z.string().nullable().optional(),
  reminderBody: z.string().nullable().optional(),
  businessAddress: z.string().nullable().optional(),
  smsRemindersEnabled: z.number().min(0).max(1).optional(),
  smsReminderHoursBefore: z.number().min(1).max(168).optional(),
  smsReminderHoursBefore2: z.number().min(1).max(168).nullable().optional(),
  smsReminderBody: z.string().nullable().optional(),
  smsConfirmationEnabled: z.number().min(0).max(1).optional(),
  smsConfirmationBody: z.string().nullable().optional(),
  smsAftercareEnabled: z.number().min(0).max(1).optional(),
  smsFormRequestsEnabled: z.number().min(0).max(1).optional(),
  smsIntakeRequestsEnabled: z.number().min(0).max(1).optional(),
});

/**
 * Get notification settings using tenant slug from request headers.
 * Use only in admin UI contexts where headers are available.
 * For fire-and-forget, use getNotificationSettingsForTenant(slug) instead.
 */
export async function getNotificationSettings() {
  const { tenantSlug: slug } = await requireStaff();
  return getNotificationSettingsForTenant(slug);
}

export async function updateNotificationSettings(data: {
  confirmationEnabled?: number;
  reminderEnabled?: number;
  reminderHoursBefore?: number;
  reminderHoursBefore2?: number | null;
  confirmationGreeting?: string | null;
  confirmationBody?: string | null;
  reminderGreeting?: string | null;
  reminderBody?: string | null;
  businessAddress?: string | null;
  smsRemindersEnabled?: number;
  smsReminderHoursBefore?: number;
  smsReminderHoursBefore2?: number | null;
  smsReminderBody?: string | null;
  smsConfirmationEnabled?: number;
  smsConfirmationBody?: string | null;
  smsAftercareEnabled?: number;
  smsFormRequestsEnabled?: number;
  smsIntakeRequestsEnabled?: number;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateNotificationSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {

    await withTenantDb(slug, async (db, { businessSettings }) => {
      // In tenant schema, there's one policy per tenant
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

    trackEvent("notifications.updated", {
      confirmationEnabled: parsed.data.confirmationEnabled ?? null,
      reminderEnabled: parsed.data.reminderEnabled ?? null,
      smsRemindersEnabled: parsed.data.smsRemindersEnabled ?? null,
    }, { tenantSlug: slug });

    revalidatePath("/settings/notifications");
    return { success: true as const };
  } catch (error) {
    console.error("[Notifications] Failed to update settings:", error);
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update notification settings",
      },
    };
  }
}
