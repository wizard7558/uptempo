import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVertical } from "@/lib/verticals";

const h = vi.hoisted(() => ({
  withTenantDb: vi.fn(),
  existingCategories: [] as Array<{ slug: string }>,
  insertedCategoryRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: vi.fn(async () => ({
    slug: "tattoo-shop",
    name: "Tattoo shop",
    timezone: "America/Los_Angeles",
    industry: "tattoo",
  })),
}));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: h.withTenantDb }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })) };
});

import { seedIndustryPack } from "./pack-seed";

const tables = {
  staff: { name: "staff", userId: "staff.user_id" },
  locations: { name: "locations" },
  workingHours: { name: "working_hours" },
  serviceCategories: { name: "service_categories", slug: "categories.slug" },
  services: { name: "services" },
  staffServices: { name: "staff_services" },
  businessSettings: { name: "business_settings" },
  formTemplates: { name: "form_templates" },
  brandingSettings: { name: "branding_settings" },
};

function mockTenantDb() {
  const rowsFor = (table: unknown) => {
    if (table === tables.staff) return [{ id: "owner-staff" }];
    if (table === tables.locations) return [{ id: "location" }];
    if (table === tables.workingHours) return [{ id: "hours" }];
    if (table === tables.serviceCategories) return h.existingCategories;
    if (table === tables.services) return [{ id: "existing-service" }];
    if (table === tables.staffServices) return [{ id: "existing-link" }];
    if (table === tables.businessSettings) return [{ id: "policy" }];
    if (table === tables.formTemplates) return [{ id: "form" }];
    if (table === tables.brandingSettings) return [{ id: "branding" }];
    return [];
  };

  const select = vi.fn(() => {
    let selectedTable: unknown;
    const query = {
      from: vi.fn((table: unknown) => {
        selectedTable = table;
        return query;
      }),
      where: vi.fn(() => query),
      limit: vi.fn(async () => rowsFor(selectedTable)),
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(rowsFor(selectedTable)).then(resolve, reject),
    };
    return query;
  });
  const insertChain = {
    values: vi.fn((rows: Array<Record<string, unknown>>) => {
      h.insertedCategoryRows = rows;
      return insertChain;
    }),
    onConflictDoNothing: vi.fn(async () => undefined),
  };
  const db = {
    select,
    insert: vi.fn((table: unknown) =>
      table === tables.serviceCategories
        ? insertChain
        : { values: vi.fn(async () => undefined) },
    ),
  };

  h.withTenantDb.mockImplementation(
    async (
      _slug: string,
      callback: (dbArg: typeof db, tableArg: typeof tables) => unknown,
    ) => callback(db, tables),
  );
  return db;
}

describe("seedIndustryPack service categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.existingCategories = [];
    h.insertedCategoryRows = [];
  });

  it("marks newly inserted pack categories as default rows", async () => {
    const db = mockTenantDb();

    await seedIndustryPack("tattoo-shop", "owner-user");

    expect(h.withTenantDb).toHaveBeenCalledWith(
      "tattoo-shop",
      expect.any(Function),
    );
    expect(h.insertedCategoryRows).toEqual(
      getVertical("tattoo").categories.map((category, index) => ({
        slug: category.slug,
        name: category.name,
        sortOrder: index,
        isDefault: 1,
        isActive: 1,
      })),
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("leaves existing category rows untouched", async () => {
    h.existingCategories = getVertical("tattoo").categories.map((category) => ({
      slug: category.slug,
    }));
    const db = mockTenantDb();

    await seedIndustryPack("tattoo-shop", "owner-user");

    expect(h.insertedCategoryRows).toEqual([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
