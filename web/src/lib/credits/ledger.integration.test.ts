// @vitest-environment node
import { describe, it, expect, afterAll, vi } from "vitest";
import { pgErrorInfo } from "@/lib/db/pg-error";
import type { TenantDb, TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";

vi.setConfig({ testTimeout: 300_000 });

const mockState = vi.hoisted(() => ({ slug: "", clientId: "", tenants: [] as Array<{ slug: string; schemaVersion: number }> }));

// The scratch tenant is not in the public registry, so the cron is pointed at it directly.
vi.mock("@/lib/tenant/registry", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/registry")>()),
  listActiveTenants: async () => mockState.tenants,
}));
// Stripe: the webhook test feeds a fixed invoice.paid event and subscription.
vi.mock("@/lib/stripe/webhook", () => ({
  verifyWebhookSignature: () => ({
    id: "evt_credits",
    type: "invoice.paid",
    data: {
      object: { id: "in_wh1", amount_paid: 5000, subscription: "sub_credits" },
    },
  }),
}));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: async () => ({
        metadata: {
          purpose: "beauty_bank_membership",
          tenantSlug: mockState.slug,
          clientId: mockState.clientId,
        },
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_600_000,
      }),
    },
  }),
}));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));

const itDb = process.env.DATABASE_URL ? it : it.skip;

type Scratch = Awaited<ReturnType<typeof import("@/lib/scheduling/db-fixtures").scratchTenant>>;
const tenants: Scratch[] = [];

afterAll(async () => {
  for (const t of tenants) await t.drop();
});

async function setup(tag: string) {
  const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
  const t = await scratchTenant(tag);
  tenants.push(t);
  const S = t.schema;
  const [client] = await t.run(
    `INSERT INTO "${S}".clients (name, email) VALUES ('Pat', 'pat-${Date.now()}@example.com') RETURNING id`,
  );
  const pack = async (initialRemaining = 0) => {
    const [p] = await t.run(
      `INSERT INTO "${S}".client_packages (client_id, name, credits_remaining)
       VALUES ('${client.id}', '10 pack', ${initialRemaining}) RETURNING id, credits_remaining`,
    );
    return p as { id: string; credits_remaining: number };
  };
  const ledger = (pkg: string, reason: string, delta: number, ref?: string) =>
    t.run(
      `INSERT INTO "${S}".credit_ledger (client_package_id, reason, delta, reference_id)
       VALUES ('${pkg}', '${reason}', ${delta}, ${ref ? `'${ref}'` : "NULL"}) RETURNING id, balance_after`,
    );
  const state = async (pkg: string) => {
    const [r] = await t.run(
      `SELECT credits_remaining, credits_total FROM "${S}".client_packages WHERE id = '${pkg}'`,
    );
    return r as { credits_remaining: number; credits_total: number };
  };
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return pgErrorInfo(e);
    }
    throw new Error("Expected the statement to fail");
  };
  return { t, S, client: client.id as string, pack, ledger, state, fails };
}

