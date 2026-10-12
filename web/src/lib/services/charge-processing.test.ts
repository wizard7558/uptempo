import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({ paymentIntents: { create } }),
}));

import { calculatePlatformFee, processOffSessionCharge } from "./charge-processing";

const params = {
  amountCents: 5000,
  stripeCustomerId: "cus_1",
  stripePaymentMethodId: "pm_1",
  metadata: {},
};

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: "pi_real", status: "succeeded" });
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("PAYMENTS_FAKE seam", () => {
  it("returns a completed fake charge without calling Stripe", async () => {
    vi.stubEnv("PAYMENTS_FAKE", "1");
    const r = await processOffSessionCharge(params);
    expect(r.status).toBe("completed");
    expect(r.stripePaymentIntentId).toMatch(/^pi_fake_/);
    expect(r.failureReason).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("is ignored when VERCEL_ENV is production", async () => {
    vi.stubEnv("PAYMENTS_FAKE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const r = await processOffSessionCharge(params);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.stripePaymentIntentId).toBe("pi_real");
  });

  it("is ignored when NODE_ENV is production", async () => {
    vi.stubEnv("PAYMENTS_FAKE", "1");
    vi.stubEnv("NODE_ENV", "production");
    await processOffSessionCharge(params);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is off unless PAYMENTS_FAKE is exactly 1", async () => {
    await processOffSessionCharge(params);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("idempotency key", () => {
  it("is sent to Stripe as a request option", async () => {
    await processOffSessionCharge({ ...params, idempotencyKey: "pack-sale:k1" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000 }), {
      idempotencyKey: "pack-sale:k1",
    });
  });

  it("is left off when not given", async () => {
    await processOffSessionCharge(params);
    expect(create.mock.calls[0]).toHaveLength(1);
  });
});

describe("calculatePlatformFee", () => {
  it("is 0 in single mode", () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    expect(
      calculatePlatformFee(10_000, { plan: "business", platformFeePercent: 2 }),
    ).toBe(0);
  });

  it("uses the plan percent in multi mode", () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    expect(calculatePlatformFee(10_000, { plan: "pro" })).toBe(100);
  });
});
