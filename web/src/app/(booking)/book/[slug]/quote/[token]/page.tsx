import { notFound } from "next/navigation";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { getBusinessBySlugCached } from "@/lib/booking/cached-lookups";
import { getQuoteForPage } from "@/actions/quotes-public";
import { QuoteClient } from "./quote-client";

export const metadata = { title: "Your quote", robots: { index: false, follow: false } };

export default async function QuotePage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const business = await getBusinessBySlugCached(slug);
  if (!business || !(await isTenantProvisioned(slug))) notFound();
  const data = await getQuoteForPage(token);
  return <QuoteClient token={token} data={data} />;
}
