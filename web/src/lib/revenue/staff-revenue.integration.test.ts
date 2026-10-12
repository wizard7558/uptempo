// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const state = vi.hoisted(() => ({ slug: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: async () => state.slug,
  getTenantSlugOrNull: async () => state.slug,
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/tenant/modules", () => ({
  hasModule: async () => true,
  assertModule: async () => undefined,
  ModuleDisabledError: class extends Error {},
}));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (key: string) => key }));

let t: ScratchTenant;
const s = () => `"${t.schema}"`;
const one = async (q: string) => String((await t.run(q))[0].id);

afterAll(async () => {
  if (t) await t.drop();
});

describe("per-staff revenue", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("staffrev");
    state.slug = t.slug;
  });

  itDb("counts a package_sale in the staff member who sold it", async () => {
    const client = await one(`insert into ${s()}.clients (name) values ('Casey') returning id`);
    const avery = await one(
      `insert into ${s()}.staff (display_name, user_id) values ('Avery', 'u1') returning id`,
    );
    const blair = await one(
      `insert into ${s()}.staff (display_name, user_id) values ('Blair', 'u2') returning id`,
    );
    const averyVisit = await one(
      `insert into ${s()}.appointments (staff_id, client_id, during) values ('${avery}','${client}', tstzrange('2026-08-03T14:00:00Z','2026-08-03T15:00:00Z','[)')) returning id`,
    );
    const blairVisit = await one(
      `insert into ${s()}.appointments (staff_id, client_id, during) values ('${blair}','${client}', tstzrange('2026-08-04T14:00:00Z','2026-08-04T15:00:00Z','[)')) returning id`,
    );
    const charge = (appointmentId: string, amount: number, reason: string) =>
      t.run(
        `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${appointmentId}','${client}',${amount},'${reason}','completed')`,
      );
    await charge(averyVisit, 12000, "service_payment");
    await charge(averyVisit, 5000, "deposit");
    await charge(averyVisit, 99999, "gift_card_issue");
    await charge(blairVisit, 3000, "service_payment");

    const { savePackage, sellPackageAdmin } = await import("@/actions/packages");
    const pack = await savePackage({
      name: "Five sessions",
      priceCents: 45000,
      credits: 5,
      validDays: null,
      eligibleServiceIds: [],
      isActive: true,
    });
    if (!pack.success) throw new Error(pack.error);
    const sold = await sellPackageAdmin({ clientId: client, packageId: pack.id, payment: "cash" });
    expect(sold.success).toBe(true);

    const { getStaffRevenue } = await import("@/actions/checkout");
    const rows = await getStaffRevenue({
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2035-01-01T00:00:00Z"),
    });
    expect(rows.find((r) => r.staffId === avery)).toMatchObject({
      staffName: "Avery",
      totalCents: 57000,
      tipsCents: 0,
      serviceCents: 57000,
      platformFeeCents: 0,
      netCents: 57000,
      chargeCount: 2,
    });
    expect(rows.find((r) => r.staffId === blair)).toMatchObject({
      staffName: "Blair",
      totalCents: 3000,
      chargeCount: 1,
    });
  });
});
