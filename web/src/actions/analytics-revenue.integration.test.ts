// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const state = vi.hoisted(() => ({ slug: "" }));
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

let t: ScratchTenant;

afterAll(async () => {
  if (t) await t.drop();
});

describe("getRevenueTrend (integration)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("revtrend");
    state.slug = t.slug;
  });

  itDb("counts completed service_payment and package_sale, not deposit, pending or failed", async () => {
    const S = `"${t.schema}"`;
    const [c] = await t.run(
      `INSERT INTO ${S}.clients (name, email) VALUES ('Rev Client', 'rev-${Date.now()}@example.com') RETURNING id`,
    );
    const day = "2031-03-04T15:00:00Z";
    const add = (amount: number, reason: string, status: string) =>
      t.run(
        `INSERT INTO ${S}.charges (client_id, amount_cents, reason, status, created_at)
         VALUES ('${c.id}', ${amount}, '${reason}', '${status}', '${day}')`,
      );
    await add(1000, "service_payment", "completed");
    await add(45000, "package_sale", "completed");
    await add(7000, "deposit", "completed");
    await add(300, "package_sale", "pending");
    await add(500, "package_sale", "failed");
    await add(900, "service_payment", "failed");

    const { getRevenueTrend } = await import("@/actions/analytics");
    const rows = await getRevenueTrend(
      { start: new Date("2031-03-01T00:00:00Z"), end: new Date("2031-03-31T23:59:59Z") },
      "month",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].totalCents).toBe(46000);
    expect(rows[0].count).toBe(2);
  });
});
