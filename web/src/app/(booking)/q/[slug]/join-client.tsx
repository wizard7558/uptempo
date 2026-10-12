"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/lib/terms/client";
import { cn } from "@/lib/utils";
import { joinQueue, type QueueJoinInfo } from "@/actions/queue-public";
import { StatusClient } from "./e/[token]/status-client";

export type JoinedResult = { token: string; position: number; waitMinutes: number | null };

type Props = {
  slug: string;
  info: QueueJoinInfo;
  locationId: string | null;
  /** The kiosk token; makes the join count as a kiosk join. */
  kioskToken?: string;
  /** Kiosk mode: bigger text and h-14 controls, and the caller shows the result. */
  big?: boolean;
  onJoined?: (r: JoinedResult) => void;
  onLocationChange?: (id: string) => void;
};

function rethrowAuthError(error: unknown): void {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AuthError") {
    throw error;
  }
}

/** The join form, shared by the phone page and the front-desk kiosk. */
export function JoinForm({ slug, info, locationId, kioskToken, big, onJoined, onLocationChange }: Props) {
  const t = useT("queue");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const control = big ? "h-14 text-lg" : "h-12 text-base";
  const label = big ? "text-lg" : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinQueue({
        slug,
        locationId,
        name,
        phone,
        serviceId: serviceId || null,
        preferredStaffId: staffId || null,
        smsConsent: consent,
        kioskToken,
        website,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onJoined?.({ token: res.token, position: res.position, waitMinutes: res.waitMinutes });
    } catch (caught) {
      rethrowAuthError(caught);
      setError(t("join.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={cn("space-y-5", big && "text-lg")}>
      {info.locations.length >= 2 && (
        <div className="space-y-2">
          <Label htmlFor="q-location" className={label}>
            {t("join.location")}
          </Label>
          <NativeSelect
            id="q-location"
            className={control}
            value={locationId ?? ""}
            onChange={(e) => onLocationChange?.(e.target.value)}
          >
            {info.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="q-name" className={label}>
          {t("join.nameLabel")}
        </Label>
        <Input
          id="q-name"
          className={control}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={80}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="q-phone" className={label}>
          {t("join.phoneLabel")}
        </Label>
        <Input
          id="q-phone"
          type="tel"
          inputMode="tel"
          className={control}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          required
        />
        <p className="text-sm text-[var(--ink)]">{t("join.phoneHint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="q-service" className={label}>
          {t("join.serviceLabel")}
        </Label>
        <NativeSelect id="q-service" className={control} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">{t("join.serviceAny")}</option>
          {info.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="q-staff" className={label}>
          {t("join.staffLabel")}
        </Label>
        <NativeSelect id="q-staff" className={control} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">{t("join.staffAny")}</option>
          {info.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox id="q-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
        <Label htmlFor="q-consent" className={cn("font-normal leading-snug", big ? "text-lg" : "text-base")}>
          {t("join.consentLabel")}
        </Label>
      </div>
      {/* Honeypot: people never see or fill this. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-base text-[var(--ink)]">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className={cn("w-full", big ? "h-14 text-lg" : "h-12")}>
        {busy ? t("join.submitting") : t("join.submit")}
      </Button>
    </form>
  );
}

export function JoinClient({ slug, info, locationId }: { slug: string; info: QueueJoinInfo; locationId: string | null }) {
  const t = useT("queue");
  const router = useRouter();
  const [joined, setJoined] = useState<JoinedResult | null>(null);

  if (joined) {
    return (
      <StatusClient
        slug={slug}
        token={joined.token}
        initial={{
          status: "waiting",
          position: joined.position,
          waitMinutes: joined.waitMinutes,
          staffName: null,
          businessName: info.businessName,
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{info.businessName || t("join.title")}</h1>
        {info.businessName ? <p className="mt-2 text-base text-[var(--ink)]">{t("join.title")}</p> : null}
      </div>
      <p className="text-base text-[var(--ink)]">{t("join.subtitle")}</p>
      <div className="space-y-1 text-center text-base text-[var(--ink)]" role="status">
        <p>{t("join.currentWait", { count: info.waitingCount })}</p>
        <p>
          {info.waitNowMinutes === null
            ? t("join.waitUnknown")
            : t("join.waitNow", { minutes: info.waitNowMinutes })}
        </p>
      </div>
      <p className="text-sm text-[var(--ink)]">{t("join.notABooking")}</p>
      <JoinForm
        slug={slug}
        info={info}
        locationId={locationId}
        onJoined={(r) => {
          // Keep this screen mounted. A refresh and the text link open the status URL.
          window.history.replaceState(null, "", `/q/${slug}/e/${r.token}`);
          setJoined(r);
        }}
        onLocationChange={(id) => router.replace(`/q/${slug}?l=${id}`)}
      />
    </div>
  );
}
