// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertModule: vi.fn(),
  consumeRateLimit: vi.fn(),
  findGiftCardByCode: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: (...args: unknown[]) => h.requireRole(...args),
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
vi.mock("@/lib/tenant/modules", () => ({ assertModule: (...args: unknown[]) => h.assertModule(...args) }));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => h.consumeRateLimit(...args),
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, cb: (db: unknown, tables: unknown) => unknown) => cb({}, {}),
}));
vi.mock("@/lib/gift-cards/service", () => ({
  findGiftCardByCode: (...args: unknown[]) => h.findGiftCardByCode(...args),
  issueGiftCard: vi.fn(),
  adjustGiftCard: vi.fn(),
  voidGiftCard: vi.fn(),
  replaceGiftCard: vi.fn(),
  formatIssuedCode: (code: string) => code,
  GiftCardRangeError: class GiftCardRangeError extends Error {},
  GiftCardInactiveError: class GiftCardInactiveError extends Error {},
}));
vi.mock("@/lib/gift-cards/email", () => ({ sendGiftCardEmail: vi.fn() }));

import {
  adjustGiftCardBalance,
  cancelGiftCard,
  listGiftCards,
  lookupGiftCardForCheckout,
  sellGiftCardInPerson,
  sendNewGiftCardCode,
} from "./gift-cards";

const ADMIN = ["owner", "admin"];
const STAFF = ["owner", "admin", "provider", "assistant"];

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "acme" });
  h.assertModule.mockResolvedValue(undefined);
  h.consumeRateLimit.mockResolvedValue({ allowed: true });
  h.findGiftCardByCode.mockResolvedValue(null);
});

describe("gift card action roles", () => {
  const adminActions: [string, () => Promise<unknown>][] = [
    ["listGiftCards", () => listGiftCards({}).catch(() => undefined)],
    ["sellGiftCardInPerson", () => sellGiftCardInPerson({ amountCents: 1, paid: "in_person" })],
    ["adjustGiftCardBalance", () => adjustGiftCardBalance({ id: "not-a-uuid", deltaCents: -100, note: "Test" })],
    ["cancelGiftCard", () => cancelGiftCard({ id: "not-a-uuid", note: "Test" })],
    ["sendNewGiftCardCode", () => sendNewGiftCardCode({ id: "not-a-uuid" })],
  ];

  it.each(adminActions)("%s is for owners and admins and checks the module", async (_name, run) => {
    await run();
    expect(h.requireRole).toHaveBeenCalledWith(...ADMIN);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "gift_cards");
  });

  it("lookupGiftCardForCheckout is for the whole team and is rate limited", async () => {
    const result = await lookupGiftCardForCheckout("ABCDEFGHJKMNPQRS");
    expect(h.requireRole).toHaveBeenCalledWith(...STAFF);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "gift_cards");
    expect(h.consumeRateLimit).toHaveBeenCalledWith({
      tenantSlug: "acme",
      scope: "identifier",
      key: "gc_lookup:u1",
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });
    expect(result).toEqual({ success: false, error: "giftCards.notFound" });
  });
});
