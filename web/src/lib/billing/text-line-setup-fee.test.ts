import { describe, expect, it, vi } from "vitest";
import {
  ensureTextLineSetupFeeWithDeps,
  type SetupFeeRepository,
  type SetupFeeStripe,
  type SetupFeeTenant,
} from "./text-line-setup-fee";

function memoryRepository(initial: Partial<SetupFeeTenant> = {}) {
  let tenant: SetupFeeTenant = {
    slug: "test-salon",
    name: "Test Salon",
    comped: 0,
    smsLineStatus: "off",
    smsRegistration: {},
    platformStripeCustomerId: null,
    ...initial,
  };
  let activeLease: { token: string; expiresAt: string } | null = null;
  const repository: SetupFeeRepository = {
    load: vi.fn(async () => structuredClone(tenant)),
    claim: vi.fn(async (_slug, lease) => {
      if (activeLease) return false;
      activeLease = lease;
      tenant = {
        ...tenant,
        smsRegistration: {
          ...(tenant.smsRegistration ?? {}),
          setupFeeLease: lease,
        },
      };
      return true;
    }),
    save: vi.fn(async (_slug, token, registration, customerId) => {
      if (activeLease?.token !== token) return false;
      tenant = {
        ...tenant,
        smsRegistration: structuredClone(registration),
        ...(customerId ? { platformStripeCustomerId: customerId } : {}),
      };
      return true;
    }),
    release: vi.fn(async (_slug, token) => {
      if (activeLease?.token !== token) return;
      const registration = { ...(tenant.smsRegistration ?? {}) };
      delete registration.setupFeeLease;
      tenant = { ...tenant, smsRegistration: registration };
      activeLease = null;
    }),
  };
  return {
    repository,
    read: () => structuredClone(tenant),
    set: (next: Partial<SetupFeeTenant>) => {
      tenant = { ...tenant, ...next };
    },
  };
}

function fakeStripe() {
  const stripe: SetupFeeStripe = {
    invoiceItems: {
      list: vi.fn(async () => ({ data: [], has_more: false })) as never,
      create: vi.fn(async () => ({ id: "ii_setup_1" })) as never,
    },
  };
  return stripe;
}

const deps = (
  repository: SetupFeeRepository,
  stripe: SetupFeeStripe | null,
  overrides: Record<string, unknown> = {},
) => ({
  repository,
  stripe,
  ensureCustomer: vi.fn(async () => "cus_setup_1"),
  now: () => new Date("2026-10-16T12:00:00.000Z"),
  ...overrides,
});

