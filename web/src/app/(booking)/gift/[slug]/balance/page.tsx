import type { Metadata } from "next";
import { getT } from "@/lib/terms/server";
import { BalanceClient } from "./balance-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gift card balance · Uptempo",
  robots: { index: false, follow: false },
};

export default async function GiftCardBalancePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getT("giftCards", slug);
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="display text-4xl text-[var(--ink)]">{t("balance.title")}</h1>
      <BalanceClient slug={slug} />
    </div>
  );
}
