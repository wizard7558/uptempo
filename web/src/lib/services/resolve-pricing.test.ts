import { describe, it, expect, beforeEach, vi } from "vitest";

// Module-level mocks must be set before importing the module under test.
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: vi.fn().mockResolvedValue("test"),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({ get: vi.fn() })),
  cookies: vi.fn(),
}));

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(),
}));

import { withTenantDb } from "@/lib/db/tenant";
import { resolveServicePricing } from "./resolve-pricing";
import { getMultiServiceDuration } from "./duration";

interface ServiceRow {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  priceCents: number | null;
  category: string;
  activeMinutes: number | null;
  processingMinutes: number | null;
}

interface ClientOverrideRow {
  serviceId: string;
  durationMinutes: number | null;
  priceCents: number | null;
  activeMinutes: number | null;
  processingMinutes: number | null;
}

interface StaffOverrideRow {
  serviceId: string;
  durationMinutes: number | null;
  priceCents: number | null;
  activeMinutes: number | null;
  processingMinutes: number | null;
  customName: string | null;
  isOffered: number;
}

/**
 * Build a fake `withTenantDb` that yields a chain-able query builder backed
 * by in-memory arrays. Matches the surface area resolveServicePricing uses:
 * .select(...).from(table).where(...).
 */
function mockTenantDb(opts: {
  services: ServiceRow[];
  clientOverrides?: ClientOverrideRow[];
  staffOverrides?: StaffOverrideRow[];
}) {
  const tables = {
    services: { __kind: "services" } as const,
    clientServiceOverrides: { __kind: "clientServiceOverrides" } as const,
    staffServices: { __kind: "staffServices" } as const,
  };

  const data: Record<string, unknown[]> = {
    services: opts.services,
    clientServiceOverrides: opts.clientOverrides ?? [],
    staffServices: opts.staffOverrides ?? [],
  };

  function makeBuilder(kind: keyof typeof data) {
    return {
      from() {
        return {
          where() {
            return Promise.resolve(data[kind]);
          },
        };
      },
    };
  }

  const db = {
    select() {
      return {
        from(table: { __kind: keyof typeof data }) {
          return makeBuilder(table.__kind).from();
        },
      };
    },
  };

  vi.mocked(withTenantDb).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_slug: string, cb: any) => cb(db as never, tables as never),
  );
}

