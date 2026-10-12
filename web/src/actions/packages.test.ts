// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";

const PACK = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CP = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => {
  class ModuleDisabledError extends Error {}
  class CreditError extends Error {
    code = "INSUFFICIENT" as const;
  }
  return {
    ModuleDisabledError,
    CreditError,
    requireRole: vi.fn(),
    assertModule: vi.fn(),
    hasModule: vi.fn(),
    getBookingSession: vi.fn(),
    charge: vi.fn(),
    refund: vi.fn(),
    appendCredit: vi.fn(),
    connect: vi.fn(),
    /** Rows handed to successive awaited queries. */
    queue: [] as unknown[],
    writes: [] as string[],
    failTransaction: false,
  };
});

function chain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(h.queue.shift() ?? []);
      }
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string, values?: Record<string, string>) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return String(node).replace(/\{(\w+)\}/g, (m, k) => values?.[k] ?? m);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: h.requireRole,
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "acme" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => "acme" }));
vi.mock("@/lib/tenant/modules", () => ({
  assertModule: h.assertModule,
  hasModule: h.hasModule,
  ModuleDisabledError: h.ModuleDisabledError,
}));
vi.mock("@/lib/booking/session-cookie", () => ({ getBookingSession: h.getBookingSession }));
vi.mock("@/lib/services/charge-processing", () => ({ processOffSessionCharge: h.charge }));
vi.mock("@/lib/stripe/connect-charge-params", () => ({ getConnectChargeParams: h.connect }));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({ refunds: { create: h.refund } }),
}));
vi.mock("@/lib/credits/ledger", () => ({
  appendCredit: h.appendCredit,
  CreditError: h.CreditError,
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, fn: (db: unknown, t: unknown) => unknown) => {
    const tables = new Proxy({}, { get: () => new Proxy({}, { get: (_t, c) => String(c) }) });
    const writer = (kind: string) => () => {
      h.writes.push(kind);
      return chain();
    };
    const db = {
      select: () => chain(),
      insert: writer("insert"),
      update: writer("update"),
      transaction: async (cb: (tx: unknown) => unknown) => {
        h.writes.push("transaction");
        if (h.failTransaction) throw new Error("db down");
        return cb({ select: () => chain(), insert: writer("tx.insert"), update: writer("tx.update") });
      },
    };
    return fn(db, tables);
  },
}));

import {
  adjustCredits,
  buyPackage,
  getClientCredits,
  listPackages,
  listPackagesPublic,
  savePackage,
  sellPackageAdmin,
} from "./packages";

const owner = () =>
  h.requireRole.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "acme" });

const validPack = {
  name: "Ten sessions",
  priceCents: 50000,
  credits: 10,
  validDays: 90,
  eligibleServiceIds: [],
  isActive: true,
};

const packRow = { id: PACK, name: "Ten sessions", priceCents: 50000, credits: 10, validDays: 90, eligibleServiceIds: [] };
const cardClient = { id: CLIENT, stripeCustomerId: "cus_1", stripePaymentMethodId: "pm_1" };

