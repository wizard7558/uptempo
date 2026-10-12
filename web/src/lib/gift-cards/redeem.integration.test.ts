// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const tenant = vi.hoisted(() => ({ slug: "" }));
const charge = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: tenant.slug }),
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: tenant.slug }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/terms/server", async () => {
  const { createTermsT } = await import("@/lib/terms/translator");
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getT: async (namespace?: string) => createTermsT(VERTICALS.hair_salon.terms, namespace ?? ""),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/services/charge-processing", () => ({
  processOffSessionCharge: (...args: unknown[]) => charge(...args),
  calculatePlatformFee: () => 0,
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;

let t: ScratchTenant;
const ids = {} as Record<string, string>;
let slot = 0;

afterAll(async () => {
  if (t) await t.drop();
});

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
  t = await scratchTenant("gcredeem");
  tenant.slug = t.slug;
  const s = `"${t.schema}"`;
  const one = async (q: string) => String((await t.run(q))[0].id);
  ids.location = await one(`select id from ${s}.locations order by created_at limit 1`);
  ids.staff = await one(`insert into ${s}.staff (display_name) values ('Alex') returning id`);
  ids.service = await one(
    `insert into ${s}.services (name, default_duration_minutes, price_cents) values ('Haircut', 60, 10000) returning id`,
  );
}, 120_000);

function during() {
  const start = new Date(Date.UTC(2026, 5, 17, 13 + slot, 0, 0));
  slot += 2;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return `tstzrange('${start.toISOString()}','${end.toISOString()}','[)')`;
}

async function seedVisit(opts: {
  priceCents: number;
  prepaidCents?: number;
  depositCents?: number;
  cardOnFile?: boolean;
}) {
  const s = `"${t.schema}"`;
  const one = async (q: string) => String((await t.run(q))[0].id);
  const email = `c${slot}@example.com`;
  const stripe = opts.cardOnFile
    ? ", stripe_customer_id, stripe_payment_method_id) values ('C', '" +
      email +
      "', 'cus_test', 'pm_test') returning id"
    : ") values ('C', '" + email + "') returning id";
  const clientId = await one(`insert into ${s}.clients (name, email${stripe}`);
  const appointmentId = await one(
    `insert into ${s}.appointments (staff_id, client_id, location_id, during) values ('${ids.staff}','${clientId}','${ids.location}', ${during()}) returning id`,
  );
  await t.run(
    `insert into ${s}.appointment_services (appointment_id, service_id, duration_minutes, price_charged_cents) values ('${appointmentId}','${ids.service}', 60, ${opts.priceCents})`,
  );
  if (opts.prepaidCents) {
    await t.run(
      `insert into ${s}.stored_value_balances (client_id, balance_cents) values ('${clientId}', ${opts.prepaidCents})`,
    );
    await t.run(
      `insert into ${s}.stored_value_transactions (client_id, type, amount_cents, running_balance_cents) values ('${clientId}', 'admin_credit', ${opts.prepaidCents}, ${opts.prepaidCents})`,
    );
  }
  if (opts.depositCents) {
    await t.run(
      `insert into ${s}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${appointmentId}','${clientId}', ${opts.depositCents}, 'deposit', 'completed')`,
    );
  }
  return { clientId, appointmentId };
}

async function issue(amountCents: number) {
  const { withTenantDb } = await import("@/lib/db/tenant");
  const { issueGiftCard } = await import("./service");
  return withTenantDb(t.slug, (db, tables) =>
    db.transaction((tx) =>
      issueGiftCard(tx, tables, { amountCents, source: "in_person", purchaserName: "Sam" }),
    ),
  );
}

describe("gift card redemption at checkout", () => {
  itDb(
    "applies the card after the deposit and the prepaid balance",
    async () => {
      const { completeAppointment } = await import("@/actions/checkout");
      const visit = await seedVisit({ priceCents: 10000, prepaidCents: 3000, depositCents: 1500 });
      const card = await issue(5000);
      const result = await completeAppointment({
        appointmentId: visit.appointmentId,
        paymentMethod: "cash",
        tipCents: 2000,
        giftCard: { code: card.code, amountCents: 5000 },
      });
      expect(result).toEqual({ success: true, chargeId: expect.any(String), totalCents: 12000 });

      const s = `"${t.schema}"`;
      const [chargeRow] = await t.run(
        `select id, amount_cents::int as amount, tip_cents::int as tip, stored_value_cents::int as prepaid, gift_card_cents::int as gift, gift_card_id from ${s}.charges where reason = 'service_payment' and appointment_id = '${visit.appointmentId}'`,
      );
      expect(chargeRow).toMatchObject({
        amount: 12000,
        tip: 2000,
        prepaid: 3000,
        gift: 5000,
        gift_card_id: card.id,
      });
      const [redeem] = await t.run(
        `select charge_id, delta_cents::int as delta, reason from ${s}.gift_card_transactions where gift_card_id = '${card.id}' and reason = 'redeem'`,
      );
      expect(redeem).toMatchObject({ charge_id: chargeRow.id, delta: -5000, reason: "redeem" });
      const [balance] = await t.run(
        `select balance_cents::int as balance from ${s}.gift_cards where id = '${card.id}'`,
      );
      expect(balance.balance).toBe(0);
      const [appt] = await t.run(
        `select status from ${s}.appointments where id = '${visit.appointmentId}'`,
      );
      expect(appt.status).toBe("completed");
    },
    60_000,
  );

  itDb(
    "pays a visit from the card and keeps the unused balance",
    async () => {
      const { completeAppointment } = await import("@/actions/checkout");
      const visit = await seedVisit({ priceCents: 5000 });
      const card = await issue(8000);
      const result = await completeAppointment({
        appointmentId: visit.appointmentId,
        paymentMethod: "gift_card",
        giftCard: { code: card.code, amountCents: 8000 },
      });
      expect(result.success).toBe(true);
      const [balance] = await t.run(
        `select balance_cents::int as balance from "${t.schema}".gift_cards where id = '${card.id}'`,
      );
      expect(balance.balance).toBe(3000);
    },
    60_000,
  );

  itDb(
    "puts the gift card balance back when the card charge fails",
    async () => {
      const { completeAppointment } = await import("@/actions/checkout");
      charge.mockResolvedValue({
        status: "failed",
        failureReason: "Card declined",
        stripePaymentIntentId: null,
      });
      const visit = await seedVisit({ priceCents: 10000, cardOnFile: true });
      const card = await issue(4000);
      const result = await completeAppointment({
        appointmentId: visit.appointmentId,
        paymentMethod: "card_on_file",
        giftCard: { code: card.code, amountCents: 4000 },
      });
      expect(result).toEqual({ success: false, error: "Card declined" });
      const s = `"${t.schema}"`;
      const [balance] = await t.run(
        `select balance_cents::int as balance, status from ${s}.gift_cards where id = '${card.id}'`,
      );
      expect(balance).toMatchObject({ balance: 4000, status: "active" });
      const payments = await t.run(
        `select id from ${s}.charges where reason = 'service_payment' and appointment_id = '${visit.appointmentId}'`,
      );
      expect(payments).toEqual([]);
      const [appt] = await t.run(`select status from ${s}.appointments where id = '${visit.appointmentId}'`);
      expect(appt.status).toBe("confirmed");
      const reasons = await t.run(
        `select reason, delta_cents::int as delta from ${s}.gift_card_transactions where gift_card_id = '${card.id}' order by created_at`,
      );
      expect(reasons.map((r) => r.reason)).toEqual(["issue", "redeem", "reversal"]);
    },
    60_000,
  );
});
