import {
  BASE_CENTS,
  EXTRA_STAFF_CENTS,
  HOSTED_BASE_MONTHLY_LOOKUP_KEY,
  HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY,
  HOSTED_TEXT_LINE_MONTHLY_LOOKUP_KEY,
  HOSTED_TEXT_LINE_SETUP_LOOKUP_KEY,
  HOSTED_TEXTS_METERED_LOOKUP_KEY,
  PER_TEXT_CENTS,
  TEXT_LINE_CENTS,
  TEXT_SETUP_CENTS,
} from "@/lib/billing/hosted-pricing";

/** metadata.purpose on the hosted plan subscription and its platform customer. */
export const HOSTED_PLAN_PURPOSE = "uptempo_hosted_plan";

/** Billing Meter event name for per-text usage (reported in 6.1d). */
export const TEXTS_METER_EVENT = "uptempo_texts";

export type HostedPriceKind = "licensed" | "metered" | "one_time";

export type HostedPriceSpec = {
  unitAmountCents: number;
  kind: HostedPriceKind;
  productId: string;
  productName: string;
};

/** The Stripe catalog for the hosted plan, keyed by price lookup key. */
export const HOSTED_PRICES: Readonly<Record<string, HostedPriceSpec>> = {
  [HOSTED_BASE_MONTHLY_LOOKUP_KEY]: {
    unitAmountCents: BASE_CENTS,
    kind: "licensed",
    productId: "uptempo_hosted_base",
    productName: "Uptempo plan",
  },
  [HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY]: {
    unitAmountCents: EXTRA_STAFF_CENTS,
    kind: "licensed",
    productId: "uptempo_hosted_extra_staff",
    productName: "Extra staff",
  },
  [HOSTED_TEXT_LINE_MONTHLY_LOOKUP_KEY]: {
    unitAmountCents: TEXT_LINE_CENTS,
    kind: "licensed",
    productId: "uptempo_hosted_text_line",
    productName: "Text line",
  },
  [HOSTED_TEXTS_METERED_LOOKUP_KEY]: {
    unitAmountCents: PER_TEXT_CENTS,
    kind: "metered",
    productId: "uptempo_hosted_texts",
    productName: "Texts",
  },
  [HOSTED_TEXT_LINE_SETUP_LOOKUP_KEY]: {
    unitAmountCents: TEXT_SETUP_CENTS,
    kind: "one_time",
    productId: "uptempo_hosted_text_line_setup",
    productName: "Text line setup",
  },
};
