import { getNotificationSettings } from "@/actions/notifications";
import { getTextLine } from "@/actions/text-line";
import { TextLineCard } from "@/components/settings/text-line-card";
import { requireAdminRole } from "@/lib/auth/rbac";
import { isSingleMode } from "@/lib/config/mode";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getTenantSlug } from "@/lib/tenant/context";
import { NotificationSettingsForm } from "./client";

export default async function NotificationSettingsPage() {
  const [{ role, tenantSlug }, settings] = await Promise.all([
    requireAdminRole(),
    getNotificationSettings(),
  ]);
  const singleMode = isSingleMode();
  const slug = tenantSlug ?? (await getTenantSlug());
  const tenant = singleMode ? null : await getTenantBySlug(slug);
  const textLine = !singleMode && role === "owner" ? await getTextLine() : null;
  const smsSetupRequired =
    !singleMode &&
    ["off", "pending", "action_needed"].includes(
      tenant?.smsLineStatus ?? "off",
    );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure booking confirmations, reminders, SMS notifications, and
          email templates.
        </p>
      </div>

      {textLine ? <TextLineCard initialState={textLine} /> : null}
      <NotificationSettingsForm
        initialSettings={settings}
        smsSetupRequired={smsSetupRequired}
      />
    </div>
  );
}
