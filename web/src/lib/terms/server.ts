import { cache } from "react";
import { getTranslations } from "next-intl/server";
import type { TranslationValues } from "next-intl";
import { getTenantSlugOrNull } from "@/lib/tenant/context";
import { getTenantTerms } from "@/lib/tenant/industry";
import { getVertical, type VerticalTerms } from "@/lib/verticals";
import { mergeTermValues } from "./args";

type LooseTranslate = (key: string, values?: TranslationValues) => string;

/**
 * Terms for the current request's tenant (or for `slug` when the caller has
 * already resolved it, e.g. a layout). Falls back to the `general` pack when
 * there is no tenant.
 */
export const getTerms = cache(async (slug?: string | null): Promise<VerticalTerms> => {
  const resolved = slug ?? (await getTenantSlugOrNull());
  if (!resolved) return getVertical("general").terms;
  return getTenantTerms(resolved);
});

/**
 * Server translator with the tenant's terminology merged into values. Pass
 * `slug` when the caller has already resolved the tenant (e.g. a layout).
 */
export async function getT(namespace?: string, slug?: string | null) {
  const [t, terms] = await Promise.all([getTranslations(namespace), getTerms(slug)]);
  return (key: string, values?: TranslationValues) =>
    (t as LooseTranslate)(key, mergeTermValues(terms, values) as TranslationValues);
}
