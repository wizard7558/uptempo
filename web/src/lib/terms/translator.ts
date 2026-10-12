import { createTranslator } from "next-intl";
import type { TranslationValues } from "next-intl";
import messages from "@/i18n/messages/en.json";
import type { VerticalTerms } from "@/lib/verticals";
import { mergeTermValues } from "./args";

type LooseTranslate = (key: string, values?: TranslationValues) => string;

/**
 * Request-independent translator for a known terms pack, e.g. signup flows that
 * already know the industry before a tenant row exists to look up.
 */
export function createTermsT(terms: VerticalTerms, namespace: string) {
  const t = createTranslator({
    locale: "en",
    messages,
    namespace: namespace as "common",
  }) as unknown as LooseTranslate;
  return (key: string, values?: TranslationValues) =>
    t(key, mergeTermValues(terms, values) as TranslationValues);
}
