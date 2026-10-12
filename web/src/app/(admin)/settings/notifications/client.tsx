"use client";

import { useState, useTransition } from "react";
import { updateNotificationSettings } from "@/actions/notifications";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";

interface NotificationSettings {
  confirmationEnabled: number;
  reminderEnabled: number;
  reminderHoursBefore: number;
  reminderHoursBefore2: number | null;
  confirmationGreeting: string | null;
  confirmationBody: string | null;
  reminderGreeting: string | null;
  reminderBody: string | null;
  businessAddress: string | null;
  smsRemindersEnabled: number;
  smsReminderHoursBefore: number;
  smsReminderHoursBefore2: number | null;
  smsReminderBody: string | null;
  smsConfirmationEnabled: number;
  smsConfirmationBody: string | null;
  smsAftercareEnabled: number;
  smsFormRequestsEnabled: number;
  smsIntakeRequestsEnabled: number;
}

const DEFAULT_CONFIRMATION_GREETING = "We can't wait to see you!";
const DEFAULT_CONFIRMATION_BODY =
  "Your appointment has been confirmed. Here are the details:";
const DEFAULT_REMINDER_GREETING = "Just a friendly reminder!";
const DEFAULT_REMINDER_BODY =
  "Your appointment is coming up soon. Here are the details:";

function normalizeNotificationSettings(
  s: NotificationSettings,
): NotificationSettings {
  return {
    ...s,
    reminderHoursBefore2: s.reminderHoursBefore2 ?? null,
    smsReminderHoursBefore2: s.smsReminderHoursBefore2 ?? null,
    smsConfirmationEnabled: s.smsConfirmationEnabled ?? 0,
    smsConfirmationBody: s.smsConfirmationBody ?? null,
    smsAftercareEnabled: s.smsAftercareEnabled ?? 0,
    smsFormRequestsEnabled: s.smsFormRequestsEnabled ?? 0,
    smsIntakeRequestsEnabled: s.smsIntakeRequestsEnabled ?? 0,
  };
}

