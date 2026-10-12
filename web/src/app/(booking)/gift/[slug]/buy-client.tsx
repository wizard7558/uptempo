"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/terms/client";
import { startGiftCardPurchase } from "@/actions/gift-cards-public";

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function BuyClient({ slug, presets }: { slug: string; presets: readonly number[] }) {
  const t = useT("giftCards");
  const [preset, setPreset] = useState<number | null>(presets[1] ?? presets[0] ?? null);
  const [custom, setCustom] = useState("");
  const [purchaserName, setPurchaserName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function amountCents(): number | null {
    if (custom.trim() !== "") {
      const dollars = Number(custom);
      if (!Number.isFinite(dollars)) return null;
      return Math.round(dollars * 100);
    }
    return preset;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = amountCents();
    if (cents == null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startGiftCardPurchase(slug, {
        amountCents: cents,
        purchaserName,
        purchaserEmail,
        recipientName,
        recipientEmail,
        message,
        website,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    } catch {
      setError(t("public.notAvailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-base text-[var(--ink)]">{t("public.amount")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {presets.map((cents) => (
            <Button
              key={cents}
              type="button"
              variant={preset === cents && custom.trim() === "" ? "default" : "outline"}
              className="h-12"
              aria-pressed={preset === cents && custom.trim() === ""}
              onClick={() => {
                setPreset(cents);
                setCustom("");
              }}
            >
              {dollars(cents)}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="gc-custom">{t("public.custom")}</Label>
          <Input
            id="gc-custom"
            inputMode="decimal"
            className="h-12"
            placeholder="50"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <p className="text-sm text-[var(--ink-soft)]">{t("public.customHint")}</p>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="gc-your-name">{t("public.yourName")}</Label>
        <Input id="gc-your-name" className="h-12" value={purchaserName} onChange={(e) => setPurchaserName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gc-your-email">{t("public.yourEmail")}</Label>
        <Input id="gc-your-email" type="email" className="h-12" value={purchaserEmail} onChange={(e) => setPurchaserEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gc-to-name">{t("public.toName")}</Label>
        <Input id="gc-to-name" className="h-12" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gc-to-email">{t("public.toEmail")}</Label>
        <Input id="gc-to-email" type="email" className="h-12" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gc-message">{t("public.message")}</Label>
        <Input id="gc-message" className="h-12" maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
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
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-12 w-full">
        {t("public.continue")}
      </Button>
      <p>
        <Link href={`/gift/${slug}/balance`} className="text-base underline">
          {t("public.checkBalance")}
        </Link>
      </p>
    </form>
  );
}
