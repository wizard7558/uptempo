import { notFound } from "next/navigation";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { getT } from "@/lib/terms/server";
import { getQueueJoinInfo } from "@/actions/queue-public";
import { KioskClient } from "./kiosk-client";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export default async function QueueKioskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ k?: string; l?: string }>;
}) {
  const { slug } = await params;
  const { k, l } = await searchParams;
  if (!SLUG_RE.test(slug) || !(await isTenantProvisioned(slug))) notFound();

  const first = await getQueueJoinInfo(slug, null, k);
  if (!first.success) notFound();
  const t = await getT("queue", slug);
  if (!first.kioskValid || !k) {
    return <p className="text-center text-xl">{t("kiosk.invalidLink")}</p>;
  }
  const locationId = first.locations.find((x) => x.id === l)?.id ?? first.locations[0]?.id ?? null;
  const info = locationId ? await getQueueJoinInfo(slug, locationId, k) : first;
  if (!info.success) notFound();
  return <KioskClient slug={slug} kioskToken={k} initial={info} locationId={locationId} />;
}
