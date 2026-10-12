import { withTenantDb } from "@/lib/db/tenant";

export async function getNotificationSettingsForTenant(slug: string) {
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [policy] = await db
      .select({
        confirmationEnabled: businessSettings.confirmationEnabled,
        reminderEnabled: businessSettings.reminderEnabled,
        reminderHoursBefore: businessSettings.reminderHoursBefore,
        reminderHoursBefore2: businessSettings.reminderHoursBefore2,
        confirmationGreeting: businessSettings.confirmationGreeting,
        confirmationBody: businessSettings.confirmationBody,
        reminderGreeting: businessSettings.reminderGreeting,
        reminderBody: businessSettings.reminderBody,
        businessAddress: businessSettings.businessAddress,
        smsRemindersEnabled: businessSettings.smsRemindersEnabled,
        smsReminderHoursBefore: businessSettings.smsReminderHoursBefore,
        smsReminderHoursBefore2: businessSettings.smsReminderHoursBefore2,
        smsReminderBody: businessSettings.smsReminderBody,
        smsConfirmationEnabled: businessSettings.smsConfirmationEnabled,
        smsConfirmationBody: businessSettings.smsConfirmationBody,
        smsAftercareEnabled: businessSettings.smsAftercareEnabled,
        smsFormRequestsEnabled: businessSettings.smsFormRequestsEnabled,
        smsIntakeRequestsEnabled: businessSettings.smsIntakeRequestsEnabled,
      })
      .from(businessSettings)
      .limit(1);

    if (policy) return policy;

    // Create default policy if none exists
    const [newPolicy] = await db
      .insert(businessSettings)
      .values({})
      .returning({
        confirmationEnabled: businessSettings.confirmationEnabled,
        reminderEnabled: businessSettings.reminderEnabled,
        reminderHoursBefore: businessSettings.reminderHoursBefore,
        reminderHoursBefore2: businessSettings.reminderHoursBefore2,
        confirmationGreeting: businessSettings.confirmationGreeting,
        confirmationBody: businessSettings.confirmationBody,
        reminderGreeting: businessSettings.reminderGreeting,
        reminderBody: businessSettings.reminderBody,
        businessAddress: businessSettings.businessAddress,
        smsRemindersEnabled: businessSettings.smsRemindersEnabled,
        smsReminderHoursBefore: businessSettings.smsReminderHoursBefore,
        smsReminderHoursBefore2: businessSettings.smsReminderHoursBefore2,
        smsReminderBody: businessSettings.smsReminderBody,
        smsConfirmationEnabled: businessSettings.smsConfirmationEnabled,
        smsConfirmationBody: businessSettings.smsConfirmationBody,
        smsAftercareEnabled: businessSettings.smsAftercareEnabled,
        smsFormRequestsEnabled: businessSettings.smsFormRequestsEnabled,
        smsIntakeRequestsEnabled: businessSettings.smsIntakeRequestsEnabled,
      });

    return newPolicy;
  });
}
