// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;
vi.setConfig({ testTimeout: 120_000 });

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
vi.mock("@/lib/booking/session-cookie", () => ({ getBookingSession: async () => null }));
vi.mock("@/lib/stripe/connect-charge-params", () => ({ getConnectChargeParams: async () => null }));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (key: string) => key }));

let t: ScratchTenant;
const s = () => `"${t.schema}"`;
const one = async (q: string) => String((await t.run(q))[0].id);

let clientId = "";
let packId = "";

afterAll(async () => {
  delete process.env.PAYMENTS_FAKE;
  if (t) await t.drop();
});

describe("selling and adjusting packs against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    process.env.PAYMENTS_FAKE = "1";
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("packs");
    state.slug = t.slug;
    clientId = await one(
      `insert into ${s()}.clients (name, stripe_customer_id, stripe_payment_method_id) values ('Casey', 'cus_fake', 'pm_fake') returning id`,
    );
  }, 120_000);

  async function newPack(over: Partial<{ credits: number; validDays: number | null; priceCents: number }> = {}) {
    const { savePackage } = await import("@/actions/packages");
    const res = await savePackage({
      name: "Ten sessions",
      priceCents: over.priceCents ?? 50000,
      credits: over.credits ?? 10,
      validDays: over.validDays === undefined ? 90 : over.validDays,
      eligibleServiceIds: [],
      isActive: true,
    });
    if (!res.success) throw new Error(res.error);
    return res.id;
  }

  /** A fresh client so the 60-second duplicate guard never trips between tests. */
  async function newClient(name: string) {
    return one(
      `insert into ${s()}.clients (name, stripe_customer_id, stripe_payment_method_id) values ('${name}', 'cus_fake', 'pm_fake') returning id`,
    );
  }

  itDb("a cash sale makes a pack, one purchase row and a charge with no appointment", async () => {
    const { sellPackageAdmin } = await import("@/actions/packages");
    packId = await newPack();
    const res = await sellPackageAdmin({ clientId, packageId: packId, payment: "cash" });
    expect(res.success).toBe(true);
    const cpId = (res as { clientPackageId: string }).clientPackageId;

    const [cp] = await t.run(`select * from ${s()}.client_packages where id = '${cpId}'`);
    expect(cp.credits_remaining).toBe(10);
    expect(cp.credits_total).toBe(10);
    expect(cp.name).toBe("Ten sessions");
    expect(cp.price_cents).toBe(50000);

    const ledger = await t.run(`select * from ${s()}.credit_ledger where client_package_id = '${cpId}'`);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ reason: "purchase", delta: 10, balance_after: 10, reference_id: `cash:${cpId}` });

    const charges = await t.run(`select * from ${s()}.charges where client_package_id = '${cpId}'`);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      appointment_id: null,
      reason: "package_sale",
      amount_cents: 50000,
      status: "completed",
      client_id: clientId,
    });
  });

  itDb("a card sale with the fake uses the payment intent id as the reference", async () => {
    const { sellPackageAdmin } = await import("@/actions/packages");
    const c = await newClient("Dana");
    const res = await sellPackageAdmin({ clientId: c, packageId: packId, payment: "card_on_file" });
    expect(res.success).toBe(true);
    const cpId = (res as { clientPackageId: string }).clientPackageId;
    const [charge] = await t.run(`select * from ${s()}.charges where client_package_id = '${cpId}'`);
    expect(charge.appointment_id).toBeNull();
    expect(charge.reason).toBe("package_sale");
    expect(String(charge.stripe_payment_intent_id)).toMatch(/^pi_fake_/);
    const [entry] = await t.run(`select * from ${s()}.credit_ledger where client_package_id = '${cpId}'`);
    expect(entry.reason).toBe("purchase");
    expect(entry.reference_id).toBe(charge.stripe_payment_intent_id);
    const [cp] = await t.run(`select stripe_payment_intent_id, credits_remaining from ${s()}.client_packages where id = '${cpId}'`);
    expect(cp.stripe_payment_intent_id).toBe(charge.stripe_payment_intent_id);
    expect(cp.credits_remaining).toBe(10);
  });

  itDb("refuses the same pack for the same client twice within a minute", async () => {
    const { sellPackageAdmin } = await import("@/actions/packages");
    const c = await newClient("Eli");
    expect((await sellPackageAdmin({ clientId: c, packageId: packId, payment: "card_on_file" })).success).toBe(true);
    const again = await sellPackageAdmin({ clientId: c, packageId: packId, payment: "card_on_file" });
    expect(again).toEqual({ success: false, error: "errors.duplicate" });
    const [{ n }] = await t.run(`select count(*)::int as n from ${s()}.charges where client_id = '${c}'`);
    expect(n).toBe(1);
  });

  itDb("a card sale without a saved card fails and writes nothing", async () => {
    const { sellPackageAdmin } = await import("@/actions/packages");
    const c = await one(`insert into ${s()}.clients (name) values ('Nocard') returning id`);
    const res = await sellPackageAdmin({ clientId: c, packageId: packId, payment: "card_on_file" });
    expect(res.success).toBe(false);
    const [{ n }] = await t.run(`select count(*)::int as n from ${s()}.client_packages where client_id = '${c}'`);
    expect(n).toBe(0);
  });

  itDb("valid_days 30 sets expires_at about 30 days out; never leaves it empty", async () => {
    const { sellPackageAdmin } = await import("@/actions/packages");
    const p30 = await newPack({ validDays: 30 });
    const forever = await newPack({ validDays: null });
    const c = await newClient("Fran");
    const r1 = await sellPackageAdmin({ clientId: c, packageId: p30, payment: "cash" });
    const r2 = await sellPackageAdmin({ clientId: c, packageId: forever, payment: "cash" });
    const [a] = await t.run(
      `select extract(epoch from (expires_at - now())) / 86400 as days from ${s()}.client_packages where id = '${(r1 as { clientPackageId: string }).clientPackageId}'`,
    );
    expect(Number(a.days)).toBeGreaterThan(29.99);
    expect(Number(a.days)).toBeLessThan(30.01);
    const [b] = await t.run(
      `select expires_at from ${s()}.client_packages where id = '${(r2 as { clientPackageId: string }).clientPackageId}'`,
    );
    expect(b.expires_at).toBeNull();
  });

  itDb("adjustCredits changes the balance and refuses to go below zero", async () => {
    const { sellPackageAdmin, adjustCredits } = await import("@/actions/packages");
    const c = await newClient("Gus");
    const sold = await sellPackageAdmin({ clientId: c, packageId: await newPack({ credits: 5 }), payment: "cash" });
    const cpId = (sold as { clientPackageId: string }).clientPackageId;

    expect(await adjustCredits({ clientPackageId: cpId, delta: -3, note: "Used offline" })).toEqual({
      success: true,
      balance: 2,
    });
    const [cp] = await t.run(`select credits_remaining from ${s()}.client_packages where id = '${cpId}'`);
    expect(cp.credits_remaining).toBe(2);
    const [entry] = await t.run(
      `select * from ${s()}.credit_ledger where client_package_id = '${cpId}' and reason = 'adjust'`,
    );
    expect(entry).toMatchObject({ delta: -3, balance_after: 2, note: "Used offline", created_by: "u1" });

    // The mocked translator returns keys, so the message is the packages.insufficient key.
    expect(await adjustCredits({ clientPackageId: cpId, delta: -3, note: "Too many" })).toEqual({
      success: false,
      error: "insufficient",
    });
    const [after] = await t.run(`select credits_remaining from ${s()}.client_packages where id = '${cpId}'`);
    expect(after.credits_remaining).toBe(2);
  });

  itDb("getClientCredits returns the packs and the ledger newest first", async () => {
    const { sellPackageAdmin, adjustCredits, getClientCredits } = await import("@/actions/packages");
    const c = await newClient("Hal");
    const sold = await sellPackageAdmin({ clientId: c, packageId: await newPack({ credits: 4 }), payment: "cash" });
    const cpId = (sold as { clientPackageId: string }).clientPackageId;
    await adjustCredits({ clientPackageId: cpId, delta: -1, note: "one" });
    await adjustCredits({ clientPackageId: cpId, delta: 2, note: "two" });

    const out = await getClientCredits(c);
    expect(out.canManage).toBe(true);
    expect(out.packages).toHaveLength(1);
    expect(out.packages[0]).toMatchObject({ id: cpId, name: "Ten sessions", creditsRemaining: 5, creditsTotal: 4 });
    expect(out.ledger.map((e) => [e.change, e.reason, e.balanceAfter])).toEqual([
      ["+2", "adjust", 5],
      ["−1", "adjust", 3],
      ["+4", "purchase", 4],
    ]);
  });
});
