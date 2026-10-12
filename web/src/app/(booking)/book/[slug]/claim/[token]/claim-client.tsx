"use client";

import { useState } from "react";
import {
  claimWaitlistOffer,
  declineWaitlistOffer,
  leaveSlotWaitlist,
  type ClaimOffer,
} from "@/actions/slot-waitlist-public";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/terms/client";

type View = ClaimOffer["state"] | "taken" | "declined";

export function ClaimClient({ token, offer }: { token: string; offer: ClaimOffer }) {
  const t = useT("waitlist");
  const [view, setView] = useState<View>(offer.state);
  const [busy, setBusy] = useState(false);

  async function book() {
    setBusy(true);
    const result = await claimWaitlistOffer(token);
    setBusy(false);
    setView(result.status === "booked" ? "booked" : result.status === "taken" ? "taken" : result.status);
  }

  async function decline() {
    setBusy(true);
    const result = await declineWaitlistOffer(token);
    setBusy(false);
    setView(result.status === "declined" ? "declined" : "expired");
  }

  async function leave() {
    setBusy(true);
    const result = await leaveSlotWaitlist(token);
    setBusy(false);
    setView(result.status === "removed" ? "removed" : "notFound");
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      {view === "valid" && offer.state === "valid" && (
        <>
          <h1 className="text-2xl font-bold">{t("claim.title")}</h1>
          <p>
            {t("claim.details", {
              service: offer.service,
              staff: offer.staff,
              date: offer.date,
              time: offer.time,
            })}
          </p>
          <p>{t("claim.heldUntil", { time: offer.heldUntil })}</p>
          <p className="text-sm text-muted-foreground">{t("claim.noDeposit")}</p>
          <Button type="button" className="h-12 w-full" disabled={busy} onClick={() => void book()}>
            {t("claim.book")}
          </Button>
          <Button type="button" variant="outline" className="h-12 w-full" disabled={busy} onClick={() => void decline()}>
            {t("claim.decline")}
          </Button>
          <button type="button" className="text-sm underline" disabled={busy} onClick={() => void leave()}>
            {t("claim.remove")}
          </button>
        </>
      )}
      {view === "booked" && <h1 className="text-2xl font-bold">{t("claim.booked")}</h1>}
      {view === "expired" && <h1 className="text-2xl font-bold">{t("claim.expired")}</h1>}
      {view === "taken" && <h1 className="text-2xl font-bold">{t("claim.taken")}</h1>}
      {view === "declined" && <h1 className="text-2xl font-bold">{t("claim.declined")}</h1>}
      {view === "removed" && <h1 className="text-2xl font-bold">{t("claim.removed")}</h1>}
      {view === "notFound" && <h1 className="text-2xl font-bold">{t("claim.notFound")}</h1>}
    </main>
  );
}
