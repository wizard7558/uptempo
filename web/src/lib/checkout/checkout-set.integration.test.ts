// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;

let t: ScratchTenant;
const ids = {} as Record<string, string>;
const s = () => `"${t.schema}"`;
const one = async (q: string) => String((await t.run(q))[0].id);
const range = (a: string, b: string) => `tstzrange('${a}','${b}','[)')`;

afterAll(async () => {
  if (t) await t.drop();
});

describe("group checkout against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("grpco");
    ids.l1 = await one(`select id from ${s()}.locations order by created_at limit 1`);
    ids.payer = await one(`insert into ${s()}.clients (name) values ('Payer') returning id`);
    ids.friend = await one(`insert into ${s()}.clients (name) values ('Friend') returning id`);
    ids.s1 = await one(`insert into ${s()}.staff (display_name) values ('Ann') returning id`);
    ids.s2 = await one(`insert into ${s()}.staff (display_name) values ('Bo') returning id`);
    ids.mani = await one(`insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Mani', 60, 4000) returning id`);
    ids.pedi = await one(`insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Pedi', 60, 5000) returning id`);
    ids.group = await one(`insert into ${s()}.booking_groups (client_id, kind) values ('${ids.payer}', 'couples') returning id`);
  }, 120_000);

  const appt = async (staff: string, client: string, service: string, hour: string, group: string | null, status = "confirmed") => {
    const id = await one(
      `insert into ${s()}.appointments (staff_id, client_id, location_id, status, booking_group_id, during) values ('${staff}','${client}','${ids.l1}','${status}', ${group ? `'${group}'` : "null"}, ${range(`2026-06-17T${hour}:00:00Z`, `2026-06-17T${String(Number(hour) + 1).padStart(2, "0")}:00:00Z`)}) returning id`,
    );
    const price = service === ids.mani ? 4000 : 5000;
    await t.run(
      `insert into ${s()}.appointment_services (appointment_id, service_id, duration_minutes, price_charged_cents) values ('${id}','${service}',60,${price})`,
    );
    return id;
  };

  const withDb = async <T,>(fn: (db: import("@/lib/db/tenant").TenantDb, tables: import("@/lib/db/tenant-schema").TenantTables) => Promise<T>) => {
    const { withTenantDb } = await import("@/lib/db/tenant");
    return withTenantDb(t.slug, fn);
  };

  itDb(
    "loadCheckoutSet sums both members, credits deposits and prefixes names; recordServicePayment writes one charge and refuses a repeat",
    async () => {
      const { loadCheckoutSet } = await import("./checkout-set");
      const { recordServicePayment } = await import("./record-payment");
      const { calculateAppointmentPrice } = await import("@/lib/services/policy-engine");

      const a = await appt(ids.s1, ids.payer, ids.mani, "14", ids.group);
      const b = await appt(ids.s2, ids.friend, ids.pedi, "14", ids.group);
      const cancelled = await appt(ids.s2, ids.friend, ids.pedi, "16", ids.group, "cancelled");
      await t.run(
        `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${b}','${ids.payer}',1000,'deposit','completed')`,
      );

      // Opening checkout from either member gives the same set.
      for (const from of [a, b]) {
        const loaded = await withDb((db, tables) => loadCheckoutSet(db, tables, from));
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const { set } = loaded;
        expect(set.anchorId).toBe(a);
        expect(set.appointmentIds).toEqual([a, b]);
        expect(set.appointmentIds).not.toContain(cancelled);
        expect(set.groupId).toBe(ids.group);
        expect(set.payerClientId).toBe(ids.payer);
        expect(calculateAppointmentPrice(set.services)).toBe(9000);
        expect(set.depositPaidCents).toBe(1000);
        expect(set.services.map((x) => x.serviceName)).toEqual(["Payer · Mani", "Friend · Pedi"]);
      }

      const loaded = await withDb((db, tables) => loadCheckoutSet(db, tables, b));
      if (!loaded.ok) throw new Error("expected a set");
      const pay = {
        set: loaded.set,
        amountCents: 9000,
        tipCents: 0,
        status: "completed" as const,
        stripePaymentIntentId: null,
        failureReason: null,
        platformFeeCents: null,
        connectAccountId: null,
        storedValueCents: 0,
        ledgerNote: "Service checkout",
      };
      const first = await withDb((db, tables) => recordServicePayment(db, tables, pay));
      expect(first.ok).toBe(true);

      const charges = await t.run(
        `select appointment_id, client_id, booking_group_id, amount_cents from ${s()}.charges where reason = 'service_payment'`,
      );
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({
        appointment_id: a,
        client_id: ids.payer,
        booking_group_id: ids.group,
        amount_cents: 9000,
      });
      const statuses = await t.run(`select id, status from ${s()}.appointments where id in ('${a}','${b}')`);
      expect(statuses.map((x) => x.status)).toEqual(["completed", "completed"]);

      const second = await withDb((db, tables) => recordServicePayment(db, tables, pay));
      expect(second).toEqual({ ok: false, error: "Already checked out" });
      expect(await t.run(`select id from ${s()}.charges where reason = 'service_payment'`)).toHaveLength(1);

      // Both members are completed now, so a checkout cannot be opened again.
      const reopened = await withDb((db, tables) => loadCheckoutSet(db, tables, a));
      expect(reopened).toEqual({ ok: false, error: "Appointment is already completed" });
    },
    120_000,
  );

  itDb(
    "a single appointment is its own set with no group",
    async () => {
      const { loadCheckoutSet } = await import("./checkout-set");
      const solo = await appt(ids.s1, ids.friend, ids.mani, "18", null);
      const loaded = await withDb((db, tables) => loadCheckoutSet(db, tables, solo));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.set).toMatchObject({
        anchorId: solo,
        appointmentIds: [solo],
        groupId: null,
        payerClientId: ids.friend,
        depositPaidCents: 0,
      });
      expect(loaded.set.services.map((x) => x.serviceName)).toEqual(["Mani"]);
    },
    60_000,
  );
});
