import { beforeEach, describe, expect, it, vi } from "vitest";

const APPT = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const CLIENT = "b2c3d4e5-f6a7-4901-bcde-f12345678901";
const PACK = "c3d4e5f6-a7b8-4012-8def-123456789012";
const PLAN = "d4e5f6a7-b8c9-4123-9efa-234567890123";

type Mode = "hosted" | "comped" | "single";

const state = vi.hoisted(() => ({
  tenant: {
    slug: "test-salon",
    plan: "starter",
    comped: 0,
    processingRateBps: null as number | null,
    stripeConnectAccountId: "acct_test" as string | null,
    platformFeePercent: null as number | null,
  },
  checkout: null as { ok: true; set: Record<string, unknown> } | null,
  appointment: null as Record<string, unknown> | null,
  queues: [] as unknown[][],
  call: 0,
  giftCardsOn: false,
}));

const recordPayment = vi.hoisted(() => ({
  recordServicePayment: vi.fn(async () => ({ ok: true, chargeId: "ch_1" })),
}));

const stripe = vi.hoisted(() => ({
  paymentIntents: {
    create: vi.fn(async (params: { amount?: number }) => ({
      id: "pi_1",
      client_secret: "sec",
      amount: params.amount,
      status: "succeeded",
    })),
    retrieve: vi.fn(async () => ({
      id: "pi_1",
      transfer_data: null as { destination: string } | null,
    })),
  },
  refunds: { create: vi.fn(async () => ({ id: "re_1" })) },
  subscriptions: {
    create: vi.fn(async (...args: [Record<string, unknown>]) => ({
      id: `sub_${args.length}`,
      status: "active",
    })),
  },
  sessions: {
    create: vi.fn(async (...args: [Record<string, unknown>]) => ({
      id: `cs_${args.length}`,
      url: "https://pay.test/cs",
    })),
  },
}));

type ScriptedDb = {
  select: () => unknown;
  insert: () => unknown;
  update: () => unknown;
  transaction: (cb: (tx: ScriptedDb) => unknown) => Promise<unknown>;
};

function scriptedDb(queue: unknown[]): ScriptedDb {
  const next = () => {
    const p: unknown = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) =>
            resolve(queue.shift() ?? []);
        }
        return () => p;
      },
      apply: () => p,
    });
    return p;
  };
  const db: ScriptedDb = {
    select: () => next(),
    insert: () => next(),
    update: () => next(),
    transaction: async (cb) => cb(db),
  };
  return db;
}

const tables = new Proxy(
  {},
  { get: () => new Proxy({}, { get: (_target, column) => String(column) }) },
);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Map(),
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: async () => null } },
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-salon" }),
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-salon" }),
  getUserRole: async () => "owner",
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: async () => "test-salon",
  getTenantSlugOrNull: async () => "test-salon",
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: async () => state.tenant,
  getTenantSlugForBookingClient: async () => "test-salon",
  resolveTenantSlugForAppointment: async () => "test-salon",
}));
vi.mock("@/lib/tenant/industry", async () => {
  const { VERTICALS } = await import("@/lib/verticals");
  return { getTenantTerms: async () => VERTICALS.hair_salon.terms };
});
vi.mock("@/lib/tenant/modules", () => ({
  hasModule: async () => state.giftCardsOn,
  assertModule: async () => undefined,
  ModuleDisabledError: class ModuleDisabledError extends Error {},
}));
vi.mock("@/lib/booking/session-cookie", () => ({
  getBookingSession: async () => CLIENT,
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) => key,
}));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, getBaseUrl: () => "https://test.local" };
});
vi.mock("@/lib/db", () => ({
  publicDb: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
      }),
    }),
  },
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, cb: (db: unknown, t: unknown) => unknown) => {
    const queue = [...(state.queues[state.call++] ?? [])];
    return cb(scriptedDb(queue), tables);
  },
}));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    paymentIntents: stripe.paymentIntents,
    subscriptions: stripe.subscriptions,
    checkout: { sessions: stripe.sessions },
    customers: { create: vi.fn() },
    refunds: stripe.refunds,
  }),
}));
vi.mock("@/actions/appointments", () => ({
  getAppointment: async () => state.appointment,
  cancelBooking: async () => ({ success: true }),
}));
vi.mock("@/actions/policies", () => ({
  getBusinessSettings: async () => ({
    noShowFeePercent: 100,
    cancellationFeePercent: 100,
    cancellationWindowHours: 24,
  }),
}));
vi.mock("@/lib/checkout/checkout-set", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkout/checkout-set")>();
  return {
    ...actual,
    loadCheckoutSet: async () => state.checkout,
  };
});
vi.mock("@/lib/checkout/record-payment", () => ({
  hasCompletedServicePayment: async () => false,
  recordServicePayment: recordPayment.recordServicePayment,
}));
vi.mock("@/lib/gift-cards/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gift-cards/service")>();
  return {
    ...actual,
    findGiftCardByCode: async () => ({ id: "gift-1", status: "active", balanceCents: 6000 }),
    debitGiftCard: async () => {
      throw new actual.GiftCardBalanceError();
    },
  };
});
vi.mock("@/lib/credits/ledger", () => ({
  appendCredit: async () => ({ balanceAfter: 4 }),
  CreditError: class CreditError extends Error {},
}));

