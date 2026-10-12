import type { TranslationValues } from "next-intl";
import { getTenantTerms } from "@/lib/tenant/industry";
import { createTermsT } from "./translator";

/**
 * Translator for emails and other places that run outside a Next.js request
 * scope (crons, webhooks, library helpers). `getT` relies on request context;
 * this one takes the tenant slug explicitly and merges that tenant's
 * terminology into values. Callers derive props such as `staffLabel` from the
 * same tenant terms (`getTenantTerms(slug)` -> `staff.one`).
 */
export async function getEmailT(slug: string, ns: string) {
  const terms = await getTenantTerms(slug);
  const t = createTermsT(terms, ns);
  return (key: string, values?: TranslationValues) => t(key, values);
}