describe("resolveServicePricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result for empty serviceIds", async () => {
    const result = await resolveServicePricing([], "client-1", "staff-1");
    expect(result).toEqual({ services: [], totalMinutes: 0, totalCents: 0 });
  });

  it("uses catalog defaults when no overrides exist", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
    });

    const result = await resolveServicePricing(["svc-1"], null, null);
    expect(result.services).toHaveLength(1);
    const r = result.services[0];
    expect(r.serviceName).toBe("Haircut");
    expect(r.durationMinutes).toBe(60);
    expect(r.priceCents).toBe(8500);
    expect(r.durationSource).toBe("service");
    expect(r.priceSource).toBe("service");
    expect(r.isOverride).toBe(false);
    expect(r.isPriceOverride).toBe(false);
    expect(r.isHiddenByStaffMember).toBe(false);
    expect(result.totalMinutes).toBe(60);
    expect(result.totalCents).toBe(8500);
  });

  it("treats null catalog price as zero", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Consultation",
          defaultDurationMinutes: 30,
          priceCents: null,
          category: "other",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
    });
    const result = await resolveServicePricing(["svc-1"], null, null);
    expect(result.services[0].priceCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });

  it("applies staff override when no client override exists", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: 75,
          priceCents: 12500,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
      ],
    });

    const result = await resolveServicePricing(
      ["svc-1"],
      "client-1",
      "staff-1",
    );
    const r = result.services[0];
    expect(r.durationMinutes).toBe(75);
    expect(r.priceCents).toBe(12500);
    expect(r.durationSource).toBe("staff");
    expect(r.priceSource).toBe("staff");
    expect(r.isOverride).toBe(true);
    expect(r.isPriceOverride).toBe(true);
  });

  it("client override beats staff override beats catalog (per field)", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Color",
          defaultDurationMinutes: 120,
          priceCents: 12500,
          category: "color",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: 150,
          priceCents: 18500,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
      ],
      clientOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: null, // client doesn't override duration
          priceCents: 10000, // client overrides price
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
    });

    const result = await resolveServicePricing(
      ["svc-1"],
      "client-1",
      "staff-1",
    );
    const r = result.services[0];
    // duration: staff wins (client null, staff 150)
    expect(r.durationMinutes).toBe(150);
    expect(r.durationSource).toBe("staff");
    // price: client wins
    expect(r.priceCents).toBe(10000);
    expect(r.priceSource).toBe("client");
  });

  it("staff customName wins over catalog name", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: null,
          priceCents: null,
          activeMinutes: null,
          processingMinutes: null,
          customName: "Riley's signature haircut",
          isOffered: 1,
        },
      ],
    });
    const result = await resolveServicePricing(
      ["svc-1"],
      null,
      "staff-1",
    );
    expect(result.services[0].serviceName).toBe(
      "Riley's signature haircut",
    );
  });

  it("flags isHiddenByStylist when isOffered=0", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: null,
          priceCents: null,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 0,
        },
      ],
    });
    const result = await resolveServicePricing(
      ["svc-1"],
      null,
      "staff-1",
    );
    expect(result.services[0].isHiddenByStaffMember).toBe(true);
  });

  it("skips client/staff queries when ids are null", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      // even though overrides exist, they should not be applied without ids
      clientOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: 999,
          priceCents: 99,
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: 555,
          priceCents: 55,
          activeMinutes: null,
          processingMinutes: null,
          customName: "x",
          isOffered: 1,
        },
      ],
    });

    const result = await resolveServicePricing(["svc-1"], null, null);
    expect(result.services[0].durationMinutes).toBe(60);
    expect(result.services[0].priceCents).toBe(8500);
    expect(result.services[0].durationSource).toBe("service");
    expect(result.services[0].priceSource).toBe("service");
  });

  it("aggregates totals across multiple services with mixed sources", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
        {
          id: "svc-2",
          name: "Toner",
          defaultDurationMinutes: 30,
          priceCents: 4000,
          category: "color",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: null,
          priceCents: 12500,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
      ],
    });

    const result = await resolveServicePricing(
      ["svc-1", "svc-2"],
      null,
      "staff-1",
    );
    expect(result.totalMinutes).toBe(90);
    expect(result.totalCents).toBe(16500);
  });

  it("propagates active/processing overrides independently", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Color",
          defaultDurationMinutes: 120,
          priceCents: 12500,
          category: "color",
          activeMinutes: 45,
          processingMinutes: 35,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: null,
          priceCents: null,
          activeMinutes: 60,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
      ],
    });
    const result = await resolveServicePricing(
      ["svc-1"],
      null,
      "staff-1",
    );
    expect(result.services[0].activeMinutes).toBe(60);
    // processing falls through to catalog default since staff did not override it
    expect(result.services[0].processingMinutes).toBe(35);
  });

  it("keeps zero-valued staff and client price overrides with their sources", async () => {
    mockTenantDb({
      services: [
        {
          id: "staff-zero",
          name: "Staff price",
          defaultDurationMinutes: 30,
          priceCents: 5000,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
        {
          id: "client-zero",
          name: "Client price",
          defaultDurationMinutes: 30,
          priceCents: 7000,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "staff-zero",
          durationMinutes: null,
          priceCents: 0,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
        {
          serviceId: "client-zero",
          durationMinutes: null,
          priceCents: 9000,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
      ],
      clientOverrides: [
        {
          serviceId: "client-zero",
          durationMinutes: null,
          priceCents: 0,
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
    });

    const result = await resolveServicePricing(
      ["staff-zero", "client-zero"],
      "client-1",
      "staff-1",
    );

    expect(result.services.map((service) => service.priceCents)).toEqual([0, 0]);
    expect(result.services.map((service) => service.priceSource)).toEqual([
      "staff",
      "client",
    ]);
    expect(result.services.every((service) => service.isPriceOverride)).toBe(true);
    expect(result.totalCents).toBe(0);
  });

  it("forwards staff provenance through the duration wrapper", async () => {
    mockTenantDb({
      services: [
        {
          id: "svc-1",
          name: "Haircut",
          defaultDurationMinutes: 60,
          priceCents: 8500,
          category: "cut",
          activeMinutes: null,
          processingMinutes: null,
        },
      ],
      staffOverrides: [
        {
          serviceId: "svc-1",
          durationMinutes: 75,
          priceCents: 12500,
          activeMinutes: null,
          processingMinutes: null,
          customName: null,
          isOffered: 1,
        },
      ],
    });

    const result = await getMultiServiceDuration(["svc-1"], null, "staff-1");

    expect(result.services[0]).toMatchObject({
      durationMinutes: 75,
      priceCents: 12500,
      durationSource: "staff",
      priceSource: "staff",
    });
    expect(result.totalMinutes).toBe(75);
  });
});