describe("credit ledger (integration)", () => {
  itDb("zeroes credits_remaining on client_packages insert", async () => {
    const x = await setup("cl1");
    const p = await x.pack(5);
    expect(p.credits_remaining).toBe(0);
  }, 120_000);

  itDb("purchase, redeem and refund keep the cached balance in step", async () => {
    const x = await setup("cl2");
    const p = await x.pack();
    const [buy] = await x.ledger(p.id, "purchase", 10);
    expect(buy.balance_after).toBe(10);
    expect(await x.state(p.id)).toEqual({ credits_remaining: 10, credits_total: 10 });

    const [redeem] = await x.ledger(p.id, "redeem", -1);
    expect(redeem.balance_after).toBe(9);
    expect(await x.state(p.id)).toEqual({ credits_remaining: 9, credits_total: 10 });

    const [refund] = await x.ledger(p.id, "refund", 1);
    expect(refund.balance_after).toBe(10);
    expect(await x.state(p.id)).toEqual({ credits_remaining: 10, credits_total: 10 });
  }, 120_000);

  itDb("rejects a redeem that would go below zero", async () => {
    const x = await setup("cl3");
    const p = await x.pack();
    await x.ledger(p.id, "purchase", 1);
    const err = await x.fails(x.ledger(p.id, "redeem", -2));
    expect(err).toMatchObject({ code: "23514", constraint: "credit_ledger_insufficient" });
    expect((await x.state(p.id)).credits_remaining).toBe(1);
  }, 120_000);

  itDb("rejects a delta whose sign does not match the reason", async () => {
    const x = await setup("cl4");
    const p = await x.pack();
    // Seed a balance so the balance trigger (which runs before CHECKs) lets the row through.
    await x.ledger(p.id, "grant", 5);
    const err = await x.fails(x.ledger(p.id, "purchase", -3));
    expect(err).toMatchObject({ code: "23514", constraint: "credit_ledger_sign_check" });
  }, 120_000);

  itDb("ledger rows are append-only", async () => {
    const x = await setup("cl5");
    const p = await x.pack();
    const [row] = await x.ledger(p.id, "purchase", 4);
    const err = await x.fails(
      x.t.run(`UPDATE "${x.S}".credit_ledger SET delta = 40 WHERE id = '${row.id}'`),
    );
    expect(err.code).toBe("42501");
  }, 120_000);

  itDb("rejects a duplicate (package, reason, reference)", async () => {
    const x = await setup("cl6");
    const p = await x.pack();
    await x.ledger(p.id, "grant", 2, "inv_1");
    const err = await x.fails(x.ledger(p.id, "grant", 2, "inv_1"));
    expect(err).toMatchObject({ code: "23505", constraint: "credit_ledger_reference_unique" });
    expect((await x.state(p.id)).credits_remaining).toBe(2);
  }, 120_000);

  itDb("two concurrent redeems of the last credit: exactly one wins", async () => {
    const x = await setup("cl7");
    const p = await x.pack();
    await x.ledger(p.id, "purchase", 1);
    const { publicDb } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const attempt = () =>
      publicDb.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `INSERT INTO "${x.S}".credit_ledger (client_package_id, reason, delta) VALUES ('${p.id}', 'redeem', -1)`,
          ),
        );
        // Hold the transaction open so the other insert has to wait on the row lock.
        await tx.execute(sql.raw(`SELECT pg_sleep(0.3)`));
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(pgErrorInfo(bad[0].reason)).toMatchObject({
      code: "23514",
      constraint: "credit_ledger_insufficient",
    });
    expect((await x.state(p.id)).credits_remaining).toBe(0);
  }, 120_000);

  itDb("a credits membership plan needs credits_per_period", async () => {
    const x = await setup("cl8");
    const err = await x.fails(
      x.t.run(
        `INSERT INTO "${x.S}".membership_plans (name, monthly_amount_cents, kind) VALUES ('Credits', 5000, 'credits')`,
      ),
    );
    expect(err).toMatchObject({ code: "23514", constraint: "membership_plans_credits_kind_check" });
    const ok = await x.t.run(
      `INSERT INTO "${x.S}".membership_plans (name, monthly_amount_cents, kind, credits_per_period)
       VALUES ('Credits', 5000, 'credits', 4) RETURNING kind, rollover_max`,
    );
    expect(ok[0]).toMatchObject({ kind: "credits", rollover_max: 0 });
  }, 120_000);

  // ---- Library tests: every credit change goes through src/lib/credits ---- //

  async function lib(tag: string) {
    const x = await setup(tag);
    const ledgerLib = await import("./ledger");
    const membershipLib = await import("./membership");
    const { withTenantDb } = await import("@/lib/db/tenant");
    /** Runs one operation in its own transaction. */
    const tx = <T,>(fn: (tx: TenantTransaction, tables: TenantTables) => Promise<T>): Promise<T> =>
      withTenantDb(x.t.slug, (db: TenantDb, tables) => db.transaction((t) => fn(t, tables)));
    const newPack = async (opts: {
      name?: string;
      credits?: number;
      eligible?: string[];
      expiresAt?: string | null;
      status?: string;
    }) => {
      const [p] = await x.t.run(
        `INSERT INTO "${x.S}".client_packages (client_id, name, eligible_service_ids, expires_at, status)
         VALUES ('${x.client}', '${opts.name ?? "Pack"}', '${JSON.stringify(opts.eligible ?? [])}'::jsonb,
                 ${opts.expiresAt ? `'${opts.expiresAt}'` : "NULL"}, '${opts.status ?? "active"}') RETURNING id`,
      );
      const id = p.id as string;
      if (opts.credits) {
        await tx((t, tb) =>
          ledgerLib.appendCredit(t, tb, {
            clientPackageId: id,
            delta: opts.credits!,
            reason: "purchase",
            referenceId: `buy:${id}`,
          }),
        );
      }
      return id;
    };
    const rowCount = async (pkg: string) =>
      Number((await x.t.run(`SELECT count(*)::int AS n FROM "${x.S}".credit_ledger WHERE client_package_id = '${pkg}'`))[0].n);
    const appointment = async () => {
      const [a] = await x.t.run(
        `INSERT INTO "${x.S}".appointments (staff_id, client_id, during)
         VALUES (gen_random_uuid(), '${x.client}', tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour')) RETURNING id`,
      );
      return a.id as string;
    };
    return { ...x, ...ledgerLib, ...membershipLib, tx, newPack, rowCount, appointment };
  }

  itDb("a pack of 10: 10 redeems leave 0 and the 11th is refused with INSUFFICIENT", async () => {
    const x = await lib("cl10");
    const pkg = await x.newPack({ credits: 10 });
    expect(await x.state(pkg)).toEqual({ credits_remaining: 10, credits_total: 10 });
    for (let i = 0; i < 10; i++) {
      await x.tx((t, tb) =>
        x.appendCredit(t, tb, { clientPackageId: pkg, delta: -1, reason: "redeem", referenceId: `r${i}` }),
      );
    }
    expect((await x.state(pkg)).credits_remaining).toBe(0);
    const before = await x.rowCount(pkg);
    const err = await x
      .tx((t, tb) => x.appendCredit(t, tb, { clientPackageId: pkg, delta: -1, reason: "redeem", referenceId: "r10" }))
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(x.CreditError);
    expect((err as InstanceType<typeof x.CreditError>).code).toBe("INSUFFICIENT");
    expect(await x.rowCount(pkg)).toBe(before);
    expect((await x.state(pkg)).credits_remaining).toBe(0);
  });

  itDb("redeemForAppointment links the ledger row to the appointment; refundEntry twice gives exactly one refund", async () => {
    const x = await lib("cl11");
    const pkg = await x.newPack({ credits: 3 });
    const appt = await x.appointment();
    const entryId = await x.tx((t, tb) =>
      x.redeemForAppointment(t, tb, { clientId: x.client, serviceIds: [], appointmentId: appt, at: new Date() }),
    );
    expect(entryId).toBeTruthy();
    const [a] = await x.t.run(`SELECT credit_entry_id FROM "${x.S}".appointments WHERE id = '${appt}'`);
    expect(a.credit_entry_id).toBe(entryId);
    expect((await x.state(pkg)).credits_remaining).toBe(2);

    await x.tx((t, tb) => x.refundEntry(t, tb, entryId!, "refund", "cancelled in time"));
    await x.tx((t, tb) => x.refundEntry(t, tb, entryId!, "refund"));
    const refunds = await x.t.run(
      `SELECT delta, reference_id, appointment_id FROM "${x.S}".credit_ledger WHERE client_package_id = '${pkg}' AND reason = 'refund'`,
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ delta: 1, reference_id: `refund:${entryId}`, appointment_id: appt });
    expect((await x.state(pkg)).credits_remaining).toBe(3);
  });

  itDb("redeemForEnrollment links the ledger row to the class seat", async () => {
    const x = await lib("cl12");
    const pkg = await x.newPack({ credits: 2 });
    const [svc] = await x.t.run(
      `INSERT INTO "${x.S}".services (name, default_duration_minutes, price_cents) VALUES ('Class', 60, 2000) RETURNING id`,
    );
    const [stf] = await x.t.run(`INSERT INTO "${x.S}".staff (display_name) VALUES ('Coach') RETURNING id`);
    const [sess] = await x.t.run(
      `INSERT INTO "${x.S}".class_sessions (service_id, staff_id, during, capacity)
       VALUES ('${svc.id}', '${stf.id}', tstzrange(now() + interval '2 day', now() + interval '2 day 1 hour'), 5) RETURNING id`,
    );
    const [enr] = await x.t.run(
      `INSERT INTO "${x.S}".class_enrollments (session_id, client_id, status)
       VALUES ('${sess.id}', '${x.client}', 'booked') RETURNING id`,
    );
    const entryId = await x.tx((t, tb) =>
      x.redeemForEnrollment(t, tb, {
        clientId: x.client,
        serviceIds: [svc.id as string],
        enrollmentId: enr.id as string,
        at: new Date(),
      }),
    );
    expect(entryId).toBeTruthy();
    const [e] = await x.t.run(`SELECT credit_entry_id FROM "${x.S}".class_enrollments WHERE id = '${enr.id}'`);
    expect(e.credit_entry_id).toBe(entryId);
    const [l] = await x.t.run(`SELECT enrollment_id, delta FROM "${x.S}".credit_ledger WHERE id = '${entryId}'`);
    expect(l).toMatchObject({ enrollment_id: enr.id, delta: -1 });
    expect((await x.state(pkg)).credits_remaining).toBe(1);
  });

  itDb("findRedeemablePackage: eligibility, expiry, order and the empty answer", async () => {
    const x = await lib("cl13");
    const [s1, s2, s3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
    const all = await x.newPack({ name: "All", credits: 3, eligible: [], expiresAt: day(30) });
    const only1 = await x.newPack({ name: "Only1", credits: 2, eligible: [s1], expiresAt: day(10) });
    const only2 = await x.newPack({ name: "Only2", credits: 2, eligible: [s2], expiresAt: null });
    await x.newPack({ name: "Past", credits: 5, eligible: [], expiresAt: day(-1) });
    await x.newPack({ name: "Done", credits: 5, eligible: [], status: "expired" });
    await x.newPack({ name: "Empty", credits: 0, eligible: [], expiresAt: day(1) });

    const find = (serviceIds: string[]) =>
      x.tx((t, tb) => x.findRedeemablePackage(t, tb, { clientId: x.client, serviceIds, at: new Date() }));

    // Soonest expiry among the packs that cover the service.
    expect(await find([s1])).toMatchObject({ id: only1, name: "Only1", creditsRemaining: 2 });
    // A restricted pack must cover every service; only the open pack does here.
    expect(await find([s1, s2])).toMatchObject({ id: all });
    expect(await find([s3])).toMatchObject({ id: all });
    // With no services to cover, every pack qualifies, so the soonest expiry wins.
    expect(await find([])).toMatchObject({ id: only1 });

    // Drain the open pack; s3 then has nothing.
    for (let i = 0; i < 3; i++) {
      await x.tx((t, tb) =>
        x.appendCredit(t, tb, { clientPackageId: all, delta: -1, reason: "redeem", referenceId: `d${i}` }),
      );
    }
    expect(await find([s3])).toBeNull();
    // Never-expiring restricted pack sorts after expiring ones.
    expect(await find([s2])).toMatchObject({ id: only2 });
  });

  itDb("reconciliation: 60 mixed operations across 2 packages keep cache, sum and latest balance equal", async () => {
    const x = await lib("cl14");
    const a = await x.newPack({ name: "A" });
    const b = await x.newPack({ name: "B" });
    const model: Record<string, number> = { [a]: 0, [b]: 0 };
    const redeemed: Record<string, string[]> = { [a]: [], [b]: [] };
    const refunded = new Set<string>();

    const reconcile = async () => {
      const rows = await x.t.run(
        `SELECT cp.id FROM "${x.S}".client_packages cp
          WHERE cp.credits_remaining <> COALESCE((SELECT sum(delta) FROM "${x.S}".credit_ledger l WHERE l.client_package_id = cp.id), 0)
             OR cp.credits_remaining <> COALESCE((SELECT balance_after FROM "${x.S}".credit_ledger l WHERE l.client_package_id = cp.id ORDER BY created_at DESC, id DESC LIMIT 1), 0)`,
      );
      expect(rows).toHaveLength(0);
    };

    type Op = "buy" | "redeem" | "refund" | "adjustDown" | "adjustUp" | "expire" | "grant" | "overdraw";
    const cycle: Op[] = ["buy", "redeem", "redeem", "grant", "redeem", "refund", "adjustDown", "expire", "redeem", "adjustUp", "overdraw", "redeem"];
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const pkg = i % 2 === 0 ? a : b;
      let op = cycle[(i >> 1) % cycle.length];
      // Keep the sequence valid against the model; fall back to a purchase when it would not be.
      if (op === "redeem" && model[pkg] < 1) op = "buy";
      if (op === "refund" && !redeemed[pkg].some((id) => !refunded.has(id))) op = "grant";
      if (op === "adjustDown" && model[pkg] < 1) op = "adjustUp";
      if (op === "expire" && model[pkg] < 2) op = "grant";
      const ref = `op${n++}`;
      const add = (delta: number, reason: Parameters<typeof x.appendCredit>[2]["reason"]) =>
        x.tx((t, tb) => x.appendCredit(t, tb, { clientPackageId: pkg, delta, reason, referenceId: ref }));
      if (op === "buy") { await add(10, "purchase"); model[pkg] += 10; }
      else if (op === "grant") { await add(8, "grant"); model[pkg] += 8; }
      else if (op === "adjustUp") { await add(3, "adjust"); model[pkg] += 3; }
      else if (op === "adjustDown") { await add(-1, "adjust"); model[pkg] -= 1; }
      else if (op === "expire") { await add(-2, "expire"); model[pkg] -= 2; }
      else if (op === "redeem") {
        const e = await add(-1, "redeem");
        redeemed[pkg].push(e.id);
        model[pkg] -= 1;
      } else if (op === "refund") {
        const id = redeemed[pkg].find((r) => !refunded.has(r))!;
        refunded.add(id);
        await x.tx((t, tb) => x.refundEntry(t, tb, id, "refund"));
        model[pkg] += 1;
      } else {
        // Larger than the balance: refused, nothing changes.
        const err = await add(-(model[pkg] + 1), "adjust").then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(x.CreditError);
      }
      await reconcile();
    }
    expect((await x.state(a)).credits_remaining).toBe(model[a]);
    expect((await x.state(b)).credits_remaining).toBe(model[b]);
  });

  itDb("membership credits: grant, rollover, expire and idempotency by invoice", async () => {
    const x = await lib("cl15");
    const [plan] = await x.t.run(
      `INSERT INTO "${x.S}".membership_plans (name, monthly_amount_cents, kind, credits_per_period, rollover_max)
       VALUES ('Gold', 5000, 'credits', 8, 4) RETURNING id`,
    );
    const [cm] = await x.t.run(
      `INSERT INTO "${x.S}".client_memberships (client_id, plan_id) VALUES ('${x.client}', '${plan.id}') RETURNING id`,
    );
    const grant = (invoiceId: string) =>
      x.tx((t, tb) =>
        x.grantMembershipCredits(t, tb, {
          clientMembershipId: cm.id as string,
          clientId: x.client,
          planName: "Gold",
          perPeriod: 8,
          rolloverMax: 4,
          eligible: [],
          invoiceId,
        }),
      );
    const packId = async () =>
      (await x.t.run(`SELECT id FROM "${x.S}".client_packages WHERE client_membership_id = '${cm.id}'`))[0].id as string;
    const remaining = async () => (await x.state(await packId())).credits_remaining;

    expect((await grant("in_1")).granted).toBe(true);
    expect(await remaining()).toBe(8);

    const pkg = await packId();
    for (let i = 0; i < 3; i++) {
      await x.tx((t, tb) =>
        x.appendCredit(t, tb, { clientPackageId: pkg, delta: -1, reason: "redeem", referenceId: `m${i}` }),
      );
    }
    expect(await remaining()).toBe(5);

    expect((await grant("in_2")).granted).toBe(true);
    expect(await remaining()).toBe(12);
    const rows = await x.t.run(
      `SELECT reason, delta, reference_id, balance_after FROM "${x.S}".credit_ledger
        WHERE client_package_id = '${pkg}' AND reason IN ('expire','grant') ORDER BY created_at, id`,
    );
    expect(rows.map((r) => [r.reason, r.delta, r.reference_id, r.balance_after])).toEqual([
      ["grant", 8, "in_1", 8],
      ["expire", -1, "rollover:in_2", 4],
      ["grant", 8, "in_2", 12],
    ]);

    // Same invoice again: nothing changes.
    const again = await grant("in_2");
    expect(again.granted).toBe(false);
    expect(await remaining()).toBe(12);
    expect(await x.rowCount(pkg)).toBe(6);
    // One pack per membership.
    expect(
      await x.t.run(`SELECT id FROM "${x.S}".client_packages WHERE client_membership_id = '${cm.id}'`),
    ).toHaveLength(1);
  });

  itDb("expiry cron: an expired pack with credits ends at 0 with status expired", async () => {
    const x = await lib("cl16");
    mockState.slug = x.t.slug;
    mockState.tenants = [{ slug: x.t.slug, schemaVersion: 99 }];
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000 * 30).toISOString();
    const due = await x.newPack({ credits: 7, expiresAt: past });
    const live = await x.newPack({ credits: 4, expiresAt: future });
    const never = await x.newPack({ credits: 2, expiresAt: null });

    process.env.CRON_SECRET = "cron-test";
    const { GET } = await import("@/app/api/cron/expire-credits/route");
    const call = () =>
      GET(new Request("http://localhost/api/cron/expire-credits", { headers: { authorization: "Bearer cron-test" } }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ expired: 1 });

    const [d] = await x.t.run(`SELECT status, credits_remaining FROM "${x.S}".client_packages WHERE id = '${due}'`);
    expect(d).toMatchObject({ status: "expired", credits_remaining: 0 });
    const [row] = await x.t.run(
      `SELECT delta, reason, reference_id, balance_after FROM "${x.S}".credit_ledger WHERE client_package_id = '${due}' AND reason = 'expire'`,
    );
    expect(row).toMatchObject({ delta: -7, reference_id: "expiry", balance_after: 0 });
    expect((await x.state(live)).credits_remaining).toBe(4);
    expect((await x.state(never)).credits_remaining).toBe(2);

    // A second run finds nothing to do.
    expect(await (await call()).json()).toMatchObject({ expired: 0 });
    expect(await x.rowCount(due)).toBe(2);

    // Tenants below schema version 51 are skipped.
    mockState.tenants = [{ slug: x.t.slug, schemaVersion: 50 }];
    expect(await (await call()).json()).toMatchObject({ expired: 0, tenants: [] });
  });

  itDb("webhook: invoice.paid on a credits plan grants credits and writes no stored_value row", async () => {
    const x = await lib("cl17");
    mockState.slug = x.t.slug;
    mockState.clientId = x.client;
    const [plan] = await x.t.run(
      `INSERT INTO "${x.S}".membership_plans (name, monthly_amount_cents, kind, credits_per_period, rollover_max)
       VALUES ('Gold', 5000, 'credits', 8, 4) RETURNING id`,
    );
    await x.t.run(
      `INSERT INTO "${x.S}".client_memberships (client_id, plan_id, stripe_subscription_id)
       VALUES ('${x.client}', '${plan.id}', 'sub_credits')`,
    );
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const deliver = () =>
      POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "sig" } }));
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200); // Stripe retries: still one grant.

    const grants = await x.t.run(
      `SELECT l.delta, l.reference_id FROM "${x.S}".credit_ledger l
         JOIN "${x.S}".client_packages cp ON cp.id = l.client_package_id
        WHERE cp.client_id = '${x.client}' AND l.reason = 'grant'`,
    );
    expect(grants).toEqual([{ delta: 8, reference_id: "in_wh1" }]);
    const sv = await x.t.run(`SELECT id FROM "${x.S}".stored_value_transactions`);
    expect(sv).toHaveLength(0);
    const [cm] = await x.t.run(
      `SELECT status, current_period_end FROM "${x.S}".client_memberships WHERE stripe_subscription_id = 'sub_credits'`,
    );
    expect(cm.status).toBe("active");
    expect(cm.current_period_end).not.toBeNull();
  });
});
