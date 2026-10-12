// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({ slug: "", staffThrows: false }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: async () => state.slug,
  getTenantSlugOrNull: async () => state.slug,
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  requireStaff: async () => {
    if (state.staffThrows) throw new Error("staff session required");
    return { userId: "u1", role: "owner", tenantSlug: state.slug };
  },
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
const deliverDesign = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/projects/deliver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects/deliver")>()),
  deliverDesign,
}));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (key: string) => key }));
// Real payment seam (PAYMENTS_FAKE=1), wrapped so the test can read the card amount.
vi.mock("@/lib/services/charge-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/charge-processing")>();
  return { ...actual, processOffSessionCharge: vi.fn((p: Parameters<typeof actual.processOffSessionCharge>[0]) => actual.processOffSessionCharge(p)) };
});

// In-memory Stripe: PaymentIntents are created and retrieved with the amount they were made for.
const intents = vi.hoisted(() => new Map<string, { id: string; amount: number; client_secret: string }>());
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    paymentIntents: {
      create: async (p: { amount: number }) => {
        const id = `pi_fake_${intents.size + 1}`;
        const pi = { id, amount: p.amount, client_secret: `${id}_secret` };
        intents.set(id, pi);
        return pi;
      },
      retrieve: async (id: string) => intents.get(id)!,
    },
  }),
}));

let t: ScratchTenant;
const ids = {} as Record<string, string>;
const s = () => `"${t.schema}"`;
const one = async (q: string) => String((await t.run(q))[0].id);
const range = (a: string, b: string) => `tstzrange('${a}','${b}','[)')`;

const PRICE = 40000;
const DEPOSIT = 20000;

let storageDir = "";

afterAll(async () => {
  delete process.env.PAYMENTS_FAKE;
  vi.unstubAllEnvs();
  if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true });
  if (t) await t.drop();
});