export function NotificationSettingsForm({
  initialSettings,
}: {
  initialSettings: NotificationSettings;
}) {
  const t = useT("settings");
  const [settings, setSettings] = useState<NotificationSettings>(() =>
    normalizeNotificationSettings(initialSettings),
  );
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await updateNotificationSettings(settings);
      if (result.success) {
        toast.success("Notification settings saved.");
      } else {
        toast.error("Failed to save settings.");
      }
    });
  }

  function resetField(field: keyof NotificationSettings) {
    setSettings((prev) => ({ ...prev, [field]: null }));
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Confirmation Emails */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Confirmation Emails</CardTitle>
              <CardDescription>
                Send a confirmation email when a client books an appointment.
              </CardDescription>
            </div>
            <Switch
              checked={settings.confirmationEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  confirmationEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>
        </CardHeader>
        {settings.confirmationEnabled === 1 && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="confirmation-greeting">Custom Greeting</Label>
                <Button
                  variant="ghost"
                  
                  onClick={() => resetField("confirmationGreeting")}
                  className="text-xs text-muted-foreground"
                >
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="confirmation-greeting"
                placeholder={DEFAULT_CONFIRMATION_GREETING}
                value={settings.confirmationGreeting ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    confirmationGreeting: e.target.value || null,
                  }))
                }
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="confirmation-body">Custom Body Text</Label>
                <Button
                  variant="ghost"
                  
                  onClick={() => resetField("confirmationBody")}
                  className="text-xs text-muted-foreground"
                >
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="confirmation-body"
                placeholder={DEFAULT_CONFIRMATION_BODY}
                value={settings.confirmationBody ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    confirmationBody: e.target.value || null,
                  }))
                }
                rows={3}
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Reminder Emails */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Reminder Emails</CardTitle>
              <CardDescription>
                Send a reminder email before upcoming appointments.
              </CardDescription>
            </div>
            <Switch
              checked={settings.reminderEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  reminderEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>
        </CardHeader>
        {settings.reminderEnabled === 1 && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reminder-timing">Send Reminder</Label>
              <Select
                value={String(settings.reminderHoursBefore)}
                onValueChange={(val) =>
                  setSettings((prev) => ({
                    ...prev,
                    reminderHoursBefore: Number(val),
                  }))
                }
              >
                <SelectTrigger id="reminder-timing" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">12 hours before</SelectItem>
                  <SelectItem value="24">24 hours before</SelectItem>
                  <SelectItem value="48">48 hours before</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reminder-timing-2">
                Second reminder (optional)
              </Label>
              <Select
                value={
                  settings.reminderHoursBefore2 == null
                    ? "none"
                    : String(settings.reminderHoursBefore2)
                }
                onValueChange={(val) =>
                  setSettings((prev) => ({
                    ...prev,
                    reminderHoursBefore2:
                      val === "none" ? null : Number(val),
                  }))
                }
              >
                <SelectTrigger id="reminder-timing-2" className="w-full">
                  <SelectValue placeholder="Disabled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Disabled</SelectItem>
                  <SelectItem value="2">2 hours before</SelectItem>
                  <SelectItem value="4">4 hours before</SelectItem>
                  <SelectItem value="12">12 hours before</SelectItem>
                  <SelectItem value="24">24 hours before</SelectItem>
                  <SelectItem value="48">48 hours before</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="reminder-greeting">Custom Greeting</Label>
                <Button
                  variant="ghost"
                  
                  onClick={() => resetField("reminderGreeting")}
                  className="text-xs text-muted-foreground"
                >
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="reminder-greeting"
                placeholder={DEFAULT_REMINDER_GREETING}
                value={settings.reminderGreeting ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    reminderGreeting: e.target.value || null,
                  }))
                }
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="reminder-body">Custom Body Text</Label>
                <Button
                  variant="ghost"
                  
                  onClick={() => resetField("reminderBody")}
                  className="text-xs text-muted-foreground"
                >
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="reminder-body"
                placeholder={DEFAULT_REMINDER_BODY}
                value={settings.reminderBody ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    reminderBody: e.target.value || null,
                  }))
                }
                rows={3}
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* SMS Reminders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>SMS Reminders</CardTitle>
              <CardDescription>
                Send text message reminders before appointments.
              </CardDescription>
            </div>
            <Switch
              checked={settings.smsRemindersEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  smsRemindersEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>
        </CardHeader>
        {settings.smsRemindersEnabled === 1 && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sms-timing">Send SMS reminder</Label>
              <Select
                value={String(settings.smsReminderHoursBefore)}
                onValueChange={(val) =>
                  setSettings((prev) => ({
                    ...prev,
                    smsReminderHoursBefore: Number(val),
                  }))
                }
              >
                <SelectTrigger id="sms-timing" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 hours before</SelectItem>
                  <SelectItem value="4">4 hours before</SelectItem>
                  <SelectItem value="12">12 hours before</SelectItem>
                  <SelectItem value="24">24 hours before</SelectItem>
                  <SelectItem value="48">48 hours before</SelectItem>
                  <SelectItem value="72">72 hours before</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sms-timing-2">
                Second SMS reminder (optional)
              </Label>
              <Select
                value={
                  settings.smsReminderHoursBefore2 == null
                    ? "none"
                    : String(settings.smsReminderHoursBefore2)
                }
                onValueChange={(val) =>
                  setSettings((prev) => ({
                    ...prev,
                    smsReminderHoursBefore2:
                      val === "none" ? null : Number(val),
                  }))
                }
              >
                <SelectTrigger id="sms-timing-2" className="w-full">
                  <SelectValue placeholder="Disabled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Disabled</SelectItem>
                  <SelectItem value="2">2 hours before</SelectItem>
                  <SelectItem value="4">4 hours before</SelectItem>
                  <SelectItem value="12">12 hours before</SelectItem>
                  <SelectItem value="24">24 hours before</SelectItem>
                  <SelectItem value="48">48 hours before</SelectItem>
                  <SelectItem value="72">72 hours before</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sms-body">Custom SMS message (optional)</Label>
                <Button
                  variant="ghost"
                  
                  onClick={() => resetField("smsReminderBody")}
                  className="text-xs text-muted-foreground"
                >
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="sms-body"
                placeholder="Leave blank for default reminder text. Use {client}, {staff}, {date}, {time}, {services} as placeholders."
                value={settings.smsReminderBody ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    smsReminderBody: e.target.value || null,
                  }))
                }
                rows={3}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              SMS is sent only to clients who have opted in. Messages are not
              sent during quiet hours (before 8 AM or after 9 PM in your
              timezone). Standard messaging rates may apply to recipients.
            </p>
          </CardContent>
        )}
      </Card>

      {/* SMS — booking & checkout */}
      <Card>
        <CardHeader>
          <CardTitle>SMS — booking & checkout</CardTitle>
          <CardDescription>
            Optional texts when clients book or when forms and aftercare go out.
            Uses the same opt-in and quiet hours rules as reminders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="sms-confirm-toggle">SMS confirmation</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Send a text when an appointment is confirmed (public booking or
                admin schedule).
              </p>
            </div>
            <Switch
              id="sms-confirm-toggle"
              checked={settings.smsConfirmationEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  smsConfirmationEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>
          {settings.smsConfirmationEnabled === 1 && (
            <div className="space-y-2">
              <Label htmlFor="sms-confirm-body">SMS confirmation text</Label>
              <Textarea
                id="sms-confirm-body"
                placeholder="Hi {client}, you're booked with {staff} on {date} at {time}. Services: {services}."
                value={settings.smsConfirmationBody ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    smsConfirmationBody: e.target.value || null,
                  }))
                }
                rows={3}
              />
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label htmlFor="sms-aftercare-toggle">
                Aftercare link after checkout
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Text a secure link to aftercare instructions after payment
                completes.
              </p>
            </div>
            <Switch
              id="sms-aftercare-toggle"
              checked={settings.smsAftercareEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  smsAftercareEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label htmlFor="sms-forms-toggle">Form / waiver links</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Also text the same link sent by email when a form is required.
              </p>
            </div>
            <Switch
              id="sms-forms-toggle"
              checked={settings.smsFormRequestsEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  smsFormRequestsEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label htmlFor="sms-intake-toggle">Intake (policies + card) links</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Also text the intake link when you click &quot;Send Intake&quot; on
                an appointment.
              </p>
            </div>
            <Switch
              id="sms-intake-toggle"
              checked={settings.smsIntakeRequestsEnabled === 1}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  smsIntakeRequestsEnabled: checked ? 1 : 0,
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Salon Address */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.addressTitle")}</CardTitle>
          <CardDescription>
            Included in email templates as the appointment location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="salon-address">Address</Label>
            <Input
              id="salon-address"
              placeholder="123 Main St, City, State 12345"
              value={settings.businessAddress ?? ""}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  businessAddress: e.target.value || null,
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
