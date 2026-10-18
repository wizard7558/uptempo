import { describe, it, expect, vi, beforeEach } from "vitest";

// Server translator without a request scope: hair_salon words, same as the old copy.
vi.mock("@/lib/terms/server", async () => {
  const { createTermsT } = await import("@/lib/terms/translator");
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getT: async (namespace?: string) =>
      createTermsT(VERTICALS.hair_salon.terms, namespace ?? ""),
  };
});

// ---- Mocks ---- //

// Mock verifyWebhookSignature
const mockVerifyWebhookSignature = vi.fn();
vi.mock("@/lib/stripe/webhook", () => ({
  verifyWebhookSignature: (...args: unknown[]) => mockVerifyWebhookSignature(...args),
}));

// Mock tenant DB
function createMockDb() {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return chain;
}

function createMockPublicDb() {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    returning: vi.fn().mockResolvedValue([{ slug: "test-salon" }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return chain;
}

let mockDb: ReturnType<typeof createMockDb>;
let mockPublicDb: ReturnType<typeof createMockPublicDb>;
const mockTables = {
  clientMemberships: { id: "id", planId: "planId", stripeSubscriptionId: "stripeSubscriptionId", clientId: "clientId" },
  membershipPlans: { id: "id", kind: "kind", name: "name", creditsPerPeriod: "creditsPerPeriod", rolloverMax: "rolloverMax", eligibleServiceIds: "eligibleServiceIds" },
  clients: { id: "id", stripeCustomerId: "stripeCustomerId", stripePaymentMethodId: "stripePaymentMethodId", email: "email", name: "name", updatedAt: "updatedAt" },
  charges: { id: "id", stripePaymentIntentId: "stripePaymentIntentId", status: "status", failureReason: "failureReason", updatedAt: "updatedAt" },
};

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  publicDb: new Proxy(
    {},
    {
      get: (_target, prop) => mockPublicDb?.[prop as keyof typeof mockPublicDb],
    },
  ),
}));

// Mock tenant registry
vi.mock("@/lib/tenant/registry", () => ({
  listActiveTenants: vi.fn().mockResolvedValue([{ slug: "test-salon", id: "tenant-1", name: "Test Salon", status: "active" }]),
}));

const mockGrantMembershipCredits = vi.fn().mockResolvedValue({ granted: true, balance: 8 });
vi.mock("@/lib/credits/membership", () => ({
  grantMembershipCredits: (...args: unknown[]) => mockGrantMembershipCredits(...args),
}));
const mockCreditStoredValue = vi.fn().mockResolvedValue({ credited: true, newBalanceCents: 0 });
vi.mock("@/lib/services/stored-value-ledger", () => ({
  creditStoredValueIdempotent: (...args: unknown[]) => mockCreditStoredValue(...args),
}));

// Mock Stripe server
const mockStripe = {
  subscriptions: {
    retrieve: vi.fn().mockResolvedValue({
      metadata: {
        purpose: "beauty_bank_membership",
        tenantSlug: "test-salon",
        clientId: "client-1",
      },
      items: { data: [] },
    }),
  },
  paymentMethods: {
    retrieve: vi.fn().mockResolvedValue({
      card: { brand: "visa", last4: "4242" },
    }),
  },
};

vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => mockStripe,
}));

// Mock resend
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: "email-id" }) },
  })),
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  };
});

// Import after mocks
import { POST } from "@/app/api/stripe/webhook/route";
import { withTenantDb } from "@/lib/db/tenant";

type WithTenantDbCallback = Parameters<typeof withTenantDb>[1];

function runWithMockDb<T>(
  callback: WithTenantDbCallback,
  db: ReturnType<typeof createMockDb> = mockDb,
): Promise<T> {
  return callback(db as never, mockTables as never) as Promise<T>;
}

function mockWithDb(
  db: ReturnType<typeof createMockDb> = mockDb,
): typeof withTenantDb {
  return async <T>(_slug: string, callback: WithTenantDbCallback): Promise<T> =>
    runWithMockDb<T>(callback, db);
}

// ---- Helpers ---- //

function createMockRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function makeStripeEvent(type: string, data: Record<string, unknown>) {
  return {
    id: "evt_test_123",
    type,
    data: { object: data },
  };
}

// ---- Test Suite ---- //

