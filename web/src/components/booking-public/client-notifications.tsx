"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/ui/field";
import { toggleSmsConsentForBookingClient } from "@/actions/sms";
import { ImessageOptIn } from "@/components/booking-public/imessage-opt-in";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  clientId: string;
  salonName: string;
  initialPhone: string;
  initialConsent: {
    consented: boolean;
    consentedAt: string | null;
    method: string | null;
  };
}

export function ClientNotifications({
  clientId,
  salonName,
  initialPhone,
  initialConsent,
}: Props) {
  const [phone, setPhone] = useState(initialPhone);
  const [consented, setConsented] = useState(initialConsent.consented);
  const [pending, setPending] = useState(false);

  async function handleToggle(next: boolean) {
    const digits = phone.replace(/\D/g, "");
    if (next && digits.length < 10) {
      toast.error("Add a valid phone number to receive SMS reminders.");
      return;
    }
    const phoneForApi = phone.trim() || initialPhone;
    if (!next && !phoneForApi) {
      toast.error("Could not update SMS preferences.");
      return;
    }
    setPending(true);
    const res = await toggleSmsConsentForBookingClient(
      clientId,
      phoneForApi,
      next,
    );
    setPending(false);
    if (res.success) {
      setConsented(next);
      toast.success(next ? "SMS reminders enabled" : "SMS reminders off");
    } else {
      toast.error("Could not update preferences");
    }
  }

  return (
    <div className="space-y-4">
      <Field
        htmlFor="sms-phone"
        label="Mobile number"
        description="Used for appointment reminders when enabled."
      >
        <Field.Input
          id="sms-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          placeholder="(555) 555-5555"
        />
      </Field>

      <div className="flex items-center justify-between gap-4 border border-[var(--line)] p-4">
        <div className="space-y-0.5">
          <Label htmlFor="sms-toggle" className="font-display text-xl font-light text-[var(--ink)]">
            SMS reminders
          </Label>
          <p className="text-xs text-[var(--ink-soft)]">
            Receive text messages about upcoming appointments.
          </p>
        </div>
        <Switch
          id="sms-toggle"
          checked={consented}
          disabled={pending}
          onCheckedChange={(v) => void handleToggle(v)}
        />
      </div>

      {/* A2P 10DLC opt-in disclosure — shown at the point of consent. */}
      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
        By turning on SMS reminders, you agree to receive automated
        appointment text messages (reminders, confirmations, and schedule
        changes) from {salonName} at the number above. Message frequency varies
        (typically 2–4 messages per appointment). Message and data rates may
        apply. Reply STOP to opt out or HELP for help at any time. Consent is
        not a condition of any purchase. See our{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Privacy Policy
        </a>{" "}
        and{" "}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Terms
        </a>
        .
      </p>

      {/* iMessage opt-in (renders only when the platform opt-in URL is set). */}
      <ImessageOptIn salonName={salonName} />

      {pending && (
        <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating…
        </div>
      )}
    </div>
  );
}
