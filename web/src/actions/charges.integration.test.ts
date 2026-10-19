import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks ---- //

// Mock tenant context
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: vi.fn().mockResolvedValue("test-business"),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-business" }),
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-business" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map([["x-tenant-slug", "test-business"]])),
}));

// Mock getAppointment and cancelBooking
const mockGetAppointment = vi.fn();
const mockCancelBooking = vi.fn();
vi.mock("@/actions/appointments", () => ({
  getAppointment: (...args: unknown[]) => mockGetAppointment(...args),
  cancelBooking: (...args: unknown[]) => mockCancelBooking(...args),
}));

// Mock business policy lookup
const mockGetBusinessSettings = vi.fn();
vi.mock("@/actions/policies", () => ({
  getBusinessSettings: () => mockGetBusinessSettings(),
}));

// Mock policy-engine (use real functions since they are pure)
vi.mock("@/lib/services/policy-engine", () => ({
  calculateFee: vi.fn((basePriceCents: number, feePercent: number, reason: string) => ({
    feeCents: Math.round(basePriceCents * (feePercent / 100)),
    basePriceCents,
    feePercent,
    reason,
  })),
  calculateAppointmentPrice: vi.fn((services: { priceChargedCents: number | null; priceCents: number | null }[]) =>
    services.reduce((total: number, svc: { priceChargedCents: number | null; priceCents: number | null }) => total + (svc.priceChargedCents ?? svc.priceCents ?? 0), 0),
  ),
  isWithinCancellationWindow: vi.fn().mockReturnValue(true),
}));

// Mock processOffSessionCharge
const mockProcessOffSessionCharge = vi.fn();
vi.mock("@/lib/services/charge-processing", () => ({
  processOffSessionCharge: (...args: unknown[]) => mockProcessOffSessionCharge(...args),
}));

// Mock connect charge params
const mockGetConnectChargeParams = vi.fn();
vi.mock("@/lib/stripe/connect-charge-params", () => ({
  getConnectChargeParams: (...args: unknown[]) => mockGetConnectChargeParams(...args),
}));

// Mock stripe
vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    refunds: { create: vi.fn() },
  },
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
    desc: vi.fn((...args: unknown[]) => ({ op: "desc", args })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
  };
});

// Chainable mock DB
function createMockDb() {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "charge-id" }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    transaction: vi.fn(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(chain)),
  };
  return chain;
}

let mockDb: ReturnType<typeof createMockDb>;
const mockTables = {
  appointments: { id: "id", status: "status", updatedAt: "updatedAt" },
  appointmentServices: { appointmentId: "appointmentId", serviceId: "serviceId", priceChargedCents: "priceChargedCents" },
  services: { id: "id", priceCents: "priceCents" },
  clients: { id: "id", stripeCustomerId: "stripeCustomerId", stripePaymentMethodId: "stripePaymentMethodId" },
  charges: { id: "id", appointmentId: "appointmentId", clientId: "clientId", stripePaymentIntentId: "stripePaymentIntentId", amountCents: "amountCents", reason: "reason", status: "status", failureReason: "failureReason", createdAt: "createdAt" },
};

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(),
}));

// Import after mocks
import { chargeNoShowFee, chargeCancellationFee } from "@/actions/charges";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import { isWithinCancellationWindow } from "@/lib/services/policy-engine";

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

// ---- Test Data ---- //

const APPT_UUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const CLIENT_UUID = "b2c3d4e5-f6a7-4901-bcde-f12345678901";

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT_UUID,
    staffId: "staff-id",
    client: {
      id: CLIENT_UUID,
      name: "Test Client",
      email: "test@example.com",
      phone: "555-1234",
    },
    services: [{ serviceId: "svc-1", serviceName: "Haircut", durationMinutes: 60, isOverride: 0 }],
    start: new Date("2026-03-15T10:00:00.000Z"),
    end: new Date("2026-03-15T11:00:00.000Z"),
    status: "confirmed",
    notes: null,
    ...overrides,
  };
}

// ---- Test Suites ---- //

