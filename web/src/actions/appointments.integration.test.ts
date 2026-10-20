import { describe, it, expect, vi, beforeEach } from "vitest";

// Server translator without a request scope: default hair-industry terms, matching legacy copy.
vi.mock("@/lib/terms/server", async () => {
  const { createTermsT } = await import("@/lib/terms/translator");
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getT: async (namespace?: string) =>
      createTermsT(VERTICALS.hair_salon.terms, namespace ?? ""),
  };
});

// ---- Mocks ---- //

// Mock tenant context
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: vi.fn().mockResolvedValue("test-business"),
}));

vi.mock("@/lib/auth/rbac", () => ({
  getUserRole: async () => "owner",
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-business" }),
  requireAdminRole: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-business" }),
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "test-business" }),
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

// Mock next/headers (required by getTenantSlug indirectly at module level)
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map([["x-tenant-slug", "test-business"]])),
}));

// Mock calendar-sync (dynamic import in reschedule/cancel)
vi.mock("@/lib/calendar/sync-tenant", () => ({
  updateBookingOnCalendarForTenant: vi.fn().mockResolvedValue(undefined),
  deleteBookingFromCalendarForTenant: vi.fn().mockResolvedValue(undefined),
}));

// Mock duration service
const mockGetMultiServiceDuration = vi.fn();
vi.mock("@/lib/services/duration", () => ({
  getMultiServiceDuration: (...args: unknown[]) => mockGetMultiServiceDuration(...args),
}));

// Mock the scheduling service (engine + loader)
const mockCheckBooking = vi.fn();
const mockResolveLocationForBooking = vi.fn();
vi.mock("@/lib/scheduling/service", () => ({
  checkBooking: (...args: unknown[]) => mockCheckBooking(...args),
  resolveBookingLocation: (...args: unknown[]) => mockResolveLocationForBooking(...args),
}));

// The age gate has its own tests (src/lib/consent); here it just lets bookings through.
vi.mock("@/lib/consent/gate", () => ({
  enforceAgeGate: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/services/sync-auto-assistant-tasks", () => ({
  syncAutoAssistantTasksForAppointment: vi.fn().mockResolvedValue(undefined),
}));

// Chainable mock DB builder
function createMockDb() {
  const mockInsertResult = [{ id: "new-appt-id" }];
  const mockSelectResult: unknown[] = [];

  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(mockSelectResult),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(mockInsertResult),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    transaction: vi.fn(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(chain)),
  };

  return chain;
}

let mockDb: ReturnType<typeof createMockDb>;
const mockTables = {
  appointments: { id: "id", staffId: "staffId", clientId: "clientId", status: "status", during: "during", notes: "notes", calendarSyncStatus: "calendarSyncStatus", updatedAt: "updatedAt" },
  appointmentServices: { appointmentId: "appointmentId", serviceId: "serviceId", durationMinutes: "durationMinutes", isOverride: "isOverride" },
  appointmentResources: { appointmentId: "appointmentId", resourceId: "resourceId", during: "during" },
  clients: { id: "id", name: "name", email: "email", phone: "phone", stripePaymentMethodId: "stripePaymentMethodId", stripeCustomerId: "stripeCustomerId" },
  services: { id: "id", name: "name" },
};

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(),
}));

// Mock drizzle-orm operators (they just pass through in tests)
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    ne: vi.fn((...args: unknown[]) => ({ op: "ne", args })),
    sql: vi.fn((...args: unknown[]) => ({ op: "sql", args })),
    asc: vi.fn((...args: unknown[]) => ({ op: "asc", args })),
    inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
  };
});

// Mock appointment-services query module
vi.mock("@/lib/queries/appointment-services", () => ({
  getServicesForAppointment: vi.fn().mockResolvedValue([]),
  getServicesForAppointments: vi.fn().mockResolvedValue(new Map()),
}));

// Import the functions under test
import { createBooking, rescheduleBooking, cancelBooking } from "@/actions/appointments";
import { revalidatePath } from "next/cache";
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

const VALID_UUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const CLIENT_UUID = "b2c3d4e5-f6a7-4901-bcde-f12345678901";
const SERVICE_UUID = "c3d4e5f6-a7b8-4012-8def-123456789012";

// ---- Test Suites ---- //

