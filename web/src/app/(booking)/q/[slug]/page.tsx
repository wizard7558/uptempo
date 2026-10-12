import { notFound } from "next/navigation";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { getT } from "@/lib/terms/server";
import { getQueueJoinInfo } from "@/actions/queue-public";
import { JoinClient } from "./join-client";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export default async function QueueJoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ l?: string }>;
}) {
  const { slug } = await params;
  const { l } = await searchParams;
  if (!SLUG_RE.test(slug) || !(await isTenantProvisioned(slug))) notFound();

  const first = await getQueueJoinInfo(slug, null);
  if (!first.success) notFound();
  const locationId =
    first.locations.find((x) => x.id === l)?.id ?? first.locations[0]?.id ?? null;
  const info = locationId ? await getQueueJoinInfo(slug, locationId) : first;
  if (!info.success) notFound();

  const t = await getT("queue", slug);
  if (!info.open || info.full) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{info.businessName || t("join.title")}</h1>
        {info.businessName ? <p className="text-base text-[var(--ink)]">{t("join.title")}</p> : null}
        <p className="text-base text-[var(--ink)]" role="status">
          {t(info.open ? "join.full" : "join.closed")}
        </p>
      </div>
    );
  }
  return <JoinClient slug={slug} info={info} locationId={locationId} />;
}
