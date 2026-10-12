// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;
vi.setConfig({ testTimeout: 120_000 });

const state = vi.hoisted(() => ({ slug: "", clientId: "", packages: true }));
const ModuleDisabledError = vi.hoisted(() => class extends Error {});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: async () => state.slug,
  getTenantSlugOrNull: async () => state.slug,
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  requireAdminRole: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  getUserRole: async () => "owner",
  getActiveStaffRole: async () => null,
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
  hasModule: async (_slug: string, id: string) => (id === "packages" ? state.packages : false),
  assertModule: async () => {
    if (!state.packages) throw new ModuleDisabledError("Packs are not available here.");
  },
  ModuleDisabledError,
}));
vi.mock("@/lib/booking/session-cookie", () => ({ getBookingSession: async () => state.clientId }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/booking/confirmations", () => ({ sendBookingConfirmations: async () => undefined }));
vi.mock("@/actions/calendar-sync", () => ({
  isExternalSlotAvailable: async () => ({ available: true }),
}));
vi.mock("@/lib/calendar/sync-tenant", () => ({
  pushBookingToCalendarForTenant: async () => undefined,
  deleteBookingFromCalendarForTenant: async () => undefined,
}));
vi.mock("@/lib/services/sync-auto-assistant-tasks", () => ({
  syncAutoAssistantTasksForAppointment: async () => undefined,
}));
vi.mock("@/lib/stripe/connect-charge-params", () => ({ getConnectChargeParams: async () => null }));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (key: string) => key }));
// In-memory Stripe: PaymentIntents are created and retrieved with the amount they were made for.
const intents = vi.hoisted(() => new Map<string, { id: string; amount: number; client_secret: string }>());
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    customers: { create: async () => ({ id: "cus_fake" }) },
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
const HOUR = 3_600_000;
const PRICE = 10_000;
const DEPOSIT = 2_000;

afterAll(async () => {
  delete process.env.PAYMENTS_FAKE;
  if (t) await t.drop();
});

/** A start time `hours` from now, 15-minute aligned. */
const inHours = (hours: number) => new Date(Math.ceil((Date.now() + hours * HOUR) / 900_000) * 900_000);
const range = (start: Date) => `tstzrange('${start.toISOString()}','${new Date(start.getTime() + HOUR).toISOString()}','[)')`;

