import { getBaseUrl } from "@/lib/utils";

/**
 * Base URL (no trailing slash) for links sent to a business's clients: form
 * links, quote links. Every tenant is served from the same app origin today
 * (tenancy comes from the path or the custom domain), so the slug is part of
 * the signature for the day that changes.
 */
export function tenantPublicBaseUrl(slug: string): string {
  void slug;
  return getBaseUrl().replace(/\/+$/, "");
}
