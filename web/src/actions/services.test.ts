import { beforeEach, describe, it, expect, vi } from "vitest";
import { createServiceSchema, updateServiceSchema } from "@/lib/validators/service";
import { createClientSchema } from "@/lib/validators/client";
import { setOverrideSchema } from "@/lib/validators/override";

const actionMocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  getMultiServiceDuration: vi.fn(),
  withTenantDb: vi.fn(),
  getTenantIndustry: vi.fn(),
  revalidatePath: vi.fn(),
  trackEvent: vi.fn(),
  AuthError: class MockAuthError extends Error {},
}));

vi.mock("@/lib/auth/rbac", () => ({
  AuthError: actionMocks.AuthError,
  requireRole: vi.fn(),
  requireStaff: actionMocks.requireStaff,
}));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: actionMocks.withTenantDb }));
vi.mock("@/lib/tenant/industry", () => ({
  getTenantIndustry: actionMocks.getTenantIndustry,
}));
vi.mock("@/lib/services/duration", () => ({
  getMultiServiceDuration: actionMocks.getMultiServiceDuration,
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((...args: unknown[]) => args),
}));
vi.mock("next/cache", () => ({ revalidatePath: actionMocks.revalidatePath }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: actionMocks.trackEvent }));

import {
  importServicePresets,
  listAvailablePresets,
  previewBookingPricing,
} from "./services";
import { getServicePresetsForIndustry } from "@/lib/services/preset-catalog";

beforeEach(() => {
  vi.resetAllMocks();
});

function authenticatePresetAction(industry: string) {
  actionMocks.requireStaff.mockResolvedValue({ tenantSlug: "session-tenant" });
  actionMocks.getTenantIndustry.mockResolvedValue(industry);
}

function mockPresetTenantDb({
  existingNames = [],
  activeStaff = [{ id: "staff-one" }, { id: "staff-two" }],
  insertedIds = ["service-one", "service-two"],
}: {
  existingNames?: string[];
  activeStaff?: { id: string }[];
  insertedIds?: string[];
} = {}) {
  const tables = {
    services: { id: "services.id", name: "services.name", isActive: "services.isActive" },
    staff: { id: "staff.id", isActive: "staff.isActive" },
    staffServices: { staffId: "staffServices.staffId", serviceId: "staffServices.serviceId" },
  };
  const insertedRows: Record<string, unknown>[] = [];
  const staffLinkRows: Record<string, unknown>[] = [];

  const select = () => ({
    from: (table: unknown) => ({
      where: async () =>
        table === tables.staff
          ? activeStaff
          : existingNames.map((name) => ({ name })),
    }),
  });
  const insert = (table: unknown) => ({
    values: (rows: Record<string, unknown>[]) => {
      if (table === tables.services) insertedRows.push(...rows);
      if (table === tables.staffServices) staffLinkRows.push(...rows);
      return {
        returning: async () =>
          table === tables.services
            ? insertedIds.slice(0, rows.length).map((id) => ({ id }))
            : [],
        onConflictDoNothing: async () => undefined,
      };
    },
  });
  const tx = { select, insert };
  const db = {
    select,
    insert,
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };

  actionMocks.withTenantDb.mockImplementation(
    async (_slug: string, callback: (database: typeof db, tenantTables: typeof tables) => Promise<unknown>) =>
      callback(db, tables),
  );

  return { insertedRows, staffLinkRows, tables };
}

describe("class settings", () => {
  const base = { name: "Bootcamp", defaultDurationMinutes: 45 };

  it("requires spots when the service is a class", () => {
    expect(createServiceSchema.safeParse({ ...base, isClass: 1 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity: null }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity: 12 }).success).toBe(true);
  });

  it("limits spots to 1 through 100", () => {
    for (const classCapacity of [0, 101, 2.5]) {
      expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity }).success).toBe(false);
    }
    for (const classCapacity of [1, 100]) {
      expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity }).success).toBe(true);
    }
  });

  it("does not need spots when it is not a class, and applies to updates too", () => {
    expect(createServiceSchema.safeParse({ ...base, isClass: 0 }).success).toBe(true);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(updateServiceSchema.safeParse({ id, isClass: 1 }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ id, isClass: 1, classCapacity: 8 }).success).toBe(true);
  });
});

