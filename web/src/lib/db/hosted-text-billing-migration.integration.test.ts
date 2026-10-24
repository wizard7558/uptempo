import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { hostedTextBillingState } from "./schema/hosted-text-billing-state";
import { smsUsageReports } from "./schema/sms-usage-reports";

// Explicit opt-in plus URL and database markers prevent use of configured databases.
const enabled = process.env.HOSTED_TEXT_MIGRATION_TEST === "1";
const marker = "uptempo hosted-text disposable migration test";
const migration = readFileSync(resolve(process.cwd(), "drizzle/0038_hosted_text_billing_lifecycle.sql"), "utf8");
const rollback = readFileSync(resolve(process.cwd(), "drizzle/rollback/0038_hosted_text_billing_lifecycle.down.sql"), "utf8");
const legacyReportColumns = "id, tenant_slug, usage_date, quantity, meter_event_identifier, reported_at";

describe.skipIf(!enabled)("hosted text lifecycle migration 0038 (disposable local PostgreSQL)", () => {
  let client: postgres.Sql;
  let marked = false;
  const executeUp = async () => {
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) {
      await client.unsafe(statement);
    }
  };
  const clear = async () => {
    await client.unsafe("DROP TABLE IF EXISTS public.hosted_text_billing_state, public.sms_usage_reports, public.tenants");
    await client.unsafe("DROP FUNCTION IF EXISTS public.hosted_text_preserve_report_facts()");
  };
  const state = (tenantSlug = "tenant-a") => ({
    tenantSlug, customerId: `cus_${tenantSlug}`, subscriptionId: `sub_${tenantSlug}`,
  });
  const pending = () => ({
    tenantSlug: "tenant-a", usageDate: "2026-10-23", quantity: 4,
    reportStatus: "pending" as const, reportedAt: null,
    customerId: "cus_a", subscriptionId: "sub_a", meterEventIdentifier: "evt_a",
    meterEventTimestamp: 1792713600, firstAttemptAt: new Date("2026-10-23T00:00:00Z"),
  });
  const expectGuardedRollback = async () => {
    await expect(client.unsafe(rollback)).rejects.toThrow("0038 rollback refused");
    const [objects] = await client.unsafe(`SELECT
      to_regclass('public.hosted_text_billing_state') IS NOT NULL AS lifecycle,
      to_regprocedure('public.hosted_text_preserve_report_facts()') IS NOT NULL AS function,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hosted_text_preserve_report_facts') AS trigger,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'sms_usage_reports' AND column_name = 'report_status') AS status`);
    expect(objects).toEqual({ lifecycle: true, function: true, trigger: true, status: true });
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !url.port || Number(url.port) <= 1024 || url.port === "5432"
      || !/^\/hosted_text_lifecycle_test_[a-z0-9_]+$/.test(url.pathname)
      || url.search || url.hash) {
      throw new Error("Requires a dedicated local non-5432 hosted_text_lifecycle_test_* database");
    }
    client = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const [database] = await client.unsafe(`SELECT shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()`);
    if (database.marker !== marker) throw new Error("Disposable database marker missing");
    marked = true;
  });

  beforeEach(async () => {
    await clear();
    // Minimal accepted preimage: public tenant key and the exact 0034 report table.
    // No historical journal bootstrap, provider access, or environment-file loading.
    await client.unsafe(`CREATE TABLE public.tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      slug text NOT NULL UNIQUE, comped integer NOT NULL DEFAULT 0,
      platform_stripe_customer_id text, stripe_subscription_id text);
      INSERT INTO public.tenants (name, slug, comped) VALUES
        ('A', 'tenant-a', 0), ('B', 'tenant-b', 1)`);
    await client.unsafe(readFileSync(resolve(process.cwd(), "drizzle/0034_sms_usage_reports.sql"), "utf8"));
    await client.unsafe(`INSERT INTO public.sms_usage_reports
      (tenant_slug, usage_date, quantity, meter_event_identifier, reported_at) VALUES
      ('tenant-a', '2026-10-21', 2, 'legacy_evt', '2026-10-22T03:00:00Z'),
      ('tenant-b', '2026-10-21', 0, NULL, '2026-10-22T04:00:00Z')`);
  });

  afterAll(async () => {
    if (marked) await clear();
    if (client) await client.end();
  });

  it("preserves all legacy tenant/report values through migration and rollback and keeps old inserts compatible", async () => {
    const tenants = await client.unsafe("SELECT * FROM public.tenants ORDER BY slug");
    const reports = await client.unsafe(`SELECT ${legacyReportColumns} FROM public.sms_usage_reports ORDER BY tenant_slug`);
    await executeUp();
    expect(await client.unsafe("SELECT * FROM public.tenants ORDER BY slug")).toEqual(tenants);
    expect(await client.unsafe(`SELECT ${legacyReportColumns} FROM public.sms_usage_reports ORDER BY tenant_slug`)).toEqual(reports);
    expect(await client.unsafe("SELECT * FROM public.hosted_text_billing_state")).toHaveLength(0);
    expect((await client.unsafe("SELECT report_status FROM public.sms_usage_reports")).map((r) => r.report_status)).toEqual(["submitted", "submitted"]);
    await client.unsafe(`INSERT INTO public.sms_usage_reports (tenant_slug, usage_date, quantity)
      VALUES ('tenant-a', '2026-10-22', 0) ON CONFLICT DO NOTHING`);
    const [oldWriter] = await client.unsafe("SELECT * FROM public.sms_usage_reports WHERE usage_date = '2026-10-22'");
    expect(oldWriter.report_status).toBe("submitted");
    expect(oldWriter.reported_at).toBeInstanceOf(Date);
    await client.unsafe(`INSERT INTO public.sms_usage_reports (tenant_slug, usage_date, quantity)
      VALUES ('tenant-a', '2026-10-22', 9) ON CONFLICT DO NOTHING`);
    const beforeDown = await client.unsafe(`SELECT ${legacyReportColumns} FROM public.sms_usage_reports ORDER BY tenant_slug, usage_date`);
    await client.unsafe(rollback);
    expect(await client.unsafe("SELECT * FROM public.tenants ORDER BY slug")).toEqual(tenants);
    expect(await client.unsafe("SELECT * FROM public.sms_usage_reports ORDER BY tenant_slug, usage_date")).toEqual(beforeDown);
    const [column] = await client.unsafe(`SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sms_usage_reports' AND column_name = 'reported_at'`);
    expect(column).toEqual({ is_nullable: "NO", column_default: "now()" });
    const [objects] = await client.unsafe(`SELECT to_regclass('public.hosted_text_billing_state') AS lifecycle,
      to_regprocedure('public.hosted_text_preserve_report_facts()') AS function`);
    expect(objects).toEqual({ lifecycle: null, function: null });
    await executeUp();
    expect(await client.unsafe("SELECT * FROM public.hosted_text_billing_state")).toHaveLength(0);
  });

  it("keeps boundaries unresolved by default and accepts only consistent ready states", async () => {
    await executeUp();
    const db = drizzle(client);
    const [initial] = await db.insert(hostedTextBillingState).values(state()).returning();
    expect(initial).toEqual({ ...state(), billableFrom: null, boundaryKind: null, boundaryEventId: null,
      meterItemId: null, meterOperationId: null, nextUsageDate: null, lifecycleState: "unresolved" });
    for (const update of [
      "boundary_kind = 'trial_end'", "billable_from = now()", "lifecycle_state = 'invalid'",
      "lifecycle_state = 'ready'", "boundary_kind = 'invalid', billable_from = now()",
      "lifecycle_state = 'ready', billable_from = now(), boundary_kind = 'created'",
    ]) await expect(client.unsafe(`UPDATE public.hosted_text_billing_state SET ${update}`)).rejects.toMatchObject({ code: "23514" });
    await db.update(hostedTextBillingState).set({ lifecycleState: "ready", billableFrom: new Date("2026-10-23T01:02:03Z"),
      boundaryKind: "created", meterItemId: "si_a" }).where(eq(hostedTextBillingState.tenantSlug, "tenant-a"));
    await expect(client.unsafe("DELETE FROM public.tenants WHERE slug = 'tenant-a'")).rejects.toMatchObject({ code: "23503" });
    await expectGuardedRollback();
  });

  it.each(["customer_id", "subscription_id", "boundary_event_id", "meter_item_id", "meter_operation_id"])(
    "rejects another tenant reusing %s", async (column) => {
      await executeUp();
      await client.unsafe(`INSERT INTO public.hosted_text_billing_state
        (tenant_slug, customer_id, subscription_id, boundary_event_id, meter_item_id, meter_operation_id)
        VALUES ('tenant-a', 'cus_a', 'sub_a', 'event_a', 'si_a', 'operation_a')`);
      const [row] = await client.unsafe("SELECT * FROM public.hosted_text_billing_state");
      const other = { tenant_slug: "tenant-b", customer_id: "cus_b", subscription_id: "sub_b",
        boundary_event_id: "event_b", meter_item_id: "si_b", meter_operation_id: "operation_b", [column]: row[column] };
      await expect(client`INSERT INTO public.hosted_text_billing_state ${client(other)}`).rejects.toMatchObject({ code: "23505" });
    },
  );

  it("enforces tenant keys and excludes another tenant in scoped reads and writes", async () => {
    await executeUp();
    const db = drizzle(client);
    await db.insert(hostedTextBillingState).values([state(), state("tenant-b")]);
    await expect(db.insert(hostedTextBillingState).values({ ...state(), customerId: "other", subscriptionId: "other" })).rejects.toThrow();
    await expect(db.insert(hostedTextBillingState).values(state("unknown"))).rejects.toThrow();
    expect(await db.select().from(hostedTextBillingState).where(and(eq(hostedTextBillingState.tenantSlug, "tenant-a"),
      eq(hostedTextBillingState.customerId, "cus_tenant-b")))).toEqual([]);
    expect(await db.update(hostedTextBillingState).set({ lifecycleState: "stopped" }).where(and(
      eq(hostedTextBillingState.tenantSlug, "tenant-a"), eq(hostedTextBillingState.customerId, "cus_tenant-b"))).returning()).toEqual([]);
    const [other] = await db.select().from(hostedTextBillingState).where(eq(hostedTextBillingState.tenantSlug, "tenant-b"));
    expect(other.lifecycleState).toBe("unresolved");
    await db.insert(smsUsageReports).values(pending());
    expect(await db.select().from(smsUsageReports).where(and(eq(smsUsageReports.tenantSlug, "tenant-b"),
      eq(smsUsageReports.meterEventIdentifier, "evt_a")))).toEqual([]);
    expect(await db.update(smsUsageReports).set({ reportStatus: "uncertain" }).where(and(eq(smsUsageReports.tenantSlug, "tenant-b"),
      eq(smsUsageReports.meterEventIdentifier, "evt_a"))).returning()).toEqual([]);
  });

  it.each(["customerId", "subscriptionId", "meterEventIdentifier", "meterEventTimestamp", "firstAttemptAt"] as const)(
    "requires frozen %s on pending and uncertain reports", async (field) => {
      await executeUp();
      for (const reportStatus of ["pending", "uncertain"] as const) {
        await expect(drizzle(client).insert(smsUsageReports).values({ ...pending(), [field]: null, reportStatus })).rejects.toThrow();
      }
    },
  );

  it("checks status, reported time, nonnegative facts, and the retained tenant/date unique key", async () => {
    await executeUp();
    const db = drizzle(client);
    for (const change of [{ quantity: -1 }, { meterEventTimestamp: -1 }, { reportedAt: new Date() },
      { reportStatus: "submitted" as const }, { reportStatus: "invalid" as "pending" }]) {
      await expect(db.insert(smsUsageReports).values({ ...pending(), ...change })).rejects.toThrow();
    }
    await db.insert(smsUsageReports).values({ ...pending(), quantity: 0, meterEventTimestamp: 0 });
    await expect(db.insert(smsUsageReports).values(pending())).rejects.toThrow();
  });

  // SQL trigger/function ownership is tested here because Drizzle metadata omits it.
  it.each([
    "id = gen_random_uuid()", "tenant_slug = 'tenant-b'", "usage_date = '2026-10-24'", "quantity = 8",
    "meter_event_identifier = 'changed'", "customer_id = 'changed'", "subscription_id = 'changed'",
    "meter_event_timestamp = 1792713601", "first_attempt_at = first_attempt_at + interval '1 second'",
    "customer_id = NULL",
  ])("freezes pending and uncertain dispatch facts: %s", async (change) => {
    await executeUp();
    await drizzle(client).insert(smsUsageReports).values(pending());
    await expect(client.unsafe(`UPDATE public.sms_usage_reports SET ${change} WHERE report_status = 'pending'`))
      .rejects.toMatchObject({ code: "23514" });
    await client.unsafe("UPDATE public.sms_usage_reports SET report_status = 'uncertain' WHERE report_status = 'pending'");
    await expect(client.unsafe(`UPDATE public.sms_usage_reports SET ${change} WHERE report_status = 'uncertain'`))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("allows pending to uncertain to submitted and freezes every submitted column", async () => {
    await executeUp();
    const db = drizzle(client);
    await db.insert(smsUsageReports).values(pending());
    const facts = await client.unsafe("SELECT * FROM public.sms_usage_reports WHERE report_status = 'pending'");
    await client.unsafe("UPDATE public.sms_usage_reports SET report_status = 'uncertain' WHERE report_status = 'pending'");
    await expectGuardedRollback();
    await client.unsafe("UPDATE public.sms_usage_reports SET report_status = 'submitted', reported_at = now() WHERE report_status = 'uncertain'");
    const [submitted] = await client.unsafe("SELECT * FROM public.sms_usage_reports WHERE usage_date = '2026-10-23'");
    expect({ ...submitted, report_status: "pending", reported_at: null }).toEqual(facts[0]);
    for (const change of ["reported_at = reported_at + interval '1 second'", "report_status = 'pending', reported_at = NULL",
      "quantity = 99", "meter_event_identifier = NULL", "customer_id = NULL"]) {
      await expect(client.unsafe(`UPDATE public.sms_usage_reports SET ${change} WHERE usage_date = '2026-10-23'`)).rejects.toMatchObject({ code: "23514" });
    }
    await client.unsafe("UPDATE public.sms_usage_reports SET quantity = quantity");
    await expect(client.unsafe("UPDATE public.sms_usage_reports SET customer_id = 'backfill' WHERE usage_date = '2026-10-21'"))
      .rejects.toMatchObject({ code: "23514" });
    const [functionInfo] = await client.unsafe(`SELECT prosecdef, proconfig FROM pg_proc
      WHERE oid = 'public.hosted_text_preserve_report_facts()'::regprocedure`);
    expect(functionInfo).toEqual({ prosecdef: false, proconfig: ["search_path=pg_catalog"] });
    await expectGuardedRollback();
  });

  it.each(["unresolved", "free", "activating", "ready", "uncertain", "stopped"] as const)(
    "refuses rollback with any %s lifecycle row and preserves every object", async (lifecycleState) => {
      await executeUp();
      await drizzle(client).insert(hostedTextBillingState).values({ ...state(), lifecycleState,
        ...(lifecycleState === "ready" ? { billableFrom: new Date(), boundaryKind: "resumed" as const, meterItemId: "si_a" } : {}) });
      await expectGuardedRollback();
      expect(await client.unsafe("SELECT * FROM public.hosted_text_billing_state")).toHaveLength(1);
    },
  );

  it.each(["pending", "uncertain", "submitted"] as const)(
    "refuses rollback for %s dispatch facts without partial destructive drops", async (reportStatus) => {
      await executeUp();
      await drizzle(client).insert(smsUsageReports).values({ ...pending(), reportStatus,
        reportedAt: reportStatus === "submitted" ? new Date() : null });
      const before = await client.unsafe("SELECT * FROM public.sms_usage_reports ORDER BY tenant_slug, usage_date");
      await expectGuardedRollback();
      expect(await client.unsafe("SELECT * FROM public.sms_usage_reports ORDER BY tenant_slug, usage_date")).toEqual(before);
    },
  );

  it.each(["customer_id", "subscription_id", "meter_event_timestamp", "first_attempt_at"])(
    "refuses rollback even for a submitted row containing only new %s facts", async (column) => {
      await executeUp();
      const value = column === "meter_event_timestamp" ? "0" : column === "first_attempt_at" ? "now()" : "'fact'";
      await client.unsafe(`INSERT INTO public.sms_usage_reports (tenant_slug, usage_date, quantity, ${column})
        VALUES ('tenant-a', '2026-10-23', 0, ${value})`);
      await expectGuardedRollback();
    },
  );
});