describe("chargeNoShowFee integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    vi.mocked(withTenantDb).mockImplementation(mockWithDb());
    mockGetConnectChargeParams.mockResolvedValue(null);

    // Default policy
    mockGetBusinessSettings.mockResolvedValue({
      noShowFeePercent: 50,
      cancellationFeePercent: 25,
      cancellationWindowHours: 24,
    });
  });

  it("returns error when appointment not found", async () => {
    mockGetAppointment.mockResolvedValue(null);

    const result = await chargeNoShowFee(APPT_UUID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Appointment not found");
    }
  });

  it("returns error when client has no card on file", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment());

    // Mock getClientStripeIds via withTenantDb -- returns client without stripe IDs
    // The function calls getAppointmentServicePrices and getClientStripeIds separately
    // getAppointmentServicePrices uses withTenantDb first, then getClientStripeIds uses it second
    let callCount = 0;
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      callCount++;
      if (callCount === 1) {
        // First call: update appointment status to no_show (fee is >0 path won't hit this first)
        // Actually, the first withTenantDb call is getAppointmentServicePrices
        const pricesDb = createMockDb();
        // Return service prices for fee calculation
        (pricesDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { priceChargedCents: 5000, priceCents: 5000 },
        ]);
        // Actually withTenantDb in getAppointmentServicePrices doesn't use limit, it returns the select chain result
        // Let me trace through: getAppointmentServicePrices -> withTenantDb -> db.select().from().innerJoin().where()
        // The where() call doesn't chain to limit, it resolves the query. In our mock, where() returns `this`
        // But the function awaits the chain result directly. We need where() to resolve to an array.
        (pricesDb.where as ReturnType<typeof vi.fn>).mockResolvedValue([
          { priceChargedCents: 5000, priceCents: 5000 },
        ]);
        return runWithMockDb<T>(callback, pricesDb);
      }
      if (callCount === 2) {
        // Second call: getClientStripeIds -> returns client without stripe IDs
        const clientDb = createMockDb();
        (clientDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { stripeCustomerId: null, stripePaymentMethodId: null },
        ]);
        return runWithMockDb<T>(callback, clientDb);
      }
      // Third call: update appointment status to no_show
      return runWithMockDb<T>(callback, createMockDb());
      },
    );

    const result = await chargeNoShowFee(APPT_UUID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("No payment method on file");
    }
  });

  it("successfully charges no-show fee", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment());
    mockGetConnectChargeParams.mockResolvedValue({
      connectAccountId: "acct_test_123",
      platformFeeCents: 250,
    });

    mockProcessOffSessionCharge.mockResolvedValue({
      stripePaymentIntentId: "pi_test_123",
      status: "completed",
      failureReason: null,
    });

    let callCount = 0;
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      callCount++;
      const db = createMockDb();
      if (callCount === 1) {
        // getAppointmentServicePrices
        (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
          { priceChargedCents: 10000, priceCents: 10000 },
        ]);
      }
      if (callCount === 2) {
        // getClientStripeIds
        (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { stripeCustomerId: "cus_test", stripePaymentMethodId: "pm_test" },
        ]);
      }
      if (callCount === 3) {
        // Insert charge + update appointment
        (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "charge-id" }]);
      }
      return runWithMockDb<T>(callback, db);
      },
    );

    // Suppress email by unsetting RESEND_API_KEY
    const originalResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "";

    const result = await chargeNoShowFee(APPT_UUID);

    process.env.RESEND_API_KEY = originalResendKey;

    expect(result.success).toBe(true);
    if (result.success && "chargeId" in result) {
      expect(result.chargeId).toBe("charge-id");
      expect(result.amountCents).toBe(5000); // 50% of 10000
      expect(result.status).toBe("completed");
    }
    expect(mockProcessOffSessionCharge).toHaveBeenCalledWith({
      amountCents: 5000,
      stripeCustomerId: "cus_test",
      stripePaymentMethodId: "pm_test",
      connectAccountId: "acct_test_123",
      platformFeeCents: 250,
      metadata: {
        appointmentId: APPT_UUID,
        reason: "no_show",
        clientId: CLIENT_UUID,
        tenantSlug: "test-business",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
    expect(revalidatePath).toHaveBeenCalledWith("/charges");
  });

  it("handles Stripe payment failure gracefully", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment());

    mockProcessOffSessionCharge.mockResolvedValue({
      stripePaymentIntentId: null,
      status: "failed",
      failureReason: "Card declined",
    });

    let callCount = 0;
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      callCount++;
      const db = createMockDb();
      if (callCount === 1) {
        (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
          { priceChargedCents: 10000, priceCents: 10000 },
        ]);
      }
      if (callCount === 2) {
        (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { stripeCustomerId: "cus_test", stripePaymentMethodId: "pm_test" },
        ]);
      }
      if (callCount === 3) {
        (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "failed-charge-id" }]);
      }
      return runWithMockDb<T>(callback, db);
      },
    );

    const originalResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "";

    const result = await chargeNoShowFee(APPT_UUID);

    process.env.RESEND_API_KEY = originalResendKey;

    expect(result.success).toBe(true);
    if (result.success && "chargeId" in result) {
      expect(result.chargeId).toBe("failed-charge-id");
      expect(result.status).toBe("failed");
    }
  });

  it("persists pending status when Stripe is still processing", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment());

    mockProcessOffSessionCharge.mockResolvedValue({
      stripePaymentIntentId: "pi_processing_123",
      status: "pending",
      failureReason: null,
    });

    let callCount = 0;
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      callCount++;
      const db = createMockDb();
      if (callCount === 1) {
        (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
          { priceChargedCents: 10000, priceCents: 10000 },
        ]);
      }
      if (callCount === 2) {
        (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { stripeCustomerId: "cus_test", stripePaymentMethodId: "pm_test" },
        ]);
      }
      if (callCount === 3) {
        (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "pending-charge-id" }]);
      }
      return runWithMockDb<T>(callback, db);
      },
    );

    const result = await chargeNoShowFee(APPT_UUID);

    expect(result.success).toBe(true);
    if (result.success && "chargeId" in result) {
      expect(result.chargeId).toBe("pending-charge-id");
      expect(result.status).toBe("pending");
    }
  });

  it("returns error when appointment is already cancelled", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment({ status: "cancelled" }));

    const result = await chargeNoShowFee(APPT_UUID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Cannot charge no-show fee for a cancelled appointment");
    }
  });
});