describe("createServiceSchema", () => {
  it("accepts valid service input", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 60,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createServiceSchema.safeParse({
      name: "",
      defaultDurationMinutes: 60,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration below minimum (5 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 3,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration above maximum (480 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer duration", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 30.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts minimum valid duration (5 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Quick Trim",
      defaultDurationMinutes: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts maximum valid duration (480 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Full Day Session",
      defaultDurationMinutes: 480,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional costCents", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 30,
      priceCents: 5000,
      costCents: 2000,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateServiceSchema", () => {
  it("accepts valid update with all fields", () => {
    const result = updateServiceSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Updated Haircut",
      defaultDurationMinutes: 45,
    });
    expect(result.success).toBe(true);
  });

  it("accepts update with only id and name", () => {
    const result = updateServiceSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Updated Haircut",
    });
    expect(result.success).toBe(true);
  });

  it("rejects update without id", () => {
    const result = updateServiceSchema.safeParse({
      name: "Updated Haircut",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid id", () => {
    const result = updateServiceSchema.safeParse({
      id: "not-a-uuid",
      name: "Updated Haircut",
    });
    expect(result.success).toBe(false);
  });
});

describe("createClientSchema", () => {
  it("rejects when both email and phone are missing", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when both email and phone are null", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: null,
      phone: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts when email is provided without phone", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("accepts when phone is provided without email", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      phone: "555-1234",
    });
    expect(result.success).toBe(true);
  });

  it("accepts when both email and phone are provided", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "555-1234",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email format", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});

describe("setOverrideSchema", () => {
  it("accepts valid override input", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 90,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-uuid clientId", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "not-a-uuid",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 90,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid serviceId", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "not-a-uuid",
      durationMinutes: 90,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration below minimum", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration above maximum", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 500,
    });
    expect(result.success).toBe(false);
  });
});

describe("previewBookingPricing", () => {
  it("returns staff price provenance and preserves the summed price", async () => {
    actionMocks.requireStaff.mockResolvedValueOnce({
      tenantSlug: "test-business",
    });
    actionMocks.getMultiServiceDuration.mockResolvedValueOnce({
      services: [
        {
          serviceId: "svc-1",
          serviceName: "Haircut",
          priceCents: 12500,
          isPriceOverride: true,
          priceSource: "staff",
          category: "cut",
        },
        {
          serviceId: "svc-2",
          serviceName: "Toner",
          priceCents: 4000,
          isPriceOverride: false,
          priceSource: "service",
          category: "color",
        },
      ],
      totalMinutes: 105,
    });

    const result = await previewBookingPricing(
      ["svc-1", "svc-2"],
      "client-1",
      "staff-1",
    );

    expect(actionMocks.getMultiServiceDuration).toHaveBeenCalledWith(
      ["svc-1", "svc-2"],
      "client-1",
      "staff-1",
    );
    expect(result).toEqual({
      services: [
        {
          serviceId: "svc-1",
          serviceName: "Haircut",
          priceCents: 12500,
          isPriceOverride: true,
          priceSource: "staff",
          category: "cut",
        },
        {
          serviceId: "svc-2",
          serviceName: "Toner",
          priceCents: 4000,
          isPriceOverride: false,
          priceSource: "service",
          category: "color",
        },
      ],
      totalCents: 16500,
    });
  });
});

describe("industry service preset actions", () => {
  it("lists presets from the authenticated tenant industry and filters existing names", async () => {
    const tattooPresets = getServicePresetsForIndustry("tattoo");
    authenticatePresetAction("tattoo");
    mockPresetTenantDb({ existingNames: ["  sMaLl PiEcE  ", "Existing service"] });

    const result = await listAvailablePresets();

    expect(actionMocks.requireStaff).toHaveBeenCalledOnce();
    expect(actionMocks.getTenantIndustry).toHaveBeenCalledWith("session-tenant");
    expect(actionMocks.withTenantDb).toHaveBeenCalledWith(
      "session-tenant",
      expect.any(Function),
    );
    expect(result).toEqual(tattooPresets.filter((preset) => preset.name !== "Small piece"));
  });

  it("imports ordered class presets with their settings and active-staff links", async () => {
    const trainingPresets = getServicePresetsForIndustry("personal_training");
    const bootcamp = trainingPresets.find((preset) => preset.name === "Bootcamp");
    const session = trainingPresets.find((preset) => preset.name === "1:1 session, 30 min");
    expect(bootcamp).toBeDefined();
    expect(session).toBeDefined();

    authenticatePresetAction("personal_training");
    const db = mockPresetTenantDb({ insertedIds: ["bootcamp-id", "session-id"] });

    const result = await importServicePresets([bootcamp!.key, session!.key]);

    expect(actionMocks.getTenantIndustry).toHaveBeenCalledWith("session-tenant");
    expect(actionMocks.withTenantDb).toHaveBeenCalledWith(
      "session-tenant",
      expect.any(Function),
    );
    expect(result).toEqual({ success: true, ids: ["bootcamp-id", "session-id"] });
    expect(db.insertedRows).toEqual([
      {
        name: "Bootcamp",
        description: "",
        defaultDurationMinutes: 45,
        priceCents: 2000,
        category: "classes",
        activeMinutes: null,
        processingMinutes: null,
        depositType: null,
        depositAmount: null,
        isClass: 1,
        classCapacity: 12,
      },
      {
        name: "1:1 session, 30 min",
        description: "",
        defaultDurationMinutes: 30,
        priceCents: 4500,
        category: "personal",
        activeMinutes: null,
        processingMinutes: null,
        depositType: null,
        depositAmount: null,
        isClass: 0,
        classCapacity: null,
      },
    ]);
    expect(db.staffLinkRows).toEqual([
      { staffId: "staff-one", serviceId: "bootcamp-id" },
      { staffId: "staff-one", serviceId: "session-id" },
      { staffId: "staff-two", serviceId: "bootcamp-id" },
      { staffId: "staff-two", serviceId: "session-id" },
    ]);
    expect(actionMocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/services",
      "/settings/staff",
      "/schedule",
    ]);
    expect(actionMocks.trackEvent).toHaveBeenCalledWith(
      "service.presets_imported",
      { count: 2 },
      { tenantSlug: "session-tenant" },
    );
  });

  it("imports tattoo deposits using the authenticated pack", async () => {
    const tattooPresets = getServicePresetsForIndustry("tattoo");
    const smallPiece = tattooPresets.find((preset) => preset.name === "Small piece");
    expect(smallPiece).toBeDefined();
    authenticatePresetAction("tattoo");
    const db = mockPresetTenantDb({ insertedIds: ["tattoo-service"] });

    const result = await importServicePresets([smallPiece!.key]);

    expect(result).toEqual({ success: true, ids: ["tattoo-service"] });
    expect(db.insertedRows[0]).toMatchObject({
      name: "Small piece",
      depositType: "fixed",
      depositAmount: 5000,
      isClass: 0,
      classCapacity: null,
    });
  });

  it("rejects unknown, foreign-pack, duplicate, and malformed keys before database writes", async () => {
    const validTattooKey = getServicePresetsForIndustry("tattoo")[0].key;
    const foreignBarberKey = getServicePresetsForIndustry("barber")[0].key;
    const invalidSelections: unknown[] = [
      [validTattooKey, "unknown:key"],
      [validTattooKey, foreignBarberKey],
      [validTattooKey, validTattooKey],
      [validTattooKey, 7],
      null,
    ];

    for (const selection of invalidSelections) {
      authenticatePresetAction("tattoo");

      const result = await importServicePresets(selection as string[]);

      expect(result).toEqual({
        success: false,
        error: { message: "No valid presets" },
      });
      expect(actionMocks.withTenantDb).not.toHaveBeenCalled();
    }
  });

  it("keeps the empty import result and does not open a tenant database", async () => {
    authenticatePresetAction("tattoo");

    await expect(importServicePresets([])).resolves.toEqual({
      success: true,
      ids: [],
    });
    expect(actionMocks.getTenantIndustry).not.toHaveBeenCalled();
    expect(actionMocks.withTenantDb).not.toHaveBeenCalled();
  });

  it("returns a safe error for database failures and propagates authorization errors", async () => {
    const validKey = getServicePresetsForIndustry("tattoo")[0].key;
    authenticatePresetAction("tattoo");
    actionMocks.withTenantDb.mockRejectedValueOnce(new Error("private database detail"));

    await expect(importServicePresets([validKey])).resolves.toEqual({
      success: false,
      error: { message: "Failed to import presets" },
    });

    const authError = new actionMocks.AuthError("authorization failed");
    authenticatePresetAction("tattoo");
    actionMocks.withTenantDb.mockRejectedValueOnce(authError);
    await expect(importServicePresets([validKey])).rejects.toBe(authError);

    actionMocks.requireStaff.mockRejectedValueOnce(authError);
    await expect(importServicePresets([validKey])).rejects.toBe(authError);
  });
});
