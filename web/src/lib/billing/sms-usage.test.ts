import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => false }));

import { hasMeteredItem, reportSmsUsage } from "./sms-usage";

function sub(...lookupKeys: Array<string | null>): Stripe.Subscription {
  return {
    items: { data: lookupKeys.map((k) => ({ price: { lookup_key: k } })) },
  } as unknown as Stripe.Subscription;
}

describe("hasMeteredItem", () => {
  it("is true when the metered texts price is on the subscription", () => {
    expect(hasMeteredItem(sub("hosted_base_monthly", "hosted_texts_metered"))).toBe(true);
  });

  it("is false without the metered price", () => {
    expect(hasMeteredItem(sub("hosted_base_monthly", null))).toBe(false);
    expect(hasMeteredItem(sub())).toBe(false);
  });
});

describe("reportSmsUsage date validation", () => {
  it.each(["2030-1-5", "2030-02-30", "yesterday", "", "2030-13-01", "2030-01-01T00:00:00Z"])(
    "rejects %j",
    async (bad) => {
      await expect(reportSmsUsage(bad)).rejects.toThrow(/Invalid usage date/);
    },
  );
});
