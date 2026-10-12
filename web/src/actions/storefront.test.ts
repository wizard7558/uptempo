import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@/lib/custom-fields/values";

const h = vi.hoisted(() => ({
  withTenantDb: vi.fn(),
  defs: [] as FieldDef[],
}));

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: (...args: unknown[]) => h.withTenantDb(...args),
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: async () => ({
    name: "Test Salon",
    status: "active",
    schemaVersion: 56,
    modules: ["storefront"],
  }),
}));
vi.mock("@/lib/booking/session-cookie", () => ({
  getBookingSession: async () => "client-1",
}));
vi.mock("@/lib/stripe/server", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/services/storefront", () => ({ createStorefrontCheckoutSession: vi.fn() }));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/custom-fields/service", () => ({
  listDefinitions: async () => h.defs,
}));

import { getStorefront } from "./storefront";

function query(rows: unknown) {
  const builder: Record<string, () => unknown> = {};
  const self = () => builder;
  builder.from = self;
  builder.where = self;
  builder.orderBy = () => Promise.resolve(rows);
  builder.limit = () => Promise.resolve(rows);
  return builder;
}

const hair: FieldDef = {
  id: "1",
  entity: "client",
  key: "hair_types",
  label: "Hair profile",
  type: "multi",
  options: [
    { value: "all", label: "All" },
    { value: "red", label: "Red" },
  ],
  isActive: true,
  showOnCard: true,
  clientEditable: true,
  matchProductTags: true,
  sort: 10,
};

describe("getStorefront", () => {
  beforeEach(() => {
    h.defs = [hair];
    const products = [
      {
        id: "blonde",
        name: "Blonde only",
        brand: null,
        description: null,
        size: null,
        priceCents: 1000,
        photoUrl: null,
        tags: ["blonde"],
      },
      {
        id: "everyone",
        name: "For everyone",
        brand: null,
        description: null,
        size: null,
        priceCents: 1800,
        photoUrl: null,
        tags: ["all"],
      },
    ];
    const policies = [{ taxBps: 0, shipFlatCents: null }];
    const clients = [{ id: "client-1", name: "Ada", attributes: { hair_types: ["red"] } }];
    const results = [products, policies, clients];
    let call = 0;
    h.withTenantDb.mockImplementation(
      async (_slug: string, fn: (db: unknown, tables: unknown) => Promise<unknown>) => {
        const db = {
          select: () => query(results[call++]),
        };
        const tables = {
          products: { isActive: "is_active", sortOrder: "sort_order", name: "name" },
          businessSettings: { retailTaxBps: "retail_tax_bps", retailShipFlatCents: "retail_ship_flat_cents" },
          clients: { id: "id", name: "name", attributes: "attributes" },
        };
        return fn(db, tables);
      },
    );
  });

  it("sorts a product tagged all ahead of the catalog for a red hair profile", async () => {
    const data = await getStorefront("test-salon");
    expect(data?.products.map((product) => product.name)).toEqual(["For everyone", "Blonde only"]);
    expect(data?.products.map((product) => product.recommended)).toEqual([true, false]);
    expect(data?.client).toEqual({ id: "client-1", name: "Ada" });
  });
});