describe("project deposit credit against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    process.env.PAYMENTS_FAKE = "1";
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-files-"));
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_LOCAL_DIR", storageDir);
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("proj");
    state.slug = t.slug;
    ids.l1 = await one(`select id from ${s()}.locations order by created_at limit 1`);
    ids.client = await one(
      `insert into ${s()}.clients (name, stripe_customer_id, stripe_payment_method_id) values ('Casey', 'cus_fake', 'pm_fake') returning id`,
    );
    ids.staff = await one(`insert into ${s()}.staff (display_name) values ('Riley') returning id`);
    ids.svc = await one(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Sleeve session', 120, ${PRICE}) returning id`,
    );
    ids.project = await one(
      `insert into ${s()}.projects (client_id, staff_id, title, est_sessions, quoted_total_cents, status, access_token)
       values ('${ids.client}', '${ids.staff}', 'Sleeve', 3, 120000, 'scheduled', 'tok-${Date.now()}') returning id`,
    );
  }, 180_000);

  const appt = async (day: string, projectId: string | null) => {
    const id = await one(
      `insert into ${s()}.appointments (staff_id, client_id, location_id, status, project_id, during)
       values ('${ids.staff}','${ids.client}','${ids.l1}','confirmed', ${projectId ? `'${projectId}'` : "null"}, ${range(`${day}T14:00:00Z`, `${day}T16:00:00Z`)}) returning id`,
    );
    await t.run(
      `insert into ${s()}.appointment_services (appointment_id, service_id, duration_minutes, price_charged_cents) values ('${id}','${ids.svc}',120,${PRICE})`,
    );
    return id;
  };

  const cardCalls = async () => {
    const { processOffSessionCharge } = await import("@/lib/services/charge-processing");
    return vi.mocked(processOffSessionCharge).mock.calls;
  };
  const lastCardAmount = async () => (await cardCalls()).at(-1)![0].amountCents;
  const payment = async (apptId: string) =>
    (await t.run(
      `select amount_cents, deposit_applied_cents, status from ${s()}.charges where appointment_id = '${apptId}' and reason = 'service_payment'`,
    ))[0];
  const ledger = async () => {
    const { getProject } = await import("@/actions/projects");
    return (await getProject(ids.project))!.ledger;
  };

  itDb("charges the full price until the final session, then applies the whole deposit credit", async () => {
    const { completeAppointment } = await import("@/actions/checkout");
    const { loadCheckoutSet } = await import("@/lib/checkout/checkout-set");
    const { withTenantDb } = await import("@/lib/db/tenant");

    ids.a1 = await appt("2026-11-02", ids.project);
    ids.a2 = await appt("2026-11-09", ids.project);
    ids.a3 = await appt("2026-11-16", ids.project);
    await t.run(
      `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${ids.a1}','${ids.client}',${DEPOSIT},'deposit','completed')`,
    );

    const info = async (id: string) => {
      const r = await withTenantDb(t.slug, (db, tables) => loadCheckoutSet(db, tables, id));
      if (!r.ok) throw new Error(r.error);
      return r.set.project;
    };
    expect(await info(ids.a1)).toMatchObject({ id: ids.project, depositCreditCents: DEPOSIT, isLastScheduled: false });
    expect(await info(ids.a3)).toMatchObject({ depositCreditCents: DEPOSIT, isLastScheduled: false });

    // Session 1, not final: the card pays the full price.
    const r1 = await completeAppointment({ appointmentId: ids.a1, paymentMethod: "card_on_file", finalProjectSession: false });
    expect(r1.success).toBe(true);
    expect(await lastCardAmount()).toBe(PRICE);
    expect(await payment(ids.a1)).toMatchObject({ amount_cents: PRICE, deposit_applied_cents: 0 });
    expect(await ledger()).toMatchObject({ paidCents: 60000, balanceCents: 60000, depositCreditCents: DEPOSIT });

    // Session 2: same. The flag is ignored for the card amount unless true.
    const r2 = await completeAppointment({ appointmentId: ids.a2, paymentMethod: "card_on_file" });
    expect(r2.success).toBe(true);
    expect(await lastCardAmount()).toBe(PRICE);
    expect(await payment(ids.a2)).toMatchObject({ deposit_applied_cents: 0 });
    expect(await ledger()).toMatchObject({ paidCents: 100000, balanceCents: 20000, depositCreditCents: DEPOSIT });

    // Session 3 is the last one scheduled and reaches the planned count.
    expect(await info(ids.a3)).toMatchObject({ depositCreditCents: DEPOSIT, isLastScheduled: true });
    const r3 = await completeAppointment({ appointmentId: ids.a3, paymentMethod: "card_on_file", finalProjectSession: true });
    expect(r3.success).toBe(true);
    expect(await lastCardAmount()).toBe(PRICE - DEPOSIT);
    expect(await payment(ids.a3)).toMatchObject({ amount_cents: PRICE, deposit_applied_cents: DEPOSIT });
    expect(await ledger()).toMatchObject({
      billedCents: 120000,
      depositsCents: DEPOSIT,
      appliedCents: DEPOSIT,
      paidCents: 120000,
      balanceCents: 0,
      depositCreditCents: 0,
    });
  }, 120_000);

  itDb("getProject lists the sessions with what each paid, and the design state", async () => {
    const { getProject, listProjects } = await import("@/actions/projects");
    const detail = await getProject(ids.project);
    expect(detail).not.toBeNull();
    expect(detail!.appointments.map((a) => a.id)).toEqual([ids.a1, ids.a2, ids.a3]);
    expect(detail!.appointments.map((a) => a.status)).toEqual(["completed", "completed", "completed"]);
    expect(detail!.appointments.map((a) => a.paidCents)).toEqual([PRICE, PRICE, PRICE]);
    expect(detail!.appointments[0].serviceNames).toEqual(["Sleeve session"]);
    expect(detail!.design).toMatchObject({ viewUrl: null, sentAt: null, approvedAt: null });

    const rows = await listProjects("all");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ids.project, clientName: "Casey", doneSessions: 3, leftToPayCents: 0 });
    expect(await listProjects("complete")).toEqual([]);
  });

  itDb("a booking that is not in a project still subtracts its own deposit (regression)", async () => {
    const { completeAppointment } = await import("@/actions/checkout");
    const solo = await appt("2026-11-23", null);
    await t.run(
      `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${solo}','${ids.client}',1000,'deposit','completed')`,
    );
    // The flag has no meaning outside a project.
    const res = await completeAppointment({ appointmentId: solo, paymentMethod: "card_on_file", finalProjectSession: true });
    expect(res.success).toBe(true);
    expect(await lastCardAmount()).toBe(PRICE - 1000);
    expect(await payment(solo)).toMatchObject({ amount_cents: PRICE, deposit_applied_cents: 1000 });

    const plain = await appt("2026-11-30", null);
    expect((await completeAppointment({ appointmentId: plain, paymentMethod: "card_on_file" })).success).toBe(true);
    expect(await lastCardAmount()).toBe(PRICE);
    expect(await payment(plain)).toMatchObject({ deposit_applied_cents: 0 });
  }, 120_000);

  itDb("a new-card PaymentIntent equals what completeAppointment accepts: deposit, tip, no deposit (regression)", async () => {
    const { completeAppointment, createCheckoutPaymentIntent } = await import("@/actions/checkout");
    const cases = [
      { day: "2026-12-07", deposit: 1000, tip: 0 },
      { day: "2026-12-08", deposit: 1000, tip: 500 },
      { day: "2026-12-09", deposit: 0, tip: 0 },
      { day: "2026-12-10", deposit: 0, tip: 700 },
    ];
    for (const c of cases) {
      const id = await appt(c.day, null);
      if (c.deposit) {
        await t.run(
          `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${id}','${ids.client}',${c.deposit},'deposit','completed')`,
        );
      }
      const expected = PRICE + c.tip - c.deposit;
      const intent = await createCheckoutPaymentIntent(id, c.tip);
      expect(intent).toHaveProperty("clientSecret");
      const pi = [...intents.values()].at(-1)!;
      expect(pi.amount).toBe(expected);
      const res = await completeAppointment({ appointmentId: id, paymentMethod: "new_card", stripePaymentIntentId: pi.id, tipCents: c.tip });
      expect(res).toMatchObject({ success: true });
      expect(await payment(id)).toMatchObject({ amount_cents: PRICE + c.tip, deposit_applied_cents: c.deposit });
    }
  }, 120_000);

  itDb("a deposit that covers the whole visit creates no PaymentIntent", async () => {
    const { createCheckoutPaymentIntent } = await import("@/actions/checkout");
    const id = await appt("2026-12-14", null);
    await t.run(
      `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${id}','${ids.client}',${PRICE},'deposit','completed')`,
    );
    const before = intents.size;
    expect(await createCheckoutPaymentIntent(id, 0)).toMatchObject({ noCardChargeNeeded: true });
    expect(intents.size).toBe(before);
  }, 60_000);

  itDb("public checkout applies the same project deposit credit as staff checkout", async () => {
    const { getCheckoutData, getCheckoutDataPublic, createCheckoutPaymentIntent, completeAppointment } =
      await import("@/actions/checkout");

    const earlyProject = await one(
      `insert into ${s()}.projects (client_id, staff_id, title, est_sessions, quoted_total_cents, status, access_token)
       values ('${ids.client}', '${ids.staff}', 'Two sessions', 2, 80000, 'scheduled', 'tok-early-${Date.now()}') returning id`,
    );
    const early = await appt("2027-01-04", earlyProject);
    await appt("2027-01-11", earlyProject);
    await t.run(
      `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${early}','${ids.client}',${DEPOSIT},'deposit','completed')`,
    );
    expect(await getCheckoutData(early, false)).toMatchObject({ depositAppliedCents: 0, cardChargeCents: 40000 });
    const { createActionToken } = await import("@/lib/email/tokens");
    const earlyToken = createActionToken(early, "checkout");
    state.staffThrows = true;
    expect(await getCheckoutDataPublic(early, earlyToken)).toMatchObject({ depositAppliedCents: 0, cardChargeCents: 40000 });
    expect(await getCheckoutDataPublic(early, "not-a-token")).toMatchObject({ error: "Appointment not found" });
    state.staffThrows = false;

    const lastProject = await one(
      `insert into ${s()}.projects (client_id, staff_id, title, est_sessions, quoted_total_cents, status, access_token)
       values ('${ids.client}', '${ids.staff}', 'Last session', 1, 40000, 'scheduled', 'tok-last-${Date.now()}') returning id`,
    );
    const last = await appt("2027-01-18", lastProject);
    await t.run(
      `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${last}','${ids.client}',${DEPOSIT},'deposit','completed')`,
    );
    expect(await getCheckoutData(last, true)).toMatchObject({ depositAppliedCents: 20000, cardChargeCents: 20000 });
    const lastToken = createActionToken(last, "checkout");
    state.staffThrows = true;
    expect(await getCheckoutDataPublic(last, lastToken)).toMatchObject({ depositAppliedCents: 20000, cardChargeCents: 20000 });

    const intent = await createCheckoutPaymentIntent(last, 0, undefined, lastToken);
    expect(intent).toHaveProperty("clientSecret");
    const secret = (intent as { clientSecret: string }).clientSecret;
    const pi = [...intents.values()].find((row) => row.client_secret === secret);
    expect(pi?.amount).toBe(20000);
    expect(
      await completeAppointment({
        appointmentId: last,
        token: lastToken,
        paymentMethod: "new_card",
        stripePaymentIntentId: pi!.id,
        tipCents: 0,
      }),
    ).toMatchObject({ success: true });
    state.staffThrows = false;
    expect(await payment(last)).toMatchObject({ amount_cents: 40000, deposit_applied_cents: 20000 });
  }, 120_000);

  itDb("design approval: upload state, approve once, refuse a repeat", async () => {
    const { getProjectForClient, approveDesign } = await import("@/actions/projects");
    const token = String((await t.run(`select access_token from ${s()}.projects where id = '${ids.project}'`))[0].access_token);
    // The seeded token is not a 32-character link token, so make a real one.
    const real = "A".repeat(32);
    await t.run(`update ${s()}.projects set access_token = '${real}' where id = '${ids.project}'`);
    expect(token).not.toBe(real);

    expect(await getProjectForClient(t.slug, "short")).toBeNull();
    expect(await getProjectForClient(t.slug, real)).toMatchObject({ title: "Sleeve", approved: false, designUrl: null, balance: 0 });
    // No design yet: nothing to approve.
    expect(await approveDesign({ slug: t.slug, token: real, name: "Casey Client" })).toMatchObject({ success: false });

    // Upload through the action: it stores the file, moves a consult into design, clears approval.
    const { uploadProjectDesign, sendDesignForApproval } = await import("@/actions/projects");
    await t.run(`update ${s()}.projects set status = 'consult' where id = '${ids.project}'`);
    const png = new File(
      [Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])],
      "design.png",
      { type: "image/png" },
    );
    const form = new FormData();
    form.set("file", png);
    expect(await uploadProjectDesign(ids.project, form)).toEqual({ success: true });
    const [afterUpload] = await t.run(
      `select status, design_attachment_id, design_sent_at, design_approved_at from ${s()}.projects where id = '${ids.project}'`,
    );
    expect(afterUpload).toMatchObject({ status: "design", design_sent_at: null, design_approved_at: null });
    const att = String(afterUpload.design_attachment_id);
    const [stored] = await t.run(`select kind, owner_type, is_private, delete_after from ${s()}.attachments where id = '${att}'`);
    expect(stored).toMatchObject({ kind: "design", owner_type: "project", is_private: 1, delete_after: null });

    // Sending needs someone to send to; the client has no email or phone yet.
    expect(await sendDesignForApproval(ids.project)).toMatchObject({ success: false });
    await t.run(`update ${s()}.clients set email = 'casey@example.test' where id = '${ids.client}'`);
    expect(await sendDesignForApproval(ids.project)).toEqual({ success: true });
    const [sent] = await t.run(`select design_sent_at from ${s()}.projects where id = '${ids.project}'`);
    expect(sent.design_sent_at).not.toBeNull();
    expect(deliverDesign).toHaveBeenCalledTimes(1);
    expect(deliverDesign).toHaveBeenCalledWith(
      t.slug,
      expect.objectContaining({ clientId: ids.client, email: "casey@example.test", token: real }),
    );

    const page = await getProjectForClient(t.slug, real);
    expect(page?.designUrl).toContain(`/api/attachments/${t.slug}/${att}`);

    expect(await approveDesign({ slug: t.slug, token: real, name: "C" })).toMatchObject({ success: false });
    expect(await approveDesign({ slug: t.slug, token: real, name: "Casey Client" })).toEqual({ success: true });
    expect((await getProjectForClient(t.slug, real))?.approved).toBe(true);
    expect(await approveDesign({ slug: t.slug, token: real, name: "Someone Else" })).toMatchObject({ success: false });
    const [row] = await t.run(`select design_approved_name from ${s()}.projects where id = '${ids.project}'`);
    expect(row.design_approved_name).toBe("Casey Client");
  }, 60_000);
});
