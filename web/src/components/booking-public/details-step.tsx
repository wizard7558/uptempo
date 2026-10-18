"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateClientName } from "@/actions/booking-public";
import { useT } from "@/lib/terms/client";
import { MailIcon, LoaderIcon } from "lucide-react";
import { identifyPostHogUser } from "@/lib/analytics/posthog-provider";
import { notifyNativeAuthSuccess } from "@/lib/native/push-register";
import type { BookingVerificationChannel } from "@/lib/booking/verification-channel";

interface IdentityStepProps {
  salonId: string;
  onComplete: (clientId: string, clientName: string, phone?: string) => void;
  showPhoneField?: boolean;
}

type StepPhase = "input" | "verify" | "name";

const fieldClass =
  "min-h-11 rounded-none border-0 border-b border-[var(--line)] px-0 py-3 font-light shadow-none focus-visible:border-[var(--ink)] focus-visible:ring-0";

/** Email sign-in used by requests, classes, packs, and membership. */
export function IdentityStep({ salonId, onComplete, showPhoneField = true }: IdentityStepProps) {
  const [phase, setPhase] = useState<StepPhase>("input");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  const handleSendCode = useCallback(async () => {
    if (!identifier.trim()) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/booking/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          phone: phone.trim() || undefined,
          salonId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(res.status === 429 ? "Too many attempts. Please try again later." : data.error || "Failed to send code");
        return;
      }
      setPhase("verify");
      setResendCountdown(60);
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }, [identifier, phone, salonId]);

  const handleVerifyCode = useCallback(async () => {
    if (code.length !== 6) return;
    setError(null);
    setVerifying(true);
    try {
      const res = await fetch("/api/booking/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          code,
          phone: phone.trim() || undefined,
          salonId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid code");
        setCode("");
        return;
      }
      notifyNativeAuthSuccess();
      if (data.isReturning) {
        identifyPostHogUser(data.clientId, { email: identifier, name: data.name });
        onComplete(data.clientId, data.name, phone.trim() || undefined);
      } else {
        setClientId(data.clientId);
        setPhase("name");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  }, [code, identifier, phone, salonId, onComplete]);

  const handleSubmitName = useCallback(async () => {
    if (!name.trim() || !clientId) return;
    setSavingName(true);
    try {
      const result = await updateClientName(clientId, name.trim());
      if (result.success) {
        identifyPostHogUser(clientId, { email: identifier, name: name.trim() });
        onComplete(clientId, name.trim(), phone.trim() || undefined);
      } else {
        toast.error("Failed to save name. Please try again.");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AuthError") throw err;
      toast.error("Network error. Please try again.");
    } finally {
      setSavingName(false);
    }
  }, [name, clientId, identifier, phone, onComplete]);

  if (phase === "input") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="identifier" className="text-[13px] font-medium">
            Email address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[var(--ink-soft)]">
              <MailIcon className="size-4" />
            </div>
            <Input
              id="identifier"
              type="email"
              placeholder="you@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
              className={`${fieldClass} pl-7`}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        {showPhoneField && (
          <div className="space-y-2">
            <label htmlFor="phone" className="text-[13px] font-medium">
              Mobile number (optional)
            </label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(555) 555-5555"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
              className={fieldClass}
            />
            <p className="text-[13px] text-[var(--ink-soft)]">We&apos;ll text your code and appointment reminders here.</p>
          </div>
        )}
        <Button onClick={handleSendCode} disabled={!identifier.trim() || sending} className="w-full" variant="default">
          {sending && <LoaderIcon className="size-4 animate-spin" />}
          Send Code
        </Button>
      </div>
    );
  }

  if (phase === "verify") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="code" className="text-[13px] font-medium">
            Verification code
          </label>
          <p className="text-sm text-[var(--ink-soft)]">
            Code sent to <span className="font-medium text-[var(--ink)]">{identifier}</span>
          </p>
          <Input
            id="code"
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
            className={`${fieldClass} text-center text-lg tracking-[0.5em]`}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button onClick={handleVerifyCode} disabled={code.length !== 6 || verifying} className="w-full" variant="default">
          {verifying && <LoaderIcon className="size-4 animate-spin" />}
          Verify
        </Button>
        <div className="text-center">
          {resendCountdown > 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">Resend code in {resendCountdown}s</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCode("");
                setError(null);
                void handleSendCode();
              }}
              className="inline-flex min-h-11 items-center text-[13px] underline"
            >
              Resend code
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="name" className="text-[13px] font-medium">
          What is your first name?
        </label>
        <p className="text-sm text-[var(--ink-soft)]">So we know what to call you</p>
        <Input
          id="name"
          type="text"
          placeholder="Your first name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmitName()}
          className={fieldClass}
          autoFocus
        />
      </div>
      <Button onClick={handleSubmitName} disabled={!name.trim() || savingName} className="w-full" variant="default">
        {savingName && <LoaderIcon className="size-4 animate-spin" />}
        Continue
      </Button>
    </div>
  );
}