beforeEach(() => {
  for (const f of [h.requireRole, h.assertModule, h.hasModule, h.getBookingSession, h.charge, h.refund, h.appendCredit, h.connect]) {
    f.mockReset();
  }
  h.assertModule.mockResolvedValue(undefined);
  h.hasModule.mockResolvedValue(true);
  h.connect.mockResolvedValue(null);
  h.appendCredit.mockResolvedValue({ id: "l1", balanceAfter: 10 });
  h.queue.length = 0;
  h.writes.length = 0;
  h.failTransaction = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("role and module gating", () => {
  it("admin actions ask for owner or admin and the packages module", async () => {
    owner();
    await listPackages();
    expect(h.requireRole).toHaveBeenCalledWith("owner", "admin");
    expect(h.assertModule).toHaveBeenCalledWith("acme", "packages");
  });

  it("the client credits view also lets a provider look", async () => {
    owner();
    h.queue.push([]);
    await getClientCredits(CLIENT);
    expect(h.requireRole).toHaveBeenCalledWith("owner", "admin", "provider");
    expect(h.assertModule).toHaveBeenCalledWith("acme", "packages");
  });

  it("writes return the module-off sentence and touch nothing", async () => {
    owner();
    h.assertModule.mockRejectedValue(new h.ModuleDisabledError("Session packs is turned off."));
    const off = { success: false, error: "Session packs is turned off." };
    expect(await savePackage(validPack)).toEqual(off);
    expect(await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "cash" })).toEqual(off);
    expect(await adjustCredits({ clientPackageId: CP, delta: 1, note: "x" })).toEqual(off);
    expect(await buyPackage(PACK)).toEqual(off);
    expect(h.writes).toEqual([]);
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("the public list is empty when the module is off", async () => {
    h.hasModule.mockResolvedValue(false);
    expect(await listPackagesPublic()).toEqual([]);
  });
});

describe("input bounds", () => {
  beforeEach(owner);

  it.each([
    ["no name", { name: " " }],
    ["name over 80", { name: "x".repeat(81) }],
    ["0 credits", { credits: 0 }],
    ["501 credits", { credits: 501 }],
    ["negative price", { priceCents: -1 }],
    ["fractional price", { priceCents: 10.5 }],
    ["0 valid days", { validDays: 0 }],
    ["bad service id", { eligibleServiceIds: ["nope"] }],
  ])("savePackage refuses %s", async (_label, patch) => {
    const res = await savePackage({ ...validPack, ...patch });
    expect(res).toEqual({ success: false, error: messages.packages.errors.invalid });
    expect(h.writes).toEqual([]);
  });

  it("savePackage accepts the edges", async () => {
    h.queue.push([{ id: PACK }]);
    expect(await savePackage({ ...validPack, credits: 500, validDays: null })).toEqual({ success: true, id: PACK });
    expect(h.writes).toEqual(["insert"]);
  });

  it.each([
    ["0", 0],
    ["51", 51],
    ["-51", -51],
    ["a fraction", 1.5],
  ])("adjustCredits refuses a change of %s", async (_l, delta) => {
    const res = await adjustCredits({ clientPackageId: CP, delta, note: "why" });
    expect(res).toEqual({ success: false, error: messages.packages.errors.invalid });
    expect(h.appendCredit).not.toHaveBeenCalled();
  });

  it("adjustCredits needs a reason", async () => {
    expect(await adjustCredits({ clientPackageId: CP, delta: 2, note: "  " })).toMatchObject({ success: false });
    expect(await adjustCredits({ clientPackageId: CP, delta: 2, note: "x".repeat(201) })).toMatchObject({ success: false });
    expect(h.appendCredit).not.toHaveBeenCalled();
  });

  it("adjustCredits writes an adjust entry for -50 and 50", async () => {
    h.queue.push([{ clientId: CLIENT }], [{ clientId: CLIENT }]);
    h.appendCredit.mockResolvedValue({ id: "l", balanceAfter: 7 });
    expect(await adjustCredits({ clientPackageId: CP, delta: -50, note: "fix" })).toEqual({ success: true, balance: 7 });
    expect(await adjustCredits({ clientPackageId: CP, delta: 50, note: "fix" })).toMatchObject({ success: true });
    expect(h.appendCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ delta: -50, reason: "adjust", note: "fix", createdBy: "u1" }),
    );
  });

  it("adjustCredits below zero shows the insufficient sentence", async () => {
    h.queue.push([{ clientId: CLIENT }]);
    h.appendCredit.mockRejectedValue(new h.CreditError("x"));
    expect(await adjustCredits({ clientPackageId: CP, delta: -3, note: "oops" })).toEqual({
      success: false,
      error: messages.packages.insufficient,
    });
  });
});

