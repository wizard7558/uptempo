// @vitest-environment node
import { describe, it, expect, afterAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

vi.mock("@/lib/email/send", () => ({
  sendEmail: async () => ({ success: true, id: "email-id" }),
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;
const tenants: ScratchTenant[] = [];

afterAll(async () => {
  for (const t of tenants) await t.drop();
});

describe("gift card ledger", () => {
  itDb(
    "issues a hashed code, debits, reverses, adjusts, voids, and replaces",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { withTenantDb } = await import("@/lib/db/tenant");
      const { hashGiftCardCode } = await import("./code");
      const {
        issueGiftCard,
        findGiftCardByCode,
        debitGiftCard,
        reverseGiftCardDebit,
        adjustGiftCard,
        voidGiftCard,
        replaceGiftCard,
        GiftCardBalanceError,
        GiftCardRangeError,
      } = await import("./service");

      const t = await scratchTenant("gcsvc");
      tenants.push(t);
      const s = `"${t.schema}"`;

      const issued = await withTenantDb(t.slug, (db, tables) =>
        db.transaction((tx) =>
          issueGiftCard(tx, tables, {
            amountCents: 5000,
            source: "in_person",
            recipientEmail: "jo@example.com",
            recipientName: "Jo",
            purchaserName: "Sam",
          }),
        ),
      );

      const [row] = await t.run(
        `select code_hash, last4, balance_cents::int as balance, status from ${s}.gift_cards where id = '${issued.id}'`,
      );
      expect(row.code_hash).toBe(hashGiftCardCode(issued.code));
      expect(row.last4).toBe(issued.last4);
      expect(String(row.code_hash)).not.toContain(issued.code);
      expect(row.balance).toBe(5000);
      expect(row.status).toBe("active");

      const formatted = `${issued.code.slice(0, 4)}-${issued.code.slice(4, 8)}-${issued.code.slice(8, 12)}-${issued.code.slice(12)}`;
      const found = await withTenantDb(t.slug, (db, tables) =>
        findGiftCardByCode(db, tables, formatted.toLowerCase()),
      );
      expect(found).toMatchObject({ id: issued.id, balanceCents: 5000, status: "active" });

      const debit = await withTenantDb(t.slug, (db, tables) =>
        db.transaction((tx) =>
          debitGiftCard(tx, tables, {
            giftCardId: issued.id,
            cents: 2000,
            appointmentId: null,
            createdBy: null,
          }),
        ),
      );
      expect(debit.balanceAfter).toBe(3000);

      await expect(
        withTenantDb(t.slug, (db, tables) =>
          db.transaction((tx) =>
            debitGiftCard(tx, tables, {
              giftCardId: issued.id,
              cents: 4000,
              appointmentId: null,
              createdBy: null,
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(GiftCardBalanceError);
      const [held] = await t.run(
        `select balance_cents::int as balance from ${s}.gift_cards where id = '${issued.id}'`,
      );
      expect(held.balance).toBe(3000);

      const reversed = await withTenantDb(t.slug, (db, tables) =>
        db.transaction((tx) =>
          reverseGiftCardDebit(tx, tables, { txId: debit.txId, note: "Checkout did not finish" }),
        ),
      );
      expect(reversed.balanceAfter).toBe(5000);

      await expect(
        withTenantDb(t.slug, (db, tables) =>
          db.transaction((tx) =>
            adjustGiftCard(tx, tables, {
              id: issued.id,
              deltaCents: -6000,
              note: "Too much",
              createdBy: "u1",
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(GiftCardRangeError);

      const replaced = await replaceGiftCard(t.slug, { id: issued.id, createdBy: "u1" });
      expect(replaced.emailed).toBe(true);
      expect(replaced.id).not.toBe(issued.id);
      const [oldCard] = await t.run(
        `select status, balance_cents::int as balance, replaced_by_id from ${s}.gift_cards where id = '${issued.id}'`,
      );
      expect(oldCard).toMatchObject({ status: "void", balance: 0, replaced_by_id: replaced.id });
      const oldLookup = await withTenantDb(t.slug, (db, tables) =>
        findGiftCardByCode(db, tables, issued.code),
      );
      expect(oldLookup?.status).toBe("void");
      const nextLookup = await withTenantDb(t.slug, (db, tables) =>
        findGiftCardByCode(db, tables, replaced.code),
      );
      expect(nextLookup).toMatchObject({ id: replaced.id, balanceCents: 5000, status: "active" });

      await withTenantDb(t.slug, (db, tables) =>
        db.transaction((tx) =>
          adjustGiftCard(tx, tables, {
            id: replaced.id,
            deltaCents: -4950,
            note: "Leave fifty cents",
            createdBy: "u1",
          }),
        ),
      );
      const small = await replaceGiftCard(t.slug, { id: replaced.id, createdBy: "u1" });
      const smallLookup = await withTenantDb(t.slug, (db, tables) =>
        findGiftCardByCode(db, tables, small.code),
      );
      expect(smallLookup).toMatchObject({ id: small.id, balanceCents: 50, status: "active" });

      await withTenantDb(t.slug, (db, tables) =>
        db.transaction((tx) =>
          voidGiftCard(tx, tables, { id: small.id, note: "Test", createdBy: "u1" }),
        ),
      );
      const [voided] = await t.run(
        `select status, balance_cents::int as balance from ${s}.gift_cards where id = '${small.id}'`,
      );
      expect(voided).toMatchObject({ status: "void", balance: 0 });
    },
    60_000,
  );
});