describe("using credits at booking, cancel and checkout against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    process.env.PAYMENTS_FAKE = "1";
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("redeem");
    state.slug = t.slug;
    ids.l1 = await one(`select id from ${s()}.locations order by created_at limit 1`);
    ids.staff = await one(`insert into ${s()}.staff (display_name) values ('Riley') returning id`);
    for (let dow = 0; dow <= 6; dow++) {
      await t.run(
        `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids.staff}', ${dow}, '00:00', '23:59', 1, '${ids.l1}')`,
      );
    }
    // A $100 service with a $20 fixed deposit.
    ids.svc = await one(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents, deposit_type, deposit_amount) values ('Session', 60, ${PRICE}, 'fixed', ${DEPOSIT}) returning id`,
    );
    await t.run(`insert into ${s()}.staff_services (staff_id, service_id) values ('${ids.staff}', '${ids.svc}')`);
    await t.run(`insert into ${s()}.business_settings (deposit_enabled) select 1 where not exists (select 1 from ${s()}.business_settings)`);
    await t.run(`update ${s()}.business_settings set deposit_enabled = 1, cancellation_window_hours = 24`);
  }, 180_000);

  /** A client with a pack of `credits` (a purchase ledger row; the trigger keeps the balance). */
  async function clientWithPack(name: string, credits: number, opts: { card?: boolean } = {}) {
    const client = await one(
      `insert into ${s()}.clients (name${opts.card ? ", stripe_customer_id, stripe_payment_method_id" : ""})
       values ('${name}'${opts.card ? ", 'cus_fake', 'pm_fake'" : ""}) returning id`,
    );
    let pkg = "";
    if (credits > 0) {
      pkg = await one(`insert into ${s()}.client_packages (client_id, name) values ('${client}', 'Ten pack') returning id`);
      await t.run(
        `insert into ${s()}.credit_ledger (client_package_id, reason, delta, reference_id) values ('${pkg}', 'purchase', ${credits}, 'seed:${pkg}')`,
      );
    }
    return { client, pkg };
  }
  const balance = async (pkg: string) =>
    Number((await t.run(`select credits_remaining from ${s()}.client_packages where id = '${pkg}'`))[0].credits_remaining);
  const ledgerRows = async (pkg: string, reason: string) =>
    (await t.run(`select delta, appointment_id from ${s()}.credit_ledger where client_package_id = '${pkg}' and reason = '${reason}'`));

  /** A confirmed appointment starting in `hours` hours, with one $100 line. */
  async function appt(client: string, hours: number) {
    // A staff member per visit, so the no-overlap rule never gets in the way.
    const staff = await one(`insert into ${s()}.staff (display_name) values ('Helper') returning id`);
    const id = await one(
      `insert into ${s()}.appointments (staff_id, client_id, location_id, status, during)
       values ('${staff}','${client}','${ids.l1}','confirmed', ${range(inHours(hours))}) returning id`,
    );
    await t.run(
      `insert into ${s()}.appointment_services (appointment_id, service_id, duration_minutes, price_charged_cents) values ('${id}','${ids.svc}',60,${PRICE})`,
    );
    return id;
  }
  /** Spends a credit on an appointment the way booking does. */
  async function redeem(client: string, apptId: string) {
    const { withTenantDb } = await import("@/lib/db/tenant");
    const { redeemForAppointment } = await import("@/lib/credits/ledger");
    const entry = await withTenantDb(t.slug, (db, tables) =>
      db.transaction((tx) => redeemForAppointment(tx, tables, { clientId: client, serviceIds: [ids.svc], appointmentId: apptId })),
    );
    expect(entry).not.toBeNull();
  }
  const apptRow = async (id: string) =>
    (await t.run(`select status, credit_entry_id, deposit_cents from ${s()}.appointments where id = '${id}'`))[0];

  itDb("confirmBooking with useCredit spends one credit, links it and skips the deposit", async () => {
    const { confirmBooking } = await import("@/actions/booking-public");
    const { client, pkg } = await clientWithPack("Booker", 3, { card: true });
    state.clientId = client;
    const res = await confirmBooking({
      salonId: t.slug,
      staffId: ids.staff,
      clientId: client,
      serviceIds: [ids.svc],
      startTime: inHours(72).toISOString(),
      useCredit: true,
    });
    expect(res).toMatchObject({ success: true, creditApplied: true });
    const id = (res as { booking: { id: string; depositCents: number } }).booking.id;
    expect((res as { booking: { depositCents: number } }).booking.depositCents).toBe(0);
    const row = await apptRow(id);
    expect(row.credit_entry_id).not.toBeNull();
    expect(row.deposit_cents).toBe(0);
    expect(await balance(pkg)).toBe(2);
    expect(await ledgerRows(pkg, "redeem")).toEqual([{ delta: -1, appointment_id: id }]);
    // No deposit charge was made even though the client has a card on file.
    expect(await t.run(`select id from ${s()}.charges where appointment_id = '${id}'`)).toHaveLength(0);
  });

  itDb("confirmBooking without useCredit leaves the credit alone and takes the deposit", async () => {
    const { confirmBooking } = await import("@/actions/booking-public");
    const { client, pkg } = await clientWithPack("NoUse", 3);
    state.clientId = client;
    const res = await confirmBooking({
      salonId: t.slug, staffId: ids.staff, clientId: client, serviceIds: [ids.svc], startTime: inHours(73).toISOString(),
    });
    expect(res).toMatchObject({ success: true, creditApplied: false });
    const id = (res as { booking: { id: string } }).booking.id;
    expect((await apptRow(id)).deposit_cents).toBe(DEPOSIT);
    expect(await balance(pkg)).toBe(3);
  });

  itDb("confirmBooking with useCredit but no package keeps the booking and runs the deposit flow", async () => {
    const { confirmBooking } = await import("@/actions/booking-public");
    const { client } = await clientWithPack("NoPack", 0);
    state.clientId = client;
    const res = await confirmBooking({
      salonId: t.slug, staffId: ids.staff, clientId: client, serviceIds: [ids.svc], startTime: inHours(74).toISOString(), useCredit: true,
    });
    expect(res).toMatchObject({ success: true, creditApplied: false });
    const id = (res as { booking: { id: string; depositCents: number } }).booking.id;
    expect((res as { booking: { depositCents: number } }).booking.depositCents).toBe(DEPOSIT);
    const row = await apptRow(id);
    expect(row.credit_entry_id).toBeNull();
    expect(row.deposit_cents).toBe(DEPOSIT);
  });

  itDb("only the signed-in client can spend their credits, and the module gate holds", async () => {
    const { confirmBooking, getCreditOption } = await import("@/actions/booking-public");
    const { client, pkg } = await clientWithPack("Owner", 2);
    const { client: other } = await clientWithPack("Stranger", 0);
    state.clientId = other;
    const res = await confirmBooking({
      salonId: t.slug, staffId: ids.staff, clientId: client, serviceIds: [ids.svc], startTime: inHours(75).toISOString(), useCredit: true,
    });
    expect(res).toEqual({ success: false, error: "Sign in to book" });
    expect(await balance(pkg)).toBe(2);

    state.clientId = client;
    expect(await getCreditOption([ids.svc])).toEqual({ name: "Ten pack", remaining: 2 });
    state.packages = false;
    try {
      expect(await getCreditOption([ids.svc])).toBeNull();
      const off = await confirmBooking({
        salonId: t.slug, staffId: ids.staff, clientId: client, serviceIds: [ids.svc], startTime: inHours(76).toISOString(), useCredit: true,
      });
      expect(off).toMatchObject({ success: true, creditApplied: false });
      expect(await balance(pkg)).toBe(2);
    } finally {
      state.packages = true;
    }
  });

  itDb("cancelBooking 48 h ahead (24 h window) gives the credit back; 2 h ahead keeps it burned", async () => {
    const { cancelBooking } = await import("@/actions/appointments");
    const { client, pkg } = await clientWithPack("Canceller", 5);
    const early = await appt(client, 48);
    const late = await appt(client, 2);
    await redeem(client, early);
    await redeem(client, late);
    expect(await balance(pkg)).toBe(3);

    expect(await cancelBooking({ appointmentId: early })).toMatchObject({ success: true });
    expect((await apptRow(early)).status).toBe("cancelled");
    expect(await balance(pkg)).toBe(4);
    expect(await ledgerRows(pkg, "refund")).toHaveLength(1);

    // Cancelling again does not give a second credit.
    await cancelBooking({ appointmentId: early });
    expect(await balance(pkg)).toBe(4);

    expect(await cancelBooking({ appointmentId: late })).toMatchObject({ success: true });
    expect((await apptRow(late)).status).toBe("cancelled");
    expect(await balance(pkg)).toBe(4);
    expect(await ledgerRows(pkg, "refund")).toHaveLength(1);
  });

  itDb("the client cancel link and the admin dialog (cancelBookingWithFee) use the same rule", async () => {
    const { cancelBookingWithFee } = await import("@/actions/appointments");
    const { client, pkg } = await clientWithPack("Linker", 5);
    const early = await appt(client, 48);
    const late = await appt(client, 2);
    await redeem(client, early);
    await redeem(client, late);
    expect(await balance(pkg)).toBe(3);

    // Outside the window: no fee, credit back.
    expect(await cancelBookingWithFee({ appointmentId: early })).toMatchObject({ success: true });
    expect(await balance(pkg)).toBe(4);
    // Inside the window: the fee path cancels, and the credit is burned.
    expect(await cancelBookingWithFee({ appointmentId: late })).toMatchObject({ success: true });
    expect((await apptRow(late)).status).toBe("cancelled");
    expect(await balance(pkg)).toBe(4);
    // Staff waiving the fee is still a late cancel for the credit.
    const waived = await appt(client, 3);
    await redeem(client, waived);
    expect(await cancelBookingWithFee({ appointmentId: waived, skipFee: true })).toMatchObject({ success: true });
    expect(await balance(pkg)).toBe(3);
  });

  itDb("deleting a mistaken booking gives its credit back whatever the time", async () => {
    const { deleteBooking } = await import("@/actions/appointments");
    const { client, pkg } = await clientWithPack("Deleter", 2);
    const soon = await appt(client, 2);
    await redeem(client, soon);
    expect(await balance(pkg)).toBe(1);
    expect(await deleteBooking({ appointmentId: soon })).toMatchObject({ success: true });
    expect(await balance(pkg)).toBe(2);
  });

  itDb("no-show keeps the credit", async () => {
    const { client, pkg } = await clientWithPack("NoShow", 2);
    const a = await appt(client, 1);
    await redeem(client, a);
    await t.run(`update ${s()}.appointments set status = 'no_show' where id = '${a}'`);
    expect(await balance(pkg)).toBe(1);
    expect(await ledgerRows(pkg, "refund")).toHaveLength(0);
  });

  itDb("takeLateCancelCredit on a cancelled appointment writes one late_cancel row; a second call is refused", async () => {
    const { takeLateCancelCredit, getLateCancelCreditOption } = await import("@/actions/credit-redemption");
    const { client, pkg } = await clientWithPack("Late", 3);
    const a = await appt(client, 1);
    // Still confirmed: nothing to take.
    expect(await getLateCancelCreditOption(a)).toBe(false);
    expect(await takeLateCancelCredit(a)).toMatchObject({ success: false });
    await t.run(`update ${s()}.appointments set status = 'cancelled' where id = '${a}'`);
    expect(await getLateCancelCreditOption(a)).toBe(true);

    expect(await takeLateCancelCredit(a)).toEqual({ success: true });
    expect(await balance(pkg)).toBe(2);
    expect(await ledgerRows(pkg, "late_cancel")).toEqual([{ delta: -1, appointment_id: a }]);
    expect((await apptRow(a)).credit_entry_id).not.toBeNull();
    expect(await getLateCancelCreditOption(a)).toBe(false);

    expect(await takeLateCancelCredit(a)).toMatchObject({ success: false });
    expect(await balance(pkg)).toBe(2);
    expect(await ledgerRows(pkg, "late_cancel")).toHaveLength(1);
  });

  itDb("takeLateCancelCredit works on a no-show and refuses when no pack fits", async () => {
    const { takeLateCancelCredit, getLateCancelCreditOption } = await import("@/actions/credit-redemption");
    const { client, pkg } = await clientWithPack("LateNoShow", 1);
    const a = await appt(client, 1);
    await t.run(`update ${s()}.appointments set status = 'no_show' where id = '${a}'`);
    expect(await takeLateCancelCredit(a)).toEqual({ success: true });
    expect(await balance(pkg)).toBe(0);

    const b = await appt(client, 1);
    await t.run(`update ${s()}.appointments set status = 'cancelled' where id = '${b}'`);
    expect(await getLateCancelCreditOption(b)).toBe(false);
    expect(await takeLateCancelCredit(b)).toMatchObject({ success: false });
    expect(await balance(pkg)).toBe(0);
  });

  const payment = async (apptId: string) =>
    (await t.run(
      `select amount_cents, tip_cents, status from ${s()}.charges where appointment_id = '${apptId}' and reason = 'service_payment'`,
    ))[0];

  itDb("a credit-covered checkout with a $5 tip charges the tip, and the intent equals the completion", async () => {
    const { createCheckoutPaymentIntent, completeAppointment, getCheckoutData } = await import("@/actions/checkout");
    const { loadCheckoutSet } = await import("@/lib/checkout/checkout-set");
    const { withTenantDb } = await import("@/lib/db/tenant");
    const { client, pkg } = await clientWithPack("CoveredTip", 2, { card: true });
    const a = await appt(client, 1);
    await redeem(client, a);

    const loaded = await withTenantDb(t.slug, (db, tables) => loadCheckoutSet(db, tables, a, { creditsEnabled: true }));
    expect(loaded.ok && loaded.set).toMatchObject({ creditCovered: true, creditEligible: false });
    expect(await getCheckoutData(a)).toMatchObject({ creditCovered: true, cardChargeCents: 0, totalCents: PRICE });

    const intent = await createCheckoutPaymentIntent(a, 500);
    expect(intent).toHaveProperty("clientSecret");
    const pi = [...intents.values()].at(-1)!;
    expect(pi.amount).toBe(500);
    const done = await completeAppointment({ appointmentId: a, paymentMethod: "new_card", stripePaymentIntentId: pi.id, tipCents: 500 });
    expect(done).toMatchObject({ success: true, totalCents: 500 });
    // The recorded service payment is the tip only; the services were paid with the credit.
    expect(await payment(a)).toMatchObject({ amount_cents: 500, tip_cents: 500, status: "completed" });
    expect((await apptRow(a)).status).toBe("completed");
    expect(await balance(pkg)).toBe(1);
  });

  itDb("a credit-covered checkout with no tip creates no intent and records a $0 payment", async () => {
    const { createCheckoutPaymentIntent, completeAppointment } = await import("@/actions/checkout");
    const { client } = await clientWithPack("CoveredNoTip", 2, { card: true });
    const a = await appt(client, 1);
    await redeem(client, a);
    const before = intents.size;
    expect(await createCheckoutPaymentIntent(a, 0)).toMatchObject({ noCardChargeNeeded: true });
    expect(intents.size).toBe(before);
    expect(await completeAppointment({ appointmentId: a, paymentMethod: "cash" })).toMatchObject({ success: true, totalCents: 0 });
    expect(await payment(a)).toMatchObject({ amount_cents: 0, status: "completed" });
    // Paying "from the prepaid balance" cannot dip into it for a covered visit.
    const b = await appt(client, 2);
    await redeem(client, b);
    expect(await completeAppointment({ appointmentId: b, paymentMethod: "beauty_bank" })).toMatchObject({ success: true, totalCents: 0 });
    expect(await t.run(`select id from ${s()}.stored_value_transactions where client_id = '${client}'`)).toHaveLength(0);
  });

  itDb("applyCreditAtCheckout covers the visit and its amounts drop to the tip", async () => {
    const { applyCreditAtCheckout } = await import("@/actions/credit-redemption");
    const { getCheckoutData, createCheckoutPaymentIntent, completeAppointment } = await import("@/actions/checkout");
    const { client, pkg } = await clientWithPack("AtCheckout", 2, { card: true });
    const a = await appt(client, 1);

    const before = await getCheckoutData(a);
    expect(before).toMatchObject({ creditCovered: false, creditEligible: true, cardChargeCents: PRICE });

    expect(await applyCreditAtCheckout(a)).toEqual({ success: true });
    expect(await balance(pkg)).toBe(1);
    expect((await apptRow(a)).credit_entry_id).not.toBeNull();

    const after = await getCheckoutData(a);
    expect(after).toMatchObject({ creditCovered: true, creditEligible: false, cardChargeCents: 0 });
    expect(await createCheckoutPaymentIntent(a, 300)).toHaveProperty("clientSecret");
    const pi = [...intents.values()].at(-1)!;
    expect(pi.amount).toBe(300);
    expect(await completeAppointment({ appointmentId: a, paymentMethod: "new_card", stripePaymentIntentId: pi.id, tipCents: 300 })).toMatchObject({
      success: true,
      totalCents: 300,
    });

    // A second credit on the same visit is refused.
    expect(await applyCreditAtCheckout(a)).toMatchObject({ success: false });
    expect(await balance(pkg)).toBe(1);
  });

  itDb("no eligible pack, a collected deposit or the module off means no \"Use a credit\"", async () => {
    const { getCheckoutData } = await import("@/actions/checkout");
    const { applyCreditAtCheckout } = await import("@/actions/credit-redemption");
    const none = await clientWithPack("NoCredit", 0);
    expect(await getCheckoutData(await appt(none.client, 1))).toMatchObject({ creditEligible: false });

    const { client, pkg } = await clientWithPack("HasDeposit", 2);
    const withDeposit = await appt(client, 1);
    await t.run(
      `insert into ${s()}.charges (appointment_id, client_id, amount_cents, reason, status) values ('${withDeposit}','${client}',${DEPOSIT},'deposit','completed')`,
    );
    expect(await getCheckoutData(withDeposit)).toMatchObject({ creditEligible: false });
    expect(await applyCreditAtCheckout(withDeposit)).toMatchObject({ success: false });
    expect(await balance(pkg)).toBe(2);

    const plain = await appt(client, 2);
    state.packages = false;
    try {
      expect(await getCheckoutData(plain)).toMatchObject({ creditCovered: false, creditEligible: false, cardChargeCents: PRICE });
      expect(await applyCreditAtCheckout(plain)).toMatchObject({ success: false });
    } finally {
      state.packages = true;
    }
    expect(await balance(pkg)).toBe(2);
  });
});