describe("createBooking integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    // Re-wire withTenantDb to use fresh mockDb
    vi.mocked(withTenantDb).mockImplementation(mockWithDb());
    mockResolveLocationForBooking.mockResolvedValue({
      id: "loc-1",
      name: "Primary Location",
      address: "123 Main St",
    });
    mockCheckBooking.mockResolvedValue({ ok: true, resources: [] });
  });

  it("rejects invalid input (missing serviceIds)", async () => {
    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Should not have touched the database
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("creates appointment with valid input", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBe("new-appt-id");
    }
    expect(withTenantDb).toHaveBeenCalledWith("test-business", expect.any(Function));
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
    expect(
      (mockDb.values as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toEqual(
      expect.objectContaining({
        staffId: VALID_UUID,
        clientId: CLIENT_UUID,
        locationId: "loc-1",
      }),
    );
  });

  it("snapshots resolved price (including overrides) into appointment_services", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: true,
          priceCents: 12345,
          isPriceOverride: true,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(true);
    const valuesCalls = (mockDb.values as ReturnType<typeof vi.fn>).mock.calls;
    const lineItems = valuesCalls
      .map((c) => c[0])
      .find(
        (rows: unknown) =>
          Array.isArray(rows) &&
          rows[0] &&
          typeof rows[0] === "object" &&
          rows[0] !== null &&
          "priceChargedCents" in (rows[0] as object),
      ) as Array<{ priceChargedCents: number }> | undefined;
    expect(lineItems?.[0]?.priceChargedCents).toBe(12345);
  });

  it("returns conflict error when slot is unavailable", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });
    mockCheckBooking.mockResolvedValue({ ok: false, reasons: ["BUSY_APPOINTMENT"] });

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("message", "Time slot conflicts with an existing appointment");
    }
  });

  it("returns conflict error for PostgreSQL exclusion violation", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });

    // Mock withTenantDb to throw a PG exclusion violation
    vi.mocked(withTenantDb).mockRejectedValueOnce(
      Object.assign(new Error("exclusion violation"), { code: "23P01" }),
    );

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("message", "Time slot conflicts with an existing appointment");
    }
  });

  it("recognizes a 23P01 wrapped in a DrizzleQueryError-style cause", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });
    // Drizzle wraps the driver error; the pg code is on `cause`.
    const driver = Object.assign(new Error("exclusion violation"), {
      code: "23P01",
      constraint_name: "appointments_no_overlap",
    });
    vi.mocked(withTenantDb).mockRejectedValueOnce(
      Object.assign(new Error("Failed query: insert into appointments"), {
        cause: driver,
      }),
    );

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("message", "Time slot conflicts with an existing appointment");
      expect(result.error).toHaveProperty("code", "SLOT_TAKEN");
    }
  });

  it("maps a lost resource race to RESOURCE_TAKEN with its own message", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({ services: [], totalMinutes: 60 });
    vi.mocked(withTenantDb).mockRejectedValueOnce(
      Object.assign(new Error("Failed query"), {
        cause: Object.assign(new Error("full"), {
          code: "23P01",
          constraint_name: "appointment_resources_capacity",
        }),
      }),
    );

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("code", "RESOURCE_TAKEN");
      expect(result.error).toHaveProperty(
        "message",
        "A room or piece of equipment this appointment needs is already in use at that time.",
      );
    }
  });

  it("checks the engine in public mode, and in override mode for admin overlap bookings", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });
    const base = {
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    };
    await createBooking(base);
    expect(mockCheckBooking).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "public", totalMinutes: 60, locationId: "loc-1" }),
    );
    await createBooking({ ...base, allowOverlap: true });
    expect(mockCheckBooking).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "override" }),
    );
  });

  it("maps engine rejection reasons to codes and messages", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });
    const args = {
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
    };
    mockCheckBooking.mockResolvedValue({ ok: false, reasons: ["BUSY_BLOCK"] });
    const blocked = await createBooking(args);
    expect(blocked.success).toBe(false);
    if (!blocked.success) {
      expect(blocked.error).toHaveProperty("code", "BLOCKED");
      expect(blocked.error).toHaveProperty("message", "That time is blocked (buffer / time off)");
    }
    mockCheckBooking.mockResolvedValue({ ok: false, reasons: ["TOO_SOON"] });
    const soon = await createBooking(args);
    expect(soon.success).toBe(false);
    if (!soon.success) {
      expect(soon.error).toHaveProperty("code", "TOO_SOON");
      expect(soon.error).toHaveProperty(
        "message",
        "That time is too soon to book. Please choose a later time.",
      );
    }
  });

  it("locks the flex host row with FOR UPDATE before checking for a sibling", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 30,
          isOverride: false,
          priceCents: 3000,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 30,
    });
    const host = {
      id: "d4e5f6a7-b8c9-4123-8ef0-234567890123",
      staffId: VALID_UUID,
      during: {
        start: new Date("2026-03-15T10:00:00.000Z"),
        end: new Date("2026-03-15T11:15:00.000Z"),
      },
      locationId: "loc-1",
      isDoubleBook: 0,
      doubleBookParentAppointmentId: null,
    };
    const forMock = vi.fn().mockResolvedValue([host]);
    const thenable = (rows: unknown[], extra: object = {}) =>
      Object.assign(Promise.resolve(rows), extra);
    const db = Object.assign(createMockDb(), {
      limit: vi
        .fn()
        .mockReturnValueOnce(thenable([{ appointmentsBooked: 1 }])) // client snapshot
        .mockReturnValueOnce(thenable([host], { for: forMock })) // host row
        .mockReturnValueOnce(thenable([])) // sibling check
        .mockReturnValueOnce(
          thenable([{ serviceId: SERVICE_UUID, activeMinutes: 45, processingMinutes: 30 }]),
        ), // first line item
    });
    vi.mocked(withTenantDb).mockImplementation(mockWithDb(db));

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:45:00.000Z",
      isDoubleBook: true,
      doubleBookParentAppointmentId: host.id,
    });

    expect(forMock).toHaveBeenCalledWith("update");
    expect(result.success).toBe(true);
  });

  it("returns location error when the provider is unavailable at the selected location", async () => {
    mockGetMultiServiceDuration.mockResolvedValue({
      services: [
        {
          serviceId: SERVICE_UUID,
          serviceName: "Haircut",
          durationMinutes: 60,
          isOverride: false,
          priceCents: 8500,
          isPriceOverride: false,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      totalMinutes: 60,
    });
    mockResolveLocationForBooking.mockResolvedValue(null);

    const result = await createBooking({
      staffId: VALID_UUID,
      clientId: CLIENT_UUID,
      serviceIds: [SERVICE_UUID],
      startTime: "2026-03-15T10:00:00.000Z",
      locationId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty(
        "message",
        "Stylist is unavailable at the selected location and time",
      );
    }
  });
});

describe("rescheduleBooking integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    vi.mocked(withTenantDb).mockImplementation(mockWithDb());
    mockResolveLocationForBooking.mockResolvedValue({
      id: "loc-1",
      name: "Primary Location",
      address: "123 Main St",
    });
    mockCheckBooking.mockResolvedValue({ ok: true, resources: [] });
  });

  it("rejects invalid input (missing appointmentId)", async () => {
    const result = await rescheduleBooking({
      appointmentId: "not-a-uuid",
      newStartTime: "2026-03-15T14:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("reschedules with valid data", async () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const end = new Date("2026-03-15T11:00:00.000Z");

    // First call: fetch existing appointment
    vi.mocked(withTenantDb)
      .mockImplementationOnce(
        mockWithDb(
          Object.assign(createMockDb(), {
            // First limit: the appointment row; second limit: its line items.
            limit: vi
              .fn()
              .mockResolvedValueOnce([
                { during: { start: now, end }, staffId: VALID_UUID },
              ])
              .mockResolvedValueOnce([
                { serviceId: SERVICE_UUID, durationMinutes: 60 },
              ]),
          }),
        ),
      )
      // Second call: update appointment
      .mockImplementationOnce(mockWithDb());

    const result = await rescheduleBooking({
      appointmentId: VALID_UUID,
      newStartTime: "2026-03-15T14:00:00.000Z",
    });

    expect(result.success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
    expect(mockResolveLocationForBooking).toHaveBeenCalledWith(
      "test-business",
      VALID_UUID,
      new Date("2026-03-15T14:00:00.000Z"),
      null,
      { allowOffShift: true },
    );
  });

  it("rejects a reschedule onto a time block with the block message", async () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const end = new Date("2026-03-15T11:00:00.000Z");
    vi.mocked(withTenantDb).mockImplementationOnce(
      mockWithDb(
        Object.assign(createMockDb(), {
          limit: vi
            .fn()
            .mockResolvedValueOnce([{ during: { start: now, end }, staffId: VALID_UUID }])
            .mockResolvedValueOnce([{ serviceId: SERVICE_UUID, durationMinutes: 60 }]),
        }),
      ),
    );
    mockCheckBooking.mockResolvedValue({ ok: false, reasons: ["BUSY_BLOCK"] });

    const result = await rescheduleBooking({
      appointmentId: VALID_UUID,
      newStartTime: "2026-03-15T14:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty(
        "message",
        "New time overlaps a time block — remove or shorten the block first",
      );
    }
    expect(mockCheckBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "reschedule",
        excludeAppointmentIds: [VALID_UUID],
        totalMinutes: 60,
      }),
    );
  });

  it("recognizes a wrapped 23P01 when the update races", async () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const end = new Date("2026-03-15T11:00:00.000Z");
    vi.mocked(withTenantDb)
      .mockImplementationOnce(
        mockWithDb(
          Object.assign(createMockDb(), {
            limit: vi
              .fn()
              .mockResolvedValueOnce([{ during: { start: now, end }, staffId: VALID_UUID }])
              .mockResolvedValueOnce([]),
          }),
        ),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("Failed query"), {
          cause: Object.assign(new Error("exclusion"), { code: "23P01" }),
        }),
      );

    const result = await rescheduleBooking({
      appointmentId: VALID_UUID,
      newStartTime: "2026-03-15T14:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty(
        "message",
        "New time slot conflicts with an existing appointment",
      );
    }
  });

  it("returns location error when the new time has no valid staff member location", async () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const end = new Date("2026-03-15T11:00:00.000Z");

    vi.mocked(withTenantDb).mockImplementationOnce(
      mockWithDb(
        Object.assign(createMockDb(), {
          limit: vi.fn().mockResolvedValue([
            { during: { start: now, end }, staffId: VALID_UUID, locationId: "loc-1" },
          ]),
        }),
      ),
    );
    mockResolveLocationForBooking.mockResolvedValue(null);

    const result = await rescheduleBooking({
      appointmentId: VALID_UUID,
      newStartTime: "2026-03-15T14:00:00.000Z",
      newLocationId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty(
        "message",
        "Stylist is unavailable at the selected location and time",
      );
    }
  });

  it("returns error when appointment not found", async () => {
    // Return empty array for existing appointment lookup
    vi.mocked(withTenantDb).mockImplementationOnce(
      mockWithDb(
        Object.assign(createMockDb(), {
          limit: vi.fn().mockResolvedValue([]),
        }),
      ),
    );

    const result = await rescheduleBooking({
      appointmentId: VALID_UUID,
      newStartTime: "2026-03-15T14:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("message", "Appointment not found or already cancelled");
    }
  });
});

