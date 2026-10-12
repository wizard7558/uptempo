"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useTranslations, type TranslationValues } from "next-intl";
import type { VerticalTerms } from "@/lib/verticals";
import { mergeTermValues } from "./args";

const TermsContext = createContext<VerticalTerms | null>(null);

type LooseTranslate = (key: string, values?: TranslationValues) => string;

export function TermsProvider({
  terms,
  children,
}: {
  terms: VerticalTerms;
  children: ReactNode;
}) {
  return <TermsContext.Provider value={terms}>{children}</TermsContext.Provider>;
}

export function useTerms(): VerticalTerms {
  const terms = useContext(TermsContext);
  if (!terms) throw new Error("useTerms must be used within a TermsProvider");
  return terms;
}

/** Client translator with the tenant's terminology merged into values. */
export function useT(namespace?: string) {
  const t = useTranslations(namespace);
  const terms = useTerms();
  return useCallback(
    (key: string, values?: TranslationValues) =>
      (t as LooseTranslate)(key, mergeTermValues(terms, values) as TranslationValues),
    [t, terms],
  );
}