describe("chargeCancellationFee integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    vi.mocked(withTenantDb).mockImplementation(mockWithDb());
    mockGetConnectChargeParams.mockResolvedValue(null);

    mockGetBusinessSettings.mockResolvedValue({
      noShowFeePercent: 50,
      cancellationFeePercent: 25,
      cancellationWindowHours: 24,
    });

    vi.mocked(isWithinCancellationWindow).mockReturnValue(true);
  });

  it("returns error when appointment not found", async () => {
    mockGetAppointment.mockResolvedValue(null);

    const result = await chargeCancellationFee(APPT_UUID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Appointment not found");
    }
  });

  it("successfully charges cancellation fee", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment());
    mockCancelBooking.mockResolvedValue({ success: true });

    mockProcessOffSessionCharge.mockResolvedValue({
      stripePaymentIntentId: "pi_cancel_123",
      status: "completed",
      failureReason: null,
    });

    let callCount = 0;
    vi.mocked(withTenantDb).mockImplementation(
      async <T>(_slug: string, callback: WithTenantDbCallback) => {
      callCount++;
      const db = createMockDb();
      if (callCount === 1) {
        // getAppointmentServicePrices
        (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
          { priceChargedCents: 8000, priceCents: 8000 },
        ]);
      }
      if (callCount === 2) {
        // getClientStripeIds
        (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { stripeCustomerId: "cus_test", stripePaymentMethodId: "pm_test" },
        ]);
      }
      if (callCount === 3) {
        // Insert charge record
        (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "cancel-charge-id" }]);
      }
      return runWithMockDb<T>(callback, db);
      },
    );

    const originalResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "";

    const result = await chargeCancellationFee(APPT_UUID);

    process.env.RESEND_API_KEY = originalResendKey;

    expect(result.success).toBe(true);
    if (result.success && "chargeId" in result) {
      expect(result.feeCharged).toBe(true);
      expect(result.chargeId).toBe("cancel-charge-id");
      expect(result.amountCents).toBe(2000); // 25% of 8000
    }
    expect(mockProcessOffSessionCharge).toHaveBeenCalledWith({
      amountCents: 2000,
      stripeCustomerId: "cus_test",
      stripePaymentMethodId: "pm_test",
      metadata: {
        appointmentId: APPT_UUID,
        reason: "late_cancellation",
        clientId: CLIENT_UUID,
        tenantSlug: "test-business",
      },
    });
    expect(mockCancelBooking).toHaveBeenCalledWith({ appointmentId: APPT_UUID });
  });

  it("skips fee when outside cancellation window", async () => {
    mockGetAppointment.mockResolvedValue(makeAppointment());
    vi.mocked(isWithinCancellationWindow).mockReturnValue(false);

    const result = await chargeCancellationFee(APPT_UUID);

    expect(result.success).toBe(true);
    if (result.success && "feeCharged" in result) {
      expect(result.feeCharged).toBe(false);
      expect(result.reason).toBe("Outside cancellation window");
    }
    expect(mockProcessOffSessionCharge).not.toHaveBeenCalled();
  });
});
