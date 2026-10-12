import { notFound } from "next/navigation";
import { getGiftCardShopInfo } from "@/actions/gift-cards-public";
import { salonPageMetadata } from "@/lib/seo/tenant-metadata";
import { getT } from "@/lib/terms/server";
import { BuyClient } from "./buy-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return salonPageMetadata(slug, (salonName) => ({
    title: `Gift cards from ${salonName}`,
    description: `Send a gift card by email.`,
  }));
}

export default async function GiftCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const info = await getGiftCardShopInfo(slug);
  if (!info) notFound();
  const t = await getT("giftCards", slug);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="display text-4xl text-[var(--ink)]">
        {t("public.title", { business: info.businessName })}
      </h1>
      {info.available ? (
        <>
          <p className="mt-2 text-base text-[var(--ink-soft)]">{t("public.subtitle")}</p>
          <BuyClient slug={slug} presets={info.presets} />
        </>
      ) : (
        <p className="mt-4 text-base text-[var(--ink)]">{t("public.notAvailable")}</p>
      )}
    </div>
  );
}