describe("cancelBooking integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    vi.mocked(withTenantDb).mockImplementation(mockWithDb());
    mockResolveLocationForBooking.mockResolvedValue({
      id: "loc-1",
      name: "Primary Location",
      address: "123 Main St",
    });
    mockCheckBooking.mockResolvedValue({ ok: true, resources: [] });
  });

  it("rejects invalid input (invalid appointmentId)", async () => {
    const result = await cancelBooking({
      appointmentId: "invalid",
    });

    expect(result.success).toBe(false);
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("cancels existing appointment", async () => {
    // First call: fetch staff member ID
    vi.mocked(withTenantDb)
      .mockImplementationOnce(async (_slug, callback) => {
        const fetchDb = createMockDb();
        (fetchDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { staffId: VALID_UUID },
        ]);
        return runWithMockDb(callback, fetchDb);
      })
      // Second call: update appointment
      .mockImplementationOnce(async (_slug, callback) => {
        const updateDb = createMockDb();
        (updateDb.returning as ReturnType<typeof vi.fn>).mockResolvedValue([
          { id: VALID_UUID },
        ]);
        return runWithMockDb(callback, updateDb);
      });

    const result = await cancelBooking({
      appointmentId: VALID_UUID,
      reason: "Client requested",
    });

    expect(result.success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
  });

  it("returns error when appointment not found on update", async () => {
    // First call: fetch staff member ID (found)
    vi.mocked(withTenantDb)
      .mockImplementationOnce(async (_slug, callback) => {
        const fetchDb = createMockDb();
        (fetchDb.limit as ReturnType<typeof vi.fn>).mockResolvedValue([
          { staffId: VALID_UUID },
        ]);
        return runWithMockDb(callback, fetchDb);
      })
      // Second call: update returns empty (no rows updated)
      .mockImplementationOnce(async (_slug, callback) => {
        const updateDb = createMockDb();
        (updateDb.returning as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        return runWithMockDb(callback, updateDb);
      });

    const result = await cancelBooking({
      appointmentId: VALID_UUID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("message", "Appointment not found");
    }
  });
});