describe("selling with a card", () => {
  beforeEach(() => {
    owner();
    h.getBookingSession.mockResolvedValue(CLIENT);
  });

  it("buyPackage without a signed-in client asks to sign in", async () => {
    h.getBookingSession.mockResolvedValue(null);
    expect(await buyPackage(PACK)).toEqual({ success: false, error: messages.packages.signInFirst });
  });

  it("buyPackage without a card on file returns needsCard and charges nothing", async () => {
    h.queue.push([packRow], [{ id: CLIENT, stripeCustomerId: null, stripePaymentMethodId: null }], []);
    expect(await buyPackage(PACK)).toEqual({ success: false, needsCard: true });
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("a declined card creates no package", async () => {
    h.queue.push([packRow], [cardClient], []);
    h.charge.mockResolvedValue({ stripePaymentIntentId: null, status: "failed", failureReason: "declined" });
    const res = await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "card_on_file" });
    expect(res).toEqual({ success: false, error: messages.packages.errors.cardFailed });
    expect(h.writes).toEqual([]);
    expect(h.appendCredit).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("charges with Connect params and an idempotency key, then saves pack, credit and charge", async () => {
    h.queue.push([packRow], [cardClient], [], [{ id: CP }]);
    h.connect.mockResolvedValue({ connectAccountId: "acct_1", platformFeeCents: 250 });
    h.charge.mockResolvedValue({ stripePaymentIntentId: "pi_1", status: "completed", failureReason: null });
    const res = await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "card_on_file" });
    expect(res).toEqual({ success: true, clientPackageId: CP });
    expect(h.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 50000,
        stripeCustomerId: "cus_1",
        connectAccountId: "acct_1",
        platformFeeCents: 250,
        idempotencyKey: expect.stringContaining(`pack-sale:acme:${CLIENT}:${PACK}`),
      }),
    );
    expect(h.appendCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ clientPackageId: CP, delta: 10, reason: "purchase", referenceId: "pi_1" }),
    );
    expect(h.writes).toEqual(["transaction", "tx.insert", "tx.insert"]);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("refunds the payment when the pack cannot be saved after a successful charge", async () => {
    h.queue.push([packRow], [cardClient], []);
    h.charge.mockResolvedValue({ stripePaymentIntentId: "pi_2", status: "completed", failureReason: null });
    h.failTransaction = true;
    const res = await buyPackage(PACK);
    expect(h.refund).toHaveBeenCalledWith({ payment_intent: "pi_2" });
    expect(res).toEqual({ success: false, error: messages.packages.errors.refunded });
  });

  it("refunds when the ledger insert fails inside the transaction", async () => {
    h.queue.push([packRow], [cardClient], [], [{ id: CP }]);
    h.charge.mockResolvedValue({ stripePaymentIntentId: "pi_3", status: "completed", failureReason: null });
    h.appendCredit.mockRejectedValue(new Error("ledger down"));
    const res = await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "card_on_file" });
    expect(h.refund).toHaveBeenCalledWith({ payment_intent: "pi_3" });
    expect(res).toMatchObject({ success: false, error: messages.packages.errors.refunded });
  });

  it("tells the customer to call when the refund also fails", async () => {
    h.queue.push([packRow], [cardClient], []);
    h.charge.mockResolvedValue({ stripePaymentIntentId: "pi_4", status: "completed", failureReason: null });
    h.failTransaction = true;
    h.refund.mockRejectedValue(new Error("stripe down"));
    const res = await buyPackage(PACK);
    expect(res).toMatchObject({ success: false });
    expect((res as { error: string }).error).toContain("contact the");
  });

  it("a cash sale never calls Stripe and has no refund to make", async () => {
    h.queue.push([packRow], [cardClient], [], [{ id: CP }]);
    expect(await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "cash" })).toEqual({
      success: true,
      clientPackageId: CP,
    });
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.appendCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ referenceId: `cash:${CP}` }),
    );
  });

  it("refuses the same pack for the same client twice within a minute", async () => {
    h.queue.push([packRow], [cardClient], [{ id: "recent" }]);
    const res = await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "card_on_file" });
    expect(res).toEqual({ success: false, error: messages.packages.errors.duplicate });
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("refuses a pack that is missing or not on sale", async () => {
    h.queue.push([], [cardClient]);
    expect(await sellPackageAdmin({ clientId: CLIENT, packageId: PACK, payment: "cash" })).toEqual({
      success: false,
      error: messages.packages.errors.notFound,
    });
  });
});
