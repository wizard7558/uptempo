import { getTenantBySlug } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { getVertical } from "@/lib/verticals";

export type PublicBookingFlow = "book" | "request" | "class";

/**
 * Which public flow the business's book page should open with. The pack names
 * its preferred flow; it only takes effect when the matching module is on.
 */
export async function getPublicBookingFlow(slug: string): Promise<PublicBookingFlow> {
  const tenant = await getTenantBySlug(slug);
  const preferred = getVertical(tenant?.industry).bookingFlow;
  if (preferred === "request" && (await hasModule(slug, "requests"))) return "request";
  if (preferred === "class" && (await hasModule(slug, "classes"))) return "class";
  return "book";
}