import { chargeCancellationFee, chargeNoShowFee } from "@/actions/charges";
import { createCheckoutPaymentIntent, completeAppointment } from "@/actions/checkout";
import {
  createStoredValueTopUpPaymentIntent,
  enrollClientInMembershipPlan,
} from "@/actions/membership";
import { buyPackage } from "@/actions/packages";
import {
  refundBookingDepositForTenant,
} from "@/lib/services/booking-deposits";
import { refundCharge, waiveCharge } from "@/actions/charges";
import { createGiftCardCheckoutSession } from "@/lib/gift-cards/purchase";
import { chargeBookingDepositForTenant } from "@/lib/services/booking-deposits";
import { createStorefrontCheckoutSession } from "@/lib/services/storefront";

function queueRows(queues: unknown[][]) {
  state.call = 0;
  state.queues = queues;
}

function checkoutSet(priceCents: number, depositPaidCents: number) {
  state.checkout = {
    ok: true,
    set: {
      anchorId: APPT,
      appointmentIds: [APPT],
      groupId: null,
      payerClientId: CLIENT,
      services: [
        {
          serviceId: "svc-1",
          serviceName: "Cut",
          priceChargedCents: priceCents,
          priceCents,
        },
      ],
      depositPaidCents,
      project: null,
      creditCovered: false,
      creditEligible: false,
    },
  };
}

function applyMode(mode: Mode) {
  delete process.env.PLATFORM_PROCESSING_RATE_BPS;
  delete process.env.PLATFORM_PROCESSING_FIXED_CENTS;
  delete process.env.PAYMENTS_FAKE;
  delete process.env.RESEND_API_KEY;
  vi.stubEnv("UPTEMPO_MODE", mode === "single" ? "single" : "multi");
  state.tenant = {
    slug: "test-salon",
    plan: "starter",
    comped: mode === "comped" ? 1 : 0,
    processingRateBps: null,
    stripeConnectAccountId: "acct_test",
    platformFeePercent: null,
  };
}

function clearStripe() {
  stripe.paymentIntents.create.mockClear();
  stripe.subscriptions.create.mockClear();
  stripe.sessions.create.mockClear();
  stripe.refunds.create.mockClear();
  stripe.paymentIntents.retrieve.mockClear();
  state.giftCardsOn = false;
}

function expectCardFee(mode: Mode, payload: Record<string, unknown>, amount = 6000) {
  expect(payload.amount).toBe(amount);
  if (mode === "single") {
    expect(payload).not.toHaveProperty("transfer_data");
    expect(payload).not.toHaveProperty("application_fee_amount");
    return;
  }
  expect(payload.transfer_data).toEqual({ destination: "acct_test" });
  if (mode === "comped") {
    expect(payload).not.toHaveProperty("application_fee_amount");
    return;
  }
  expect(payload.application_fee_amount).toBe(300);
}

const card = { stripeCustomerId: "cus_1", stripePaymentMethodId: "pm_1" };

