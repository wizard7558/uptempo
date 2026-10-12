import { notFound, redirect } from "next/navigation";
import { isSingleMode } from "@/lib/config/mode";
import { getSingleTenantSlug } from "@/lib/tenant/single";

export const dynamic = "force-dynamic";

export default async function SingleHomePage() {
  if (!isSingleMode()) notFound();
  const slug = await getSingleTenantSlug();
  redirect(slug ? `/book/${slug}` : "/setup");
}
