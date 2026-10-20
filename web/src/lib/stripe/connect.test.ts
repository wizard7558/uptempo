import { beforeEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({
  accounts: {
    create: vi.fn(async () => ({ id: "acct_new" })),
    update: vi.fn(async () => ({ id: "acct_old" })),
  },
}));

vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => stripe,
}));

import { createConnectAccount, setWeeklyPayouts } from "./connect";

const weekly = { interval: "weekly", weekly_anchor: "monday" };

describe("Connect payout schedule", () => {
  beforeEach(() => {
    stripe.accounts.create.mockClear();
    stripe.accounts.update.mockClear();
  });

  it("creates new accounts on a weekly Monday payout", async () => {
    await createConnectAccount({
      email: "owner@example.com",
      businessName: "Test Salon",
      tenantSlug: "test-salon",
    });
    expect(stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { payouts: { schedule: weekly } },
        controller: expect.objectContaining({
          fees: { payer: "application" },
        }),
      }),
    );
  });

  it("updates only the payout schedule on an existing account", async () => {
    await setWeeklyPayouts("acct_old");
    expect(stripe.accounts.update).toHaveBeenCalledWith(
      "acct_old",
      { settings: { payouts: { schedule: weekly } } },
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
  });
});