describe("Stripe webhook handler integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockPublicDb = createMockPublicDb();
    vi.mocked(withTenantDb).mockImplementation(mockWithDb());
  });

  it("rejects requests with missing stripe-signature header", async () => {
    const req = createMockRequest('{"test": true}');
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Missing stripe-signature header");
  });

  it("rejects requests with invalid signature", async () => {
    mockVerifyWebhookSignature.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const req = createMockRequest('{"test": true}', {
      "stripe-signature": "invalid_sig",
    });
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid signature");
  });

  it("handles setup_intent.succeeded -- saves payment method to client", async () => {
    const event = makeStripeEvent("setup_intent.succeeded", {
      customer: "cus_test_123",
      payment_method: "pm_test_456",
      metadata: { tenantSlug: "test-salon" },
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    // First withTenantDb: find client by stripeCustomerId
    let callCount = 0;
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      callCount++;
      const db = createMockDb();
      if (callCount === 1) {
        // Return the client
        (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { id: "client-1", email: "test@test.com", name: "Test Client", stripeCustomerId: "cus_test_123" },
        ]);
      }
      // Second call: update client with payment method
      return runWithMockDb<T>(callback, db);
      },
    );

    // Suppress email
    const origKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "";

    const req = createMockRequest("{}", { "stripe-signature": "valid_sig" });
    const response = await POST(req);

    process.env.RESEND_API_KEY = origKey;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    // Verify withTenantDb was called to find and update client
    expect(withTenantDb).toHaveBeenCalledWith("test-salon", expect.any(Function));
  });

  it("handles payment_intent.succeeded -- marks charge as completed", async () => {
    const event = makeStripeEvent("payment_intent.succeeded", {
      id: "pi_test_success",
      metadata: { tenantSlug: "test-salon" },
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    // withTenantDb: find charge and update status
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      const db = createMockDb();
      // select().from().where().limit() -> return charge
      (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "charge-1", stripePaymentIntentId: "pi_test_success", status: "pending" },
      ]);
      return runWithMockDb<T>(callback, db);
      },
    );

    const req = createMockRequest("{}", { "stripe-signature": "valid_sig" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(withTenantDb).toHaveBeenCalledWith("test-salon", expect.any(Function));
  });

  it("handles payment_intent.payment_failed -- marks charge as failed", async () => {
    const event = makeStripeEvent("payment_intent.payment_failed", {
      id: "pi_test_failed",
      metadata: { tenantSlug: "test-salon" },
      last_payment_error: { message: "Your card was declined" },
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      const db = createMockDb();
      (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "charge-2", stripePaymentIntentId: "pi_test_failed", status: "pending" },
      ]);
      return runWithMockDb<T>(callback, db);
      },
    );

    const req = createMockRequest("{}", { "stripe-signature": "valid_sig" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(withTenantDb).toHaveBeenCalledWith("test-salon", expect.any(Function));
  });

  describe("invoice.paid", () => {
    const planRow = {
      kind: "stored_value",
      name: "Gold",
      creditsPerPeriod: null as number | null,
      rolloverMax: 0,
      eligibleServiceIds: [] as string[],
      clientMembershipId: "cm-1",
    };

    async function payInvoice(plan: typeof planRow | null) {
      mockVerifyWebhookSignature.mockReturnValue(
        makeStripeEvent("invoice.paid", {
          id: "in_1",
          amount_paid: 5000,
          parent: { subscription_details: { subscription: "sub_1" } },
          subscription: "sub_1",
        }),
      );
      vi.mocked(withTenantDb).mockImplementation(
        async <T>(_slug: string, callback: WithTenantDbCallback) => {
          const db = createMockDb();
          (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue(plan ? [plan] : []);
          db.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
          return runWithMockDb<T>(callback, db);
        },
      );
      const res = await POST(createMockRequest("{}", { "stripe-signature": "valid_sig" }));
      expect(res.status).toBe(200);
    }

    it("a stored_value plan credits the prepaid balance and grants no pack credits", async () => {
      await payInvoice(planRow);
      expect(mockCreditStoredValue).toHaveBeenCalledTimes(1);
      expect(mockCreditStoredValue.mock.calls[0][2]).toMatchObject({
        clientId: "client-1",
        type: "subscription_credit",
        amountCents: 5000,
        referenceId: "in_1",
      });
      expect(mockGrantMembershipCredits).not.toHaveBeenCalled();
    });

    it("a membership we cannot find keeps the stored_value behavior", async () => {
      await payInvoice(null);
      expect(mockCreditStoredValue).toHaveBeenCalledTimes(1);
      expect(mockGrantMembershipCredits).not.toHaveBeenCalled();
    });

    it("a credits plan grants membership credits and writes no stored_value row", async () => {
      await payInvoice({
        ...planRow,
        kind: "credits",
        creditsPerPeriod: 8,
        rolloverMax: 4,
        eligibleServiceIds: ["svc-1"],
      });
      expect(mockCreditStoredValue).not.toHaveBeenCalled();
      expect(mockGrantMembershipCredits).toHaveBeenCalledTimes(1);
      expect(mockGrantMembershipCredits.mock.calls[0][2]).toEqual({
        clientMembershipId: "cm-1",
        clientId: "client-1",
        planName: "Gold",
        perPeriod: 8,
        rolloverMax: 4,
        eligible: ["svc-1"],
        invoiceId: "in_1",
      });
    });

    it("a discount plan does nothing", async () => {
      await payInvoice({ ...planRow, kind: "discount" });
      expect(mockCreditStoredValue).not.toHaveBeenCalled();
      expect(mockGrantMembershipCredits).not.toHaveBeenCalled();
    });
  });

  it("a hosted plan subscription update returns 200 and never reaches the membership update", async () => {
    const hostedSub = {
      id: "sub_host",
      status: "past_due",
      metadata: { purpose: "uptempo_hosted_plan", tenantSlug: "test-salon" },
    };
    mockStripe.subscriptions.retrieve.mockResolvedValueOnce(hostedSub);
    mockVerifyWebhookSignature.mockReturnValue(
      makeStripeEvent("customer.subscription.updated", hostedSub),
    );

    const response = await POST(
      createMockRequest("{}", { "stripe-signature": "valid_sig" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mockPublicDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: "past_due" }),
    );
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns 200 for unhandled event types", async () => {
    const event = makeStripeEvent("customer.created", {
      id: "cus_new",
    });
    mockVerifyWebhookSignature.mockReturnValue(event);

    const req = createMockRequest("{}", { "stripe-signature": "valid_sig" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    // Should NOT have called withTenantDb for unhandled events
    expect(withTenantDb).not.toHaveBeenCalled();
  });
});