interface DetailsStepProps {
  salonId: string;
  verificationChannel?: BookingVerificationChannel;
  clientId: string | null;
  clientName: string | null;
  onComplete: (clientId: string, clientName: string, phone?: string) => void;
  onContinue: () => void;
  onNotYou: () => void;
}

/** Name and phone for the public book flow. A signed-in client confirms who they are. */
export function DetailsStep({
  salonId,
  verificationChannel = "phone",
  clientId,
  clientName,
  onComplete,
  onContinue,
  onNotYou,
}: DetailsStepProps) {
  const t = useT("booking");
  const [phase, setPhase] = useState<"input" | "verify">("input");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => setResendCountdown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  const sendCode = useCallback(async () => {
    if (!name.trim() || !phone.trim()) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/booking/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: phone.trim(), phone: phone.trim(), salonId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(res.status === 429 ? "Too many attempts. Please try again later." : data.error || "Failed to send code");
        return;
      }
      setPhase("verify");
      setResendCountdown(60);
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }, [name, phone, salonId]);

  const verifyCode = useCallback(async () => {
    if (code.length !== 6) return;
    setError(null);
    setVerifying(true);
    try {
      const res = await fetch("/api/booking/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: phone.trim(),
          code,
          phone: phone.trim(),
          name: name.trim(),
          salonId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid code");
        setCode("");
        return;
      }
      notifyNativeAuthSuccess();
      const resolvedName = data.isReturning ? data.name : name.trim();
      identifyPostHogUser(data.clientId, { name: resolvedName });
      onComplete(data.clientId, resolvedName, phone.trim());
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  }, [code, name, onComplete, phone, salonId]);

  if (clientId && clientName) {
    return (
      <div className="space-y-4">
        <h2 className="display text-3xl text-[var(--ink)]">{t("detailsStep.title")}</h2>
        <p className="text-base text-[var(--ink)]">{clientName}</p>
        <button type="button" onClick={onNotYou} className="inline-flex min-h-11 items-center text-[13px] underline">
          {t("detailsStep.notYou")}
        </button>
        <Button type="button" className="w-full" onClick={onContinue}>
          {t("detailsStep.continue")}
        </Button>
      </div>
    );
  }

  if (verificationChannel === "email") {
    return (
      <div className="space-y-4">
        <h2 className="display text-3xl text-[var(--ink)]">{t("detailsStep.title")}</h2>
        <IdentityStep salonId={salonId} showPhoneField={false} onComplete={onComplete} />
      </div>
    );
  }

  if (phase === "verify") {
    return (
      <div className="space-y-4">
        <h2 className="display text-3xl text-[var(--ink)]">{t("detailsStep.title")}</h2>
        <div className="space-y-2">
          <Label htmlFor="details-code">{t("detailsStep.code")}</Label>
          <p className="text-sm text-[var(--ink-soft)]">{t("detailsStep.codeSent", { phone })}</p>
          <Input
            id="details-code"
            ref={codeInputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            aria-label={t("detailsStep.code")}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && verifyCode()}
            className="min-h-11 text-center text-lg tracking-[0.5em]"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="button" className="w-full" disabled={code.length !== 6 || verifying} onClick={verifyCode}>
          {verifying && <LoaderIcon className="size-4 animate-spin" />}
          {t("detailsStep.verify")}
        </Button>
        {resendCountdown > 0 ? (
          <p className="text-center text-sm text-[var(--ink-soft)]">{t("detailsStep.resendIn", { seconds: resendCountdown })}</p>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCode("");
              setError(null);
              void sendCode();
            }}
            className="inline-flex min-h-11 w-full items-center justify-center text-[13px] underline"
          >
            {t("detailsStep.resend")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="display text-3xl text-[var(--ink)]">{t("detailsStep.title")}</h2>
      <div className="space-y-2">
        <Label htmlFor="details-name">{t("detailsStep.name")}</Label>
        <Input
          id="details-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="details-phone">{t("detailsStep.phone")}</Label>
        <Input
          id="details-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="min-h-11"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" className="w-full" disabled={!name.trim() || !phone.trim() || sending} onClick={sendCode}>
        {sending && <LoaderIcon className="size-4 animate-spin" />}
        {t("detailsStep.sendCode")}
      </Button>
    </div>
  );
}
