import { getNotificationSettings } from "@/actions/notifications";
import { NotificationSettingsForm } from "./client";

export default async function NotificationSettingsPage() {
  const settings = await getNotificationSettings();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure booking confirmations, reminders, SMS notifications, and email templates.
        </p>
      </div>

      <NotificationSettingsForm initialSettings={settings} />
    </div>
  );
}
