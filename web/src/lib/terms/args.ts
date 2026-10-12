import type { Term, VerticalTerms } from "@/lib/verticals";

export type TermArgs = Record<string, string>;

const TERM_KEYS = ["staff", "customer", "booking", "offering", "place"] as const;

function lower(value: string): string {
  return value.toLocaleLowerCase();
}

/** Lowercases the whole value, then uppercases only its first character. */
function capitalize(value: string): string {
  const l = lower(value);
  const first = Array.from(l)[0] ?? "";
  return first.toLocaleUpperCase() + l.slice(first.length);
}

function capitalizeKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Flat record of terminology values for ICU interpolation, e.g.
 * `{staff}`, `{staffPlural}`, `{Staff}`, `{StaffPlural}` for each term, plus
 * `{prepaidBalance}`. Lowercase variants lowercase the whole stored value;
 * capitalized variants uppercase only the first character.
 */
export function termArgs(terms: VerticalTerms): TermArgs {
  const args: TermArgs = {};
  for (const key of TERM_KEYS) {
    const term: Term = terms[key];
    args[key] = lower(term.one);
    args[`${key}Plural`] = lower(term.other);
    args[capitalizeKey(key)] = capitalize(term.one);
    args[`${capitalizeKey(key)}Plural`] = capitalize(term.other);
  }
  args.prepaidBalance = terms.prepaidBalance;
  return args;
}

/** Merges term args under explicit values; explicit values win. */
export function mergeTermValues<V extends Record<string, unknown>>(
  terms: VerticalTerms,
  values?: V,
): TermArgs & V {
  return { ...termArgs(terms), ...(values ?? {}) } as TermArgs & V;
}
