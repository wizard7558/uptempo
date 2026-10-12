"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/terms/client";
import { checkGiftCardBalance } from "@/actions/gift-cards-public";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BalanceClient({ slug }: { slug: string }) {
  const t = useT("giftCards");
  const [code, setCode] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ last4: string; balanceCents: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const found = await checkGiftCardBalance(slug, code, website);
      if (!found.success) {
        setError(found.error);
        return;
      }
      setResult({ last4: found.last4, balanceCents: found.balanceCents });
    } catch {
      setError(t("public.notAvailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="gc-code">{t("balance.code")}</Label>
        <Input
          id="gc-code"
          className="h-12"
          autoComplete="off"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <p className="text-sm text-[var(--ink-soft)]">{t("balance.codeHint")}</p>
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
      {result && (
        <div role="status" className="space-y-1">
          <p className="text-base text-[var(--ink)]">
            {t("balance.result", { amount: money(result.balanceCents) })}
          </p>
          <p className="text-sm text-[var(--ink-soft)]">
            {t("balance.endingIn", { last4: result.last4 })}
          </p>
        </div>
      )}
      <Button type="submit" disabled={busy} className="h-12 w-full">
        {t("balance.check")}
      </Button>
    </form>
  );
}
