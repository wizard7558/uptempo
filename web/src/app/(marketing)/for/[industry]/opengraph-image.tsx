import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OG_SIZE, renderOgImage } from "@/lib/brand/og-image";
import { industryFromSlug, industrySlug, marketingIndustries } from "@/lib/marketing/industries";

export const alt = "Uptempo Bookings";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return marketingIndustries().map((industry) => ({ industry: industrySlug(industry.id) }));
}

export default async function IndustryOpengraphImage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const industry = industryFromSlug((await params).industry);
  if (!industry) notFound();
  const t = await getTranslations("marketing.industries");
  return renderOgImage(`${t(`${industry.id}.title`)}.`);
}
