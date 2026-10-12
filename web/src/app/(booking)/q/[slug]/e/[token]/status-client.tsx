"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePolling } from "@/hooks/use-polling";
import { useT } from "@/lib/terms/client";
import { leaveQueue } from "@/actions/queue-public";

export type QueueEntryView = {
  status: "waiting" | "called" | "in_service" | "done" | "left" | "notfound";
  position: number | null;
  waitMinutes: number | null;
  staffName: string | null;
  businessName: string;
};

const SOON_MINUTES = 5;

type WaitingPlace =
  | { key: "status.place"; position: number; minutes: number }
  | { key: "status.placeSoon" | "status.placeUnknown"; position: number };

/** One sentence for a waiting place. A short wait says it is almost their turn. */
export function waitingPlace(position: number, waitMinutes: number | null): WaitingPlace {
  if (waitMinutes === null) return { key: "status.placeUnknown", position };
  if (waitMinutes <= SOON_MINUTES) return { key: "status.placeSoon", position };
  return { key: "status.place", position, minutes: waitMinutes };
}

export function PlaceLine({ position, waitMinutes }: { position: number; waitMinutes: number | null }) {
  const t = useT("queue");
  const place = waitingPlace(position, waitMinutes);
  const text =
    place.key === "status.place"
      ? t(place.key, { position: place.position, minutes: place.minutes })
      : t(place.key, { position: place.position });
  return (
    <p role="status" className="display text-3xl text-[var(--ink)] sm:text-4xl">
      {text}
    </p>
  );
}

async function load(slug: string, token: string): Promise<QueueEntryView> {
  const res = await fetch(`/api/q/${slug}/entry?t=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (res.status === 404) {
    return { status: "notfound", position: null, waitMinutes: null, staffName: null, businessName: "" };
  }
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as QueueEntryView;
}

export const isFinalStatus = (d: Pick<QueueEntryView, "status">) =>
  d.status === "done" || d.status === "left" || d.status === "notfound";

const headline = "display text-3xl text-[var(--ink)] sm:text-4xl";

export function StatusClient({
  slug,
  token,
  initial,
}: {
  slug: string;
  token: string;
  initial?: QueueEntryView;
}) {
  const t = useT("queue");
  const { data, error } = usePolling(() => load(slug, token), { intervalMs: 15000, stop: isFinalStatus });
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leftNow, setLeftNow] = useState(false);

  const shown = data ?? initial ?? null;
  const status = leftNow ? "left" : shown?.status;
  const canLeave = status === "waiting" || status === "called";

  async function leave() {
    setLeaving(true);
    try {
      await leaveQueue(slug, token);
      setLeftNow(true);
      setConfirming(false);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="space-y-6 text-center">
      <h1 className={headline}>{shown?.businessName || t("status.heading")}</h1>
      {/* Always mounted so a screen reader hears the change to "called". */}
      <div aria-live="polite" className="space-y-3">
        {status === "waiting" && shown?.position != null && (
          <>
            <PlaceLine position={shown.position} waitMinutes={shown.waitMinutes} />
            <p className="text-base text-[var(--ink)]">{t("status.keepOpen")}</p>
            <p className="text-sm text-[var(--ink)]">{t("status.note")}</p>
          </>
        )}
        {status === "called" && (
          <>
            <p className={headline}>{t("status.called")}</p>
            {shown?.staffName && (
              <p className="text-xl text-[var(--ink)]">{t("status.calledWith", { name: shown.staffName })}</p>
            )}
          </>
        )}
        {status === "in_service" && <p className={headline}>{t("status.inService")}</p>}
        {status === "done" && <p className={headline}>{t("status.done")}</p>}
        {status === "left" && <p className={headline}>{t("status.left")}</p>}
        {status === "notfound" && <p className="text-xl text-[var(--ink)]">{t("status.notFound")}</p>}
        {error && !shown && <p className="text-base text-[var(--ink)]">{t("status.notFound")}</p>}
      </div>
      {canLeave && (
        <Button type="button" variant="outline" className="h-12 w-full" onClick={() => setConfirming(true)}>
          {t("status.leave")}
        </Button>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("status.leaveConfirm")}</DialogTitle>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:flex-col">
            <Button type="button" className="h-12 w-full" onClick={() => setConfirming(false)}>
              {t("status.leaveNo")}
            </Button>
            <Button type="button" variant="outline" className="h-12 w-full" disabled={leaving} onClick={leave}>
              {t("status.leaveYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