const paths: { name: string; run: () => Promise<unknown>; assert: (mode: Mode) => void }[] = [
  {
    name: "checkout in full",
    run: async () => {
      checkoutSet(6000, 0);
      queueRows([
        [[], [], [{ id: CLIENT, stripeCustomerId: "cus_1", email: "a@b.c", phone: null }]],
        [[{ applePayEnabled: 1, googlePayEnabled: 1, afterpayEnabled: 1, cashappEnabled: 1 }]],
      ]);
      const result = await createCheckoutPaymentIntent(APPT);
      expect(result, JSON.stringify(result)).toHaveProperty("clientSecret", "sec");
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "checkout remainder",
    run: async () => {
      checkoutSet(8000, 2000);
      queueRows([[[], [], [card]]]);
      const result = await completeAppointment({
        appointmentId: APPT,
        paymentMethod: "card_on_file",
      });
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "no-show fee",
    run: async () => {
      state.appointment = {
        id: APPT,
        status: "confirmed",
        start: new Date(Date.now() + 60 * 60 * 1000),
        client: { id: CLIENT, name: "Casey", email: null, phone: null },
      };
      queueRows([
        [[{ priceChargedCents: 6000, priceCents: 6000 }]],
        [[card]],
        [[{ id: "charge-id" }], []],
      ]);
      const result = await chargeNoShowFee(APPT);
      expect(result, JSON.stringify(result)).toMatchObject({ success: true, amountCents: 6000 });
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "cancellation fee",
    run: async () => {
      state.appointment = {
        id: APPT,
        status: "confirmed",
        start: new Date(Date.now() + 60 * 60 * 1000),
        client: { id: CLIENT, name: "Casey", email: null, phone: null },
      };
      queueRows([
        [[{ priceChargedCents: 6000, priceCents: 6000 }]],
        [[card]],
        [[{ id: "charge-id" }], []],
      ]);
      const result = await chargeCancellationFee(APPT);
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "package sale",
    run: async () => {
      queueRows([
        [
          [{
            id: PACK,
            name: "Four cuts",
            priceCents: 6000,
            isActive: 1,
            credits: 4,
            eligibleServiceIds: [],
            validDays: null,
          }],
          [{ id: CLIENT, ...card }],
          [],
        ],
        [[{ id: "cp_1" }], []],
      ]);
      const result = await buyPackage(PACK);
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "booking deposit",
    run: async () => {
      queueRows([
        [[{ id: APPT, clientId: CLIENT, depositCents: 6000 }]],
        [[]],
        [[card]],
        [[]],
      ]);
      const result = await chargeBookingDepositForTenant("test-salon", APPT);
      expect(result, JSON.stringify(result)).toMatchObject({ charged: true, amountCents: 6000 });
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "membership one-time payment",
    run: async () => {
      queueRows([[[{ stripeCustomerId: "cus_1", email: "a@b.c", phone: null }]]]);
      const result = await createStoredValueTopUpPaymentIntent({
        clientId: CLIENT,
        amountCents: 6000,
      });
      expect(result, JSON.stringify(result)).toMatchObject({ success: true, clientSecret: "sec" });
    },
    assert: (mode) => {
      expectCardFee(mode, stripe.paymentIntents.create.mock.calls.at(-1)![0]);
    },
  },
  {
    name: "membership subscription",
    run: async () => {
      queueRows([
        [[{ stripePaymentMethodId: "pm_1" }]],
        [[{
          id: PLAN,
          isActive: 1,
          stripePriceId: "price_1",
          monthlyAmountCents: 6000,
          stripeProductId: "prod_1",
        }]],
        [[]],
        [[{ stripeCustomerId: "cus_1", email: "a@b.c", phone: null }]],
        [[]],
      ]);
      const result = await enrollClientInMembershipPlan({ clientId: CLIENT, planId: PLAN });
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
    assert: (mode) => {
      const payload = stripe.subscriptions.create.mock.calls.at(-1)![0] as Record<string, unknown>;
      if (mode === "single") {
        expect(payload).not.toHaveProperty("transfer_data");
        expect(payload).not.toHaveProperty("application_fee_percent");
        return;
      }
      expect(payload.transfer_data).toEqual({ destination: "acct_test" });
      if (mode === "comped") {
        expect(payload).not.toHaveProperty("application_fee_percent");
        return;
      }
      expect(payload.application_fee_percent).toBe(5);
    },
  },
  {
    name: "storefront session",
    run: async () => {
      queueRows([[
        [{
          id: "prod-1",
          name: "Oil",
          brand: null,
          priceCents: 6000,
          photoUrl: null,
          isActive: 1,
        }],
        [{ taxBps: 1000, shipFlatCents: null }],
      ]]);
      const result = await createStorefrontCheckoutSession({
        slug: "test-salon",
        items: [{ productId: "prod-1", quantity: 1 }],
        fulfillment: "pickup",
        clientId: null,
      });
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
    assert: (mode) => {
      const payload = stripe.sessions.create.mock.calls.at(-1)![0] as {
        line_items: { price_data: { unit_amount: number; product_data: { name: string } } }[];
        payment_intent_data: Record<string, unknown>;
      };
      expect(payload.line_items.some((line) => line.price_data.product_data.name === "Sales tax")).toBe(true);
      const data = payload.payment_intent_data;
      if (mode === "single") {
        expect(data).not.toHaveProperty("transfer_data");
        expect(data).not.toHaveProperty("application_fee_amount");
        return;
      }
      expect(data.transfer_data).toEqual({ destination: "acct_test" });
      if (mode === "comped") {
        expect(data).not.toHaveProperty("application_fee_amount");
        return;
      }
      expect(data.application_fee_amount).toBe(300);
    },
  },
  {
    name: "gift card purchase session",
    run: async () => {
      await createGiftCardCheckoutSession("test-salon", {
        amountCents: 6000,
        purchaserName: "Pat",
        purchaserEmail: "pat@example.com",
        recipientName: "Sam",
        recipientEmail: "sam@example.com",
      });
    },
    assert: (mode) => {
      if (mode === "single") {
        // Gift cards need a Connect account, so single mode never opens a session.
        expect(stripe.sessions.create).not.toHaveBeenCalled();
        return;
      }
      const payload = stripe.sessions.create.mock.calls.at(-1)![0] as {
        line_items: { price_data: { unit_amount: number } }[];
        payment_intent_data: Record<string, unknown>;
      };
      expect(payload.line_items[0].price_data.unit_amount).toBe(6000);
      const data = payload.payment_intent_data;
      expect(data.transfer_data).toEqual({ destination: "acct_test" });
      if (mode === "comped") {
        expect(data).not.toHaveProperty("application_fee_amount");
        return;
      }
      expect(data.application_fee_amount).toBe(300);
    },
  },
];

describe.each(["hosted", "comped", "single"] as const)("card processing on charge paths (%s)", (mode) => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    clearStripe();
    applyMode(mode);
  });

  it.each(paths)("$name", async (path) => {
    await path.run();
    path.assert(mode);
  });
});

const completedCharge = (connectAccountId: string | null) => ({
  id: "charge-1",
  clientId: CLIENT,
  status: "completed",
  stripePaymentIntentId: "pi_paid",
  storedValueCents: 0,
  amountCents: 6000,
  connectAccountId,
});

const refundPaths: {
  name: string;
  run: (destination: boolean) => Promise<unknown>;
  /** Destination is read from the charge row, the caller's own charge, or the PaymentIntent. */
  viaIntent?: boolean;
  /** Undoes a charge whose sale never completed, so the processing fee comes back too. */
  undo?: boolean;
}[] = [
  {
    name: "waive a completed charge",
    run: async (destination) => {
      queueRows([[[completedCharge(destination ? "acct_test" : null)]], [[]]]);
      const result = await waiveCharge("charge-1");
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
  },
  {
    name: "refund a charge",
    run: async (destination) => {
      queueRows([[[completedCharge(destination ? "acct_test" : null)]], [[]]]);
      const result = await refundCharge("charge-1");
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    },
  },
  {
    name: "booking deposit refund",
    run: async (destination) => {
      queueRows([
        [[{ ...completedCharge(destination ? "acct_test" : null), reason: "deposit" }]],
        [[]],
      ]);
      const result = await refundBookingDepositForTenant("test-salon", APPT);
      expect(result).toMatchObject({ refunded: true });
    },
  },
  {
    name: "package sale that could not be saved",
    undo: true,
    run: async (destination) => {
      state.tenant.stripeConnectAccountId = destination ? "acct_test" : null;
      queueRows([
        [
          [{
            id: PACK,
            name: "Four cuts",
            priceCents: 6000,
            isActive: 1,
            credits: 4,
            eligibleServiceIds: [],
            validDays: null,
          }],
          [{ id: CLIENT, ...card }],
          [],
        ],
        [[]], // the pack insert returns no row, so saving fails and the charge is refunded
      ]);
      const result = await buyPackage(PACK);
      expect(result, JSON.stringify(result)).toMatchObject({ success: false });
    },
  },
  {
    name: "gift card balance changed during checkout",
    viaIntent: true,
    undo: true,
    run: async (destination) => {
      state.giftCardsOn = true;
      stripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: "pi_new",
        transfer_data: destination ? { destination: "acct_test" } : null,
      });
      checkoutSet(6000, 0);
      queueRows([[[], []]]);
      const result = await completeAppointment({
        appointmentId: APPT,
        paymentMethod: "new_card",
        stripePaymentIntentId: "pi_new",
        giftCard: { code: "GIFT", amountCents: 2000 },
      });
      expect(result, JSON.stringify(result)).toMatchObject({ success: false });
    },
  },
];

describe.each(refundPaths)("refunds pull the business's share back: $name", (path) => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    clearStripe();
    applyMode("hosted");
  });

  it("a destination charge reverses the transfer (and returns the fee only when undoing a failed sale)", async () => {
    await path.run(true);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    const payload = (stripe.refunds.create.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(payload.reverse_transfer).toBe(true);
    if (path.undo) {
      expect(payload.refund_application_fee).toBe(true);
    } else {
      expect(payload).not.toHaveProperty("refund_application_fee");
    }
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(path.viaIntent ? 1 : 0);
  });

  it("a charge without a Connect account sends neither", async () => {
    await path.run(false);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    const payload = (stripe.refunds.create.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(payload).not.toHaveProperty("reverse_transfer");
    expect(payload).not.toHaveProperty("refund_application_fee");
  });
});

describe("checkout stores the card fee Stripe took", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    clearStripe();
    recordPayment.recordServicePayment.mockClear();
    applyMode("hosted");
  });

  const recordedInput = () =>
    (recordPayment.recordServicePayment.mock.calls as unknown as unknown[][]).at(-1)![2] as { platformFeeCents: number | null };

  it("card on file stores the application fee sent on the PaymentIntent", async () => {
    checkoutSet(6000, 0);
    queueRows([[[], [], [card]]]);
    const result = await completeAppointment({
      appointmentId: APPT,
      paymentMethod: "card_on_file",
    });
    const sent = stripe.paymentIntents.create.mock.calls.at(-1)![0] as {
      application_fee_amount?: number;
    };
    expect(sent.application_fee_amount).toBeGreaterThan(0);
    expect(recordedInput().platformFeeCents).toBe(sent.application_fee_amount);
    expect(result).toMatchObject({
      success: true,
      platformFeeCents: sent.application_fee_amount,
      processingRateLabel: "5%",
    });
  });

  it("cash stores no fee and shows no processing line", async () => {
    checkoutSet(6000, 0);
    queueRows([[[], []]]);
    const result = await completeAppointment({
      appointmentId: APPT,
      paymentMethod: "cash",
    });
    expect(recordedInput().platformFeeCents).toBeNull();
    expect(result).toMatchObject({
      success: true,
      platformFeeCents: 0,
      processingRateLabel: null,
    });
  });

  it("a partly prepaid card sale stores the fee on the card remainder only", async () => {
    checkoutSet(8000, 2000);
    queueRows([[[], [], [card]]]);
    const result = await completeAppointment({
      appointmentId: APPT,
      paymentMethod: "card_on_file",
    });
    const sent = stripe.paymentIntents.create.mock.calls.at(-1)![0] as {
      amount: number;
      application_fee_amount?: number;
    };
    expect(sent.amount).toBe(6000);
    expect(recordedInput().platformFeeCents).toBe(300);
    expect(recordedInput().platformFeeCents).toBe(sent.application_fee_amount);
    expect(result).toMatchObject({ success: true, platformFeeCents: 300 });
  });

  it("new card stores the application fee on the confirmed PaymentIntent", async () => {
    checkoutSet(6000, 0);
    queueRows([[[], []]]);
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: "pi_new",
      amount: 6000,
      application_fee_amount: 123,
      transfer_data: null,
    } as never);
    const result = await completeAppointment({
      appointmentId: APPT,
      paymentMethod: "new_card",
      stripePaymentIntentId: "pi_new",
    });
    expect(recordedInput().platformFeeCents).toBe(123);
    expect(result).toMatchObject({ success: true, platformFeeCents: 123 });
  });
});