describe("text line one-time setup fee", () => {
  it("adds one pending $19 invoice item and keeps its durable marker for retries", async () => {
    const db = memoryRepository();
    const stripe = fakeStripe();
    const options = deps(db.repository, stripe);

    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", options),
    ).resolves.toEqual({
      ok: true,
      status: "added",
    });
    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", options),
    ).resolves.toEqual({
      ok: true,
      status: "already_added",
    });

    expect(stripe.invoiceItems.create).toHaveBeenCalledTimes(1);
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_setup_1",
        amount: 1900,
        currency: "usd",
        metadata: expect.objectContaining({
          tenantSlug: "test-salon",
          purpose: "text_line_setup_fee",
          feeKey: "text-line-setup-fee:test-salon",
        }),
      }),
      {
        idempotencyKey: "text-line-setup-fee:test-salon",
        timeout: 30_000,
        maxNetworkRetries: 0,
      },
    );
    expect(stripe.invoiceItems.list).toHaveBeenCalledWith(
      { customer: "cus_setup_1", limit: 100 },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    expect(db.read().platformStripeCustomerId).toBe("cus_setup_1");
    expect(db.read().smsRegistration).toMatchObject({
      setupFeeEligible: true,
      setupFeeState: "added",
      setupFeeInvoiceItemId: "ii_setup_1",
    });
    expect(db.read().smsRegistration?.setupFeeLease).toBeUndefined();
  });

  it.each([
    ["shared", { smsLineStatus: "shared" }, "shared"],
    ["comped", { comped: 1 }, "off"],
    [
      "started from shared",
      { smsRegistration: { startedFromShared: true } },
      "off",
    ],
  ] as const)(
    "permanently waives the fee for a %s business",
    async (_name, overrides, status) => {
      const db = memoryRepository({ ...overrides, smsLineStatus: status });
      const stripe = fakeStripe();
      const options = deps(db.repository, stripe);

      await expect(
        ensureTextLineSetupFeeWithDeps("test-salon", options),
      ).resolves.toEqual({
        ok: true,
        status: "waived",
      });
      db.set({ smsLineStatus: "off", comped: 0 });
      await expect(
        ensureTextLineSetupFeeWithDeps("test-salon", options),
      ).resolves.toEqual({
        ok: true,
        status: "waived",
      });
      expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
      expect(db.read().smsRegistration).toMatchObject({
        setupFeeEligible: false,
        setupFeeWaived: true,
        setupFeeState: "waived",
      });
    },
  );

  it("serializes concurrent submissions with a durable fee lease", async () => {
    const db = memoryRepository();
    const stripe = fakeStripe();
    let announceList!: () => void;
    let releaseList!: () => void;
    const listed = new Promise<void>((resolve) => (announceList = resolve));
    const waitForList = new Promise<void>((resolve) => (releaseList = resolve));
    stripe.invoiceItems.list = vi.fn(async () => {
      announceList();
      await waitForList;
      return { data: [], has_more: false };
    }) as never;
    const options = deps(db.repository, stripe);

    const first = ensureTextLineSetupFeeWithDeps("test-salon", options);
    await listed;
    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", options),
    ).resolves.toEqual({
      ok: false,
      error: "setup_fee_busy",
    });
    releaseList();
    await expect(first).resolves.toMatchObject({ ok: true, status: "added" });
    expect(stripe.invoiceItems.create).toHaveBeenCalledTimes(1);
  });

  it("recovers an invoice item created before a lost response or database write", async () => {
    const db = memoryRepository();
    const stripe = fakeStripe();
    stripe.invoiceItems.list = vi.fn(async () => ({
      data: [
        {
          id: "ii_recovered",
          metadata: {
            tenantSlug: "test-salon",
            purpose: "text_line_setup_fee",
            feeKey: "text-line-setup-fee:test-salon",
          },
        },
      ],
      has_more: false,
    })) as never;

    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", deps(db.repository, stripe)),
    ).resolves.toEqual({ ok: true, status: "added" });
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
    expect(db.read().smsRegistration?.setupFeeInvoiceItemId).toBe(
      "ii_recovered",
    );
  });

  it("recovers a retry after Stripe accepted creation but the client saw an error", async () => {
    const db = memoryRepository();
    const stripe = fakeStripe();
    stripe.invoiceItems.create = vi
      .fn()
      .mockRejectedValueOnce(new Error("ambiguous request"))
      .mockResolvedValueOnce({ id: "ii_duplicate_would_be_bad" }) as never;
    const options = deps(db.repository, stripe);

    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", options),
    ).resolves.toEqual({
      ok: false,
      error: "setup_fee_unavailable",
    });
    stripe.invoiceItems.list = vi.fn(async () => ({
      data: [
        {
          id: "ii_recovered_after_retry",
          metadata: {
            tenantSlug: "test-salon",
            purpose: "text_line_setup_fee",
            feeKey: "text-line-setup-fee:test-salon",
          },
        },
      ],
      has_more: false,
    })) as never;

    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", options),
    ).resolves.toEqual({
      ok: true,
      status: "added",
    });
    expect(stripe.invoiceItems.create).toHaveBeenCalledTimes(1);
    expect(db.read().smsRegistration?.setupFeeInvoiceItemId).toBe(
      "ii_recovered_after_retry",
    );
  });

  it("uses only the explicit local payment fake and persists a stable marker", async () => {
    const db = memoryRepository();
    const options = deps(db.repository, null, {
      ensureCustomer: undefined,
      useFakePayments: true,
    });

    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", options),
    ).resolves.toEqual({
      ok: true,
      status: "added",
    });
    expect(db.read().smsRegistration?.setupFeeInvoiceItemId).toMatch(
      /^ii_fake_/,
    );
  });

  it("fails closed at the bounded invoice-item recovery limit without creating", async () => {
    const db = memoryRepository();
    const stripe = fakeStripe();
    stripe.invoiceItems.list = vi.fn(async () => ({
      data: [{ id: "ii_existing_unknown", metadata: {} }],
      has_more: true,
    })) as never;

    await expect(
      ensureTextLineSetupFeeWithDeps("test-salon", deps(db.repository, stripe)),
    ).resolves.toEqual({ ok: false, error: "setup_fee_unavailable" });
    expect(stripe.invoiceItems.list).toHaveBeenCalledTimes(20);
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
    expect(stripe.invoiceItems.list).toHaveBeenLastCalledWith(
      {
        customer: "cus_setup_1",
        limit: 100,
        starting_after: "ii_existing_unknown",
      },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
  });
});
