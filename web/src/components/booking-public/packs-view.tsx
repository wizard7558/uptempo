"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IdentityStep } from "@/components/booking-public/details-step";
import { PaymentStep } from "@/components/booking-public/confirm-pay-step";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";
import { buyPackage, type PublicPackage } from "@/actions/packages";

interface Props {
  salonId: string;
  salonName: string;
  packs: PublicPackage[];
  signedIn: boolean;
}

export function PacksView({ salonId, salonName, packs, signedIn: initiallySignedIn }: Props) {
  const t = useT("packages");
  const [signedIn, setSignedIn] = useState(initiallySignedIn);
  /** The pack the client picked; kept while they sign in or add a card. */
  const [picked, setPicked] = useState<string | null>(null);
  const [needsCard, setNeedsCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<number | null>(null);

  /** Buys the pack with the card on file; asks for a card first when there is none. */
  async function run(packageId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await buyPackage(packageId);
      if (res.success) {
        setBought(res.count);
        setNeedsCard(false);
      } else if (res.needsCard) {
        setNeedsCard(true);
      } else {
        setNeedsCard(false);
        setError(res.error ?? t("errors.generic"));
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  function pick(packageId: string) {
    setPicked(packageId);
    if (signedIn) void run(packageId);
  }

  const header = (
    <div className="text-center">
      <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{salonName}</h1>
      <p className="mt-1 text-sm font-light text-[var(--ink)]">{t("publicSubtitle")}</p>
    </div>
  );

  if (bought !== null) {
    return (
      <div className="space-y-6">
        {header}
        <div className="space-y-2 border border-[var(--line)] bg-[var(--ivory-raised)] p-6 text-center">
          <p role="status" className="display text-2xl text-[var(--ink)]">
            {t("bought", { count: bought })}
          </p>
        </div>
      </div>
    );
  }

  if (picked && !signedIn) {
    return (
      <div className="space-y-6">
        {header}
        <h2 className="display text-2xl text-[var(--ink)]">{t("signInFirst")}</h2>
        <IdentityStep
          salonId={salonId}
          onComplete={() => {
            setSignedIn(true);
            // Carry on with the pack they picked.
            void run(picked);
          }}
        />
      </div>
    );
  }

  if (picked && needsCard) {
    return (
      <div className="space-y-6">
        {header}
        <h2 className="display text-2xl text-[var(--ink)]">{t("cardNeeded")}</h2>
        <PaymentStep
          submitLabel={t("saveCardAndBuy")}
          onComplete={() => {
            setNeedsCard(false);
            void run(picked);
          }}
        />
        <Button type="button" variant="outline" className="h-11" onClick={() => { setNeedsCard(false); setPicked(null); }}>
          {t("cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {packs.length === 0 ? (
        <p className="text-center text-sm font-light text-[var(--ink)]">{t("publicNone")}</p>
      ) : (
        <ul className="space-y-3">
          {packs.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 border border-[var(--line)] bg-[var(--ivory-raised)] p-4"
            >
              <div className="min-w-0">
                <p className="display text-xl text-[var(--ink)]">{p.name}</p>
                {p.description && <p className="text-sm font-light text-[var(--ink)]">{p.description}</p>}
                <p className="text-sm text-[var(--ink)]">
                  {t("summary", { credits: p.credits, price: formatCurrency(p.priceCents) })}
                </p>
                <p className="text-sm text-[var(--ink)]">
                  {p.validDays === null ? t("neverExpires") : t("goodFor", { days: p.validDays })}
                </p>
              </div>
              <Button
                type="button"
                
                variant="default"
                disabled={busy}
                onClick={() => pick(p.id)}
              >
                {busy && picked === p.id ? t("buying") : t("buy")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
