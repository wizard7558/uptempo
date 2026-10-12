// @vitest-environment node
import { describe, it, expect, afterAll, vi } from "vitest";
import type Stripe from "stripe";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const sent = vi.hoisted(() => [] as { to: string; react: unknown }[]);

vi.mock("@/lib/email/send", () => ({
  sendEmail: async (input: { to: string; react: unknown }) => {
    sent.push(input);
    return { success: true, id: "email-id" };
  },
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;
const tenants: ScratchTenant[] = [];

afterAll(async () => {
  for (const t of tenants) await t.drop();
});

function texts(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (typeof node === "object" && "props" in node) {
    return texts((node as { props?: { children?: unknown } }).props?.children);
  }
  return [];
}

describe("issueGiftCardFromSession", () => {
  itDb(
    "issues one card, emails the code, and ignores a replay",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { issueGiftCardFromSession } = await import("./purchase");
      const { findGiftCardByCode } = await import("./service");
      const { normalizeGiftCardCode } = await import("./code");
      const { withTenantDb } = await import("@/lib/db/tenant");

      const t = await scratchTenant("gcpurchase");
      tenants.push(t);
      sent.length = 0;

      const session = {
        id: "cs_test_1",
        payment_status: "paid",
        amount_total: 8000,
        payment_intent: "pi_1",
        customer_details: { email: "buyer@example.com" },
        metadata: {
          purpose: "gift_card_purchase",
          tenantSlug: t.slug,
          recipientEmail: "jo@example.com",
          recipientName: "Jo",
          purchaserName: "Sam",
          platformFeeCents: "0",
        },
      } as unknown as Stripe.Checkout.Session;

      const first = await issueGiftCardFromSession(session);
      expect(first).toEqual({ issued: true });

      const s = `"${t.schema}"`;
      const cards = await t.run(
        `select balance_cents::int as balance, delivered_at is not null as delivered, purchaser_email, recipient_email, stripe_payment_intent_id from ${s}.gift_cards`,
      );
      expect(cards).toEqual([
        {
          balance: 8000,
          delivered: true,
          purchaser_email: "buyer@example.com",
          recipient_email: "jo@example.com",
          stripe_payment_intent_id: "pi_1",
        },
      ]);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe("jo@example.com");
      const code = texts(sent[0].react).map((line) => normalizeGiftCardCode(line)).find(Boolean);
      expect(code).toBeTruthy();
      const found = await withTenantDb(t.slug, (db, tables) => findGiftCardByCode(db, tables, code!));
      expect(found).toMatchObject({ balanceCents: 8000, status: "active" });

      const alerts = await t.run(
        `select type, dedupe_key from ${s}.alerts where dedupe_key = 'gift_card_sold:cs_test_1'`,
      );
      expect(alerts).toEqual([{ type: "gift_card_sold", dedupe_key: "gift_card_sold:cs_test_1" }]);

      const second = await issueGiftCardFromSession(session);
      expect(second).toEqual({ issued: false });
      const after = await t.run(`select count(*)::int as n from ${s}.gift_cards`);
      expect(after[0].n).toBe(1);
      expect(sent).toHaveLength(1);
    },
    60_000,
  );
});
