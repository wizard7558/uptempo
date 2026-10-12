import type { Metadata } from "next";
import { getGiftCardPurchaseStatus } from "@/actions/gift-cards-public";
import { getT } from "@/lib/terms/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gift card · Uptempo",
  robots: { index: false, follow: false },
};

export default async function GiftCardSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { slug } = await params;
  const { session_id } = await searchParams;
  const t = await getT("giftCards", slug);
  const status = session_id ? await getGiftCardPurchaseStatus(slug, session_id) : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16 text-center sm:px-6">
      {status?.paid ? (
        <>
          <h1 className="display text-4xl text-[var(--ink)]">{t("public.successTitle")}</h1>
          <p className="mt-3 text-base text-[var(--ink-soft)]">
            {t("public.successBody", { email: status.recipientEmailMasked })}
          </p>
        </>
      ) : (
        <h1 className="display text-3xl text-[var(--ink)]">{t("public.pending")}</h1>
      )}
    </div>
  );
}
