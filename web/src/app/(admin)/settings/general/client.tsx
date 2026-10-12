"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import { updateBusinessSettings } from "@/actions/policies";

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "America/Phoenix", label: "Arizona (MST, no DST)" },
];

const OTHER_TIMEZONES = [
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
];

interface GeneralSettingsClientProps {
  initialTimezone: string;
}

export function GeneralSettingsClient({
  initialTimezone,
}: GeneralSettingsClientProps) {
  const t = useT("settings");
  const [timezone, setTimezone] = useState(initialTimezone);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave() {
    setIsSubmitting(true);
    try {
      const result = await updateBusinessSettings({ timezone });

      if (!result.success) {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? result.error.message
            : "Failed to update timezone",
        );
        return;
      }

      toast.success("Timezone updated");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div className="space-y-2">
        <Label>{t("general.timezoneLabel")}</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select timezone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem disabled value="us-header">
              US Timezones
            </SelectItem>
            {US_TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
            <SelectItem disabled value="other-header">
              Other
            </SelectItem>
            {OTHER_TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          All appointment times will be displayed in this timezone.
        </p>
      </div>

      <Button onClick={handleSave} disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save Timezone"}
      </Button>
    </div>
  );
}
