// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";

const APPT = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => {
  class ModuleDisabledError extends Error {}
  class CreditError extends Error {}
  return {
    ModuleDisabledError,
    CreditError,
    requireRole: vi.fn(),
    assertModule: vi.fn(),
    hasModule: vi.fn(),
    takeTx: vi.fn(),
    applyTx: vi.fn(),
  };
});

vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return String(node);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: h.requireRole,
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
vi.mock("@/lib/credits/ledger", () => ({ CreditError: h.CreditError }));
vi.mock("@/lib/credits/appointment-credits", async (orig) => ({
  ...(await orig<typeof import("@/lib/credits/appointment-credits")>()),
  takeLateCancelCreditTx: h.takeTx,
  applyCreditAtCheckoutTx: h.applyTx,
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_s: string, fn: (db: unknown, t: unknown) => unknown) =>
    fn({ transaction: (cb: (tx: unknown) => unknown) => cb({}) }, {}),
}));

import { canTakeLateCancelCredit } from "@/lib/credits/appointment-credits";
import { applyCreditAtCheckout, takeLateCancelCredit } from "./credit-redemption";

beforeEach(() => {
  for (const f of [h.requireRole, h.assertModule, h.hasModule, h.takeTx, h.applyTx]) f.mockReset();
  h.requireRole.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "acme" });
});

describe("canTakeLateCancelCredit", () => {
  it("allows cancelled and no-show visits with no credit", () => {
    expect(canTakeLateCancelCredit({ status: "cancelled", creditEntryId: null })).toBe(true);
    expect(canTakeLateCancelCredit({ status: "no_show", creditEntryId: null })).toBe(true);
  });
  it("refuses a visit that already has a credit, or is still confirmed or completed", () => {
    expect(canTakeLateCancelCredit({ status: "cancelled", creditEntryId: "L1" })).toBe(false);
    expect(canTakeLateCancelCredit({ status: "confirmed", creditEntryId: null })).toBe(false);
    expect(canTakeLateCancelCredit({ status: "completed", creditEntryId: null })).toBe(false);
  });
});

describe("takeLateCancelCredit", () => {
  it("is for owners and admins only", async () => {
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(takeLateCancelCredit(APPT)).rejects.toThrow("NEXT_REDIRECT");
    expect(h.requireRole).toHaveBeenCalledWith("owner", "admin");
    expect(h.takeTx).not.toHaveBeenCalled();
  });

  it("refuses when the packages module is off", async () => {
    h.assertModule.mockRejectedValue(new h.ModuleDisabledError("Packs are not available here."));
    expect(await takeLateCancelCredit(APPT)).toEqual({ success: false, error: "Packs are not available here." });
    expect(h.takeTx).not.toHaveBeenCalled();
  });

  it("refuses a visit that is not eligible, and one with no pack that fits", async () => {
    h.takeTx.mockResolvedValueOnce({ ok: false, code: "NOT_ELIGIBLE" });
    expect(await takeLateCancelCredit(APPT)).toEqual({ success: false, error: messages.packages.errors.notEligible });
    h.takeTx.mockResolvedValueOnce({ ok: false, code: "NO_PACKAGE" });
    expect(await takeLateCancelCredit(APPT)).toEqual({ success: false, error: messages.packages.errors.noCredit });
  });

  it("takes the credit when everything fits", async () => {
    h.takeTx.mockResolvedValue({ ok: true, ledgerId: "L1" });
    expect(await takeLateCancelCredit(APPT)).toEqual({ success: true });
    expect(h.takeTx).toHaveBeenCalledWith({}, {}, { appointmentId: APPT, createdBy: "u1" });
  });

  it("rejects a malformed id before touching the database", async () => {
    await expect(takeLateCancelCredit("nope")).rejects.toThrow();
    expect(h.takeTx).not.toHaveBeenCalled();
  });
});

describe("applyCreditAtCheckout", () => {
  it("is for staff roles and needs the packages module", async () => {
    h.applyTx.mockResolvedValue({ ok: true, ledgerId: "L1" });
    expect(await applyCreditAtCheckout(APPT)).toEqual({ success: true });
    expect(h.requireRole).toHaveBeenCalledWith("owner", "admin", "provider");
    expect(h.assertModule).toHaveBeenCalledWith("acme", "packages");
  });

  it("reports a visit that cannot take a credit", async () => {
    h.applyTx.mockResolvedValue({ ok: false, code: "NOT_ELIGIBLE" });
    expect(await applyCreditAtCheckout(APPT)).toEqual({ success: false, error: messages.packages.errors.notEligible });
  });
});
