"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import { createStaffMember, updateStaffMember } from "@/actions/staff";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StaffFormProps {
  staffMember?: {
    id: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
    role: string;
    defaultAssistantId: string | null;
  };
  assistants: Array<{ id: string; displayName: string }>;
  onSuccess: () => void;
}

export function StaffForm({
  staffMember,
  assistants,
  onSuccess,
}: StaffFormProps) {
  const t = useT("settings");
  const [displayName, setDisplayName] = useState(staffMember?.displayName ?? "");
  const [email, setEmail] = useState(staffMember?.email ?? "");
  const [phone, setPhone] = useState(staffMember?.phone ?? "");
  const [defaultAssistantId, setDefaultAssistantId] = useState(
    staffMember?.defaultAssistantId ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!staffMember;
  const showDefaultAssistant =
    isEditing && staffMember.role !== "assistant" && assistants.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (isEditing) {
        const result = await updateStaffMember({
          id: staffMember.id,
          displayName,
          email: email.trim() === "" ? null : email.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
          ...(showDefaultAssistant
            ? { defaultAssistantId: defaultAssistantId || null }
            : {}),
        });
        if (!result.success) {
          toast.error(
            "error" in result && result.error && "message" in result.error
              ? (result.error as { message: string }).message
              : t("staffForm.updateFailed"),
          );
          return;
        }
        toast.success(t("staffForm.updated"));
      } else {
        const result = await createStaffMember({
          displayName,
          email: email.trim() === "" ? null : email.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
        });
        if (!result.success) {
          toast.error(
            "error" in result && result.error && "message" in result.error
              ? (result.error as { message: string }).message
              : t("staffForm.createFailed"),
          );
          return;
        }
        toast.success(t("staffForm.created"));
      }

      onSuccess();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Sarah"
          required
          maxLength={100}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="staff-email">Email</Label>
          <Input
            id="staff-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sarah@example.com"
            maxLength={254}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-phone">Phone</Label>
          <Input
            id="staff-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            maxLength={50}
          />
        </div>
      </div>

      {showDefaultAssistant && (
        <div className="space-y-2">
          <Label htmlFor="default-assistant">Default assistant</Label>
          <Select
            value={defaultAssistantId || "__none__"}
            onValueChange={(v) =>
              setDefaultAssistantId(v === "__none__" ? "" : v)
            }
          >
            <SelectTrigger id="default-assistant">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {assistants.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Used for automatic assistant tasks when a booked service has
            &quot;Assistant workflow&quot; enabled.
          </p>
        </div>
      )}

      {isEditing && (
        <p className="text-xs text-muted-foreground">
          {t("staffForm.editHint")}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting
          ? "Saving..."
          : isEditing
            ? t("staffForm.update")
            : t("staffForm.add")}
      </Button>
    </form>
  );
}
