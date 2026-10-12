"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/use-polling";
import { useT } from "@/lib/terms/client";
import { getQueueJoinInfo, type QueueJoinInfo } from "@/actions/queue-public";
import { JoinForm, type JoinedResult } from "../join-client";
import { PlaceLine } from "../e/[token]/status-client";

const RESET_MS = 10_000;

export function KioskClient({
  slug,
  kioskToken,
  initial,
  locationId,
}: {
  slug: string;
  kioskToken: string;
  initial: QueueJoinInfo;
  locationId: string | null;
}) {
  const t = useT("queue");
  const router = useRouter();
  const [joined, setJoined] = useState<JoinedResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  const { data } = usePolling(
    async () => {
      const res = await getQueueJoinInfo(slug, locationId, kioskToken);
      if (!res.success) throw new Error(res.error);
      return res;
    },
    { intervalMs: 15000 },
  );
  const info = data ?? initial;

  const next = () => {
    setJoined(null);
    setFormKey((k) => k + 1);
  };

  // Show the result for 10 seconds, then get ready for the next person.
  useEffect(() => {
    if (!joined) return;
    const timer = setTimeout(next, RESET_MS);
    return () => clearTimeout(timer);
  }, [joined]);

  return (
    <div className="grid gap-8 text-lg md:grid-cols-[1fr_16rem]">
      <div className="space-y-6">
        <h1 className="display text-4xl text-[var(--ink)]">{t("kiosk.title")}</h1>
        {!info.open || info.full ? (
          <p role="status" className="text-xl text-[var(--ink)]">
            {t(info.open ? "join.full" : "join.closed")}
          </p>
        ) : joined ? (
          <div className="space-y-4" aria-live="polite">
            <PlaceLine position={joined.position} waitMinutes={joined.waitMinutes} />
            <Button type="button" className="h-14 w-full text-lg" onClick={next}>
              {t("kiosk.next")}
            </Button>
          </div>
        ) : (
          <JoinForm
            key={formKey}
            slug={slug}
            info={info}
            locationId={locationId}
            kioskToken={kioskToken}
            big
            onJoined={setJoined}
            onLocationChange={(id) => router.replace(`/q/${slug}/kiosk?k=${encodeURIComponent(kioskToken)}&l=${id}`)}
          />
        )}
      </div>
      <aside className="space-y-3 border-t border-[var(--line)] pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
        <h2 className="display text-2xl text-[var(--ink)]">{t("kiosk.nowWaiting")}</h2>
        <p className="text-base text-[var(--ink)]">{t("join.currentWait", { count: info.waitingCount })}</p>
        <ol className="space-y-2">
          {info.waitingNames.map((w) => (
            <li key={w.position} className="flex gap-3 text-xl">
              <span className="w-8 font-medium">{w.position}</span>
              <span>{w.name}</span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
