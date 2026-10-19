import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  assertBillingSwitchTestDatabase,
  resolveBillingSwitchTestDatabaseConfig,
} from "./billing-switch-test-database";

const fakeSendEmail = vi.hoisted(() => vi.fn());
const stripeState = vi.hoisted(() => ({
  customers: [] as Array<Record<string, unknown>>,
  subscriptions: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ method: string; id?: string; params?: Record<string, unknown> }>,
  nextId: 0,
  failPayout: false,
  hideCustomerSearchSlug: null as string | null,
}));
const fakeStripe = vi.hoisted(() => {
  const lookupIds: Record<string, string> = {
    hosted_base_monthly: "price_base",
    hosted_extra_staff_monthly: "price_extra",
    hosted_text_line_monthly: "price_line",
    hosted_texts_metered: "price_texts",
  };
  const getCustomer = (id: string) => {
    const customer = stripeState.customers.find((candidate) => candidate.id === id);
    if (!customer) throw new Error("unknown fake customer");
    return customer;
  };
  const getSubscription = (id: string) => {
    const subscription = stripeState.subscriptions.find((candidate) => candidate.id === id);
    if (!subscription) throw new Error("unknown fake subscription");
    return subscription;
  };
  return {
    customers: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        const metadata = params.metadata as Record<string, string>;
        const customer = {
          id: `cus_fake_${++stripeState.nextId}`,
          email: null,
          metadata,
          invoice_settings: { default_payment_method: null },
          default_source: null,
        };
        stripeState.customers.push(customer);
        stripeState.calls.push({ method: "customers.create", params });
        return structuredClone(customer);
      }),
      search: vi.fn(async (params: { query: string }) => {
        const slug = params.query.match(/tenantSlug']:'([^']+)'/)?.[1];
        const data = stripeState.hideCustomerSearchSlug === slug
          ? []
          : stripeState.customers.filter((candidate) => {
              const metadata = candidate.metadata as Record<string, string>;
              return metadata.tenantSlug === slug && metadata.purpose === "uptempo_hosted_plan";
            });
        return { data: structuredClone(data), has_more: false };
      }),
      list: vi.fn(async () => {
        stripeState.calls.push({ method: "customers.list" });
        return { data: structuredClone(stripeState.customers), has_more: false };
      }),
      retrieve: vi.fn(async (id: string) => structuredClone(getCustomer(id))),
      update: vi.fn(async (id: string, params: Record<string, unknown>) => {
        const customer = getCustomer(id);
        Object.assign(customer, params);
        stripeState.calls.push({ method: "customers.update", id, params });
        return structuredClone(customer);
      }),
      retrieveSource: vi.fn(async () => ({})),
    },
    prices: {
      list: vi.fn(async (params: { lookup_keys: string[] }) => ({
        data: params.lookup_keys.map((lookup_key) => ({
          id: lookupIds[lookup_key],
          lookup_key,
        })),
      })),
    },
    subscriptions: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        const items = (params.items as Array<Record<string, unknown>>).map((item) => {
          const priceId = String(item.price);
          return {
            id: `si_fake_${++stripeState.nextId}`,
            quantity: item.quantity,
            price: {
              id: priceId,
              lookup_key: Object.entries(lookupIds).find(([, id]) => id === priceId)?.[0],
            },
          };
        });
        const subscription = {
          ...params,
          id: `sub_fake_${++stripeState.nextId}`,
          customer: String(params.customer),
          status: params.trial_period_days ? "trialing" : "active",
          metadata: params.metadata,
          default_payment_method: null,
          default_source: null,
          items: { data: items, has_more: false },
        };
        stripeState.subscriptions.push(subscription);
        stripeState.calls.push({ method: "subscriptions.create", params });
        return structuredClone(subscription);
      }),
      list: vi.fn(async (params: { customer: string }) => ({
        data: structuredClone(stripeState.subscriptions.filter((candidate) => candidate.customer === params.customer)),
        has_more: false,
      })),
      retrieve: vi.fn(async (id: string) => structuredClone(getSubscription(id))),
      update: vi.fn(async (id: string, params: Record<string, unknown>) => {
        const subscription = getSubscription(id);
        Object.assign(subscription, params);
        stripeState.calls.push({ method: "subscriptions.update", id, params });
        return structuredClone(subscription);
      }),
      resume: vi.fn(async (id: string) => {
        const subscription = getSubscription(id);
        subscription.status = "active";
        stripeState.calls.push({ method: "subscriptions.resume", id });
        return structuredClone(subscription);
      }),
    },
    subscriptionItems: {
      list: vi.fn(async (params: { subscription: string }) => ({
        data: structuredClone((getSubscription(params.subscription).items as { data: unknown[] }).data),
        has_more: false,
      })),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const subscription = getSubscription(String(params.subscription));
        const priceId = String(params.price);
        const item = {
          id: `si_fake_${++stripeState.nextId}`,
          quantity: params.quantity,
          price: {
            id: priceId,
            lookup_key: Object.entries(lookupIds).find(([, id]) => id === priceId)?.[0],
          },
        };
        (subscription.items as { data: Array<Record<string, unknown>> }).data.push(item);
        stripeState.calls.push({ method: "subscriptionItems.create", params });
        return structuredClone(item);
      }),
      update: vi.fn(async (id: string, params: Record<string, unknown>) => {
        const item = stripeState.subscriptions
          .flatMap((candidate) => (candidate.items as { data: Array<Record<string, unknown>> }).data)
          .find((candidate) => candidate.id === id);
        if (!item) throw new Error("unknown fake subscription item");
        Object.assign(item, params);
        stripeState.calls.push({ method: "subscriptionItems.update", id, params });
        return structuredClone(item);
      }),
      del: vi.fn(async (id: string, params: Record<string, unknown>) => {
        for (const subscription of stripeState.subscriptions) {
          const items = subscription.items as { data: Array<Record<string, unknown>> };
          items.data = items.data.filter((item) => item.id !== id);
        }
        stripeState.calls.push({ method: "subscriptionItems.del", id, params });
        return {};
      }),
    },
    paymentMethods: { retrieve: vi.fn(async () => ({})) },
    accounts: {
      update: vi.fn(async (id: string, params: Record<string, unknown>) => {
        stripeState.calls.push({ method: "accounts.update", id, params });
        if (stripeState.failPayout) throw new Error("fake payout provider failure");
        return { id };
      }),
    },
  };
});
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail: fakeSendEmail,
}));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => fakeStripe }));

import {
  closeBillingDatabase,
  getBillingNoticeRows,
  runDueBillingSwitches,
  sendBillingNotice,
  switchTenant,
} from "./switch";
import { publicDb } from "@/lib/db";
import { memberships, tenants, user, type SmsLineStatus } from "@/lib/db/schema";

const databaseConfig = resolveBillingSwitchTestDatabaseConfig(process.env);
const databaseUrl = databaseConfig.enabled ? databaseConfig.databaseUrl : undefined;
const itDb = databaseUrl ? it : it.skip;

type FakeEmail = {
  to: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
};

describe.skipIf(!databaseUrl)("billing notice delivery (db)", () => {
  let scratchTenant: typeof import("@/lib/scheduling/db-fixtures").scratchTenant;
  let withTenantDb: typeof import("@/lib/db/tenant").withTenantDb;
  const fixtures: Array<{ slug: string; drop: () => Promise<void> }> = [];
  const userIds: string[] = [];
  let paySlug = "";
  let failure: string | null = null;
  let clockTime: Date | null = null;
  let advanceByMs = 0;
  let emails: FakeEmail[] = [];

  async function verifyTestDatabaseOwnership() {
    if (!databaseConfig.enabled) {
      throw new Error("Billing switch database opt-in was not enabled");
    }
    const sql = postgres(databaseConfig.databaseUrl, { max: 1 });
    try {
      await assertBillingSwitchTestDatabase(sql, databaseConfig);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async function makeSwitchBusiness(
    tag: string,
    options: {
      owner?: boolean;
      adminOnly?: boolean;
      comped?: number;
      status?: string;
      smsLineStatus?: SmsLineStatus;
      smsEnabledKey?: string;
      connectAccountId?: string | null;
      providers?: number;
      dueAt?: Date | null;
    } = {},
  ) {
    const fixture = await scratchTenant(tag);
    fixtures.push(fixture);
    const slug = fixture.slug;
    const dueAt = options.dueAt ?? null;
    const sentAt = dueAt
      ? new Date(dueAt.getTime() - 60 * 24 * 60 * 60 * 1000)
      : null;
    await publicDb
      .update(tenants)
      .set({
        name: options.owner ? "Willow & Coast" : `Switch ${tag}`,
        status: options.status ?? "active",
        comped: options.comped ?? 0,
        processingRateBps: 320,
        billingNoticeSentAt: sentAt,
        billingSwitchAt: dueAt,
        billingNoticePayloadHash: sentAt ? "a".repeat(64) : null,
        billingSwitchedAt: null,
        stripeSubscriptionId: null,
        platformStripeCustomerId: null,
        stripeConnectAccountId: options.connectAccountId ?? null,
        smsLineStatus: options.smsLineStatus ?? "shared",
      })
      .where(eq(tenants.slug, slug));

    const addAccountUser = async (role: "owner" | "admin", email: string) => {
      const id = `switch-${tag}-${role}`;
      userIds.push(id);
      await publicDb.insert(user).values({
        id,
        name: role === "owner" ? "Business Owner" : "Business Admin",
        email,
        role,
        tenantSlug: slug,
      });
      await publicDb.insert(memberships).values({ userId: id, tenantSlug: slug, role });
    };
    if (options.owner) await addAccountUser("owner", `${tag}-owner@example.test`);
    if (options.adminOnly) await addAccountUser("admin", `${tag}-admin@example.test`);

    await withTenantDb(slug, async (db, tables) => {
      const providerCount = options.providers ?? 1;
      if (providerCount > 0) {
        await db.insert(tables.staff).values(
          Array.from({ length: providerCount }, (_, index) => ({
            displayName: `Switch Provider ${index + 1}`,
            role: "provider",
            isActive: 1,
          })),
        );
      }
      await db.insert(tables.businessSettings).values({
        smsRemindersEnabled: options.smsEnabledKey === "smsRemindersEnabled" ? 1 : 0,
        smsConfirmationEnabled: options.smsEnabledKey === "smsConfirmationEnabled" ? 1 : 0,
        smsAftercareEnabled: options.smsEnabledKey === "smsAftercareEnabled" ? 1 : 0,
        smsFormRequestsEnabled: options.smsEnabledKey === "smsFormRequestsEnabled" ? 1 : 0,
        smsIntakeRequestsEnabled: options.smsEnabledKey === "smsIntakeRequestsEnabled" ? 1 : 0,
      });
    });
    return slug;
  }

  function resetFakeStripe() {
    stripeState.customers.length = 0;
    stripeState.subscriptions.length = 0;
    stripeState.calls.length = 0;
    stripeState.failPayout = false;
    stripeState.hideCustomerSearchSlug = null;
  }

  function addMembershipStripeSubscription(
    id: string,
    tenantSlug: string,
    status: string,
    purpose = "beauty_bank_membership",
  ) {
    stripeState.subscriptions.push({
      id,
      customer: `cus_${id}`,
      status,
      metadata: { tenantSlug, purpose },
      items: { data: [], has_more: false },
    });
  }

  function runNoticeCli(args: string[]) {
    try {
      const stdout = execFileSync(
        resolve(process.cwd(), "node_modules/.bin/tsx"),
        [resolve(process.cwd(), "scripts/billing/send-billing-notices.ts"), ...args],
        { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 60_000 },
      );
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const failure = error as {
        status?: number | null;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      return {
        status: failure.status ?? -1,
        stdout: String(failure.stdout ?? ""),
        stderr: String(failure.stderr ?? ""),
      };
    }
  }

  async function setPayingTenant(patch: {
    billingNoticeSentAt: Date | null;
    billingSwitchAt: Date | null;
    billingNoticePayloadHash: string | null;
    billingSwitchedAt: Date | null;
  }) {
    await publicDb
      .update(tenants)
      .set(patch)
      .where(eq(tenants.slug, paySlug));
  }

  async function readPayingTenant() {
    const [row] = await publicDb
      .select({
        billingNoticeSentAt: tenants.billingNoticeSentAt,
        billingSwitchAt: tenants.billingSwitchAt,
        billingNoticePayloadHash: tenants.billingNoticePayloadHash,
        stripeSubscriptionId: tenants.stripeSubscriptionId,
      })
      .from(tenants)
      .where(eq(tenants.slug, paySlug));
    return row;
  }

  beforeAll(async () => {
    await verifyTestDatabaseOwnership();
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("VERCEL_ENV", "development");
    ({ scratchTenant } = await import("@/lib/scheduling/db-fixtures"));
    ({ withTenantDb } = await import("@/lib/db/tenant"));

    const makeBusiness = async (tag: string) => {
      const fixture = await scratchTenant(tag);
      fixtures.push(fixture);
      return fixture;
    };

    const paying = await makeBusiness("noticepay");
    const comped = await makeBusiness("noticecomp");
    const switched = await makeBusiness("noticesw");
    const inactive = await makeBusiness("noticeinactive");
    const needsAttention = await makeBusiness("noticeownerless");
    paySlug = paying.slug;

    await publicDb
      .update(tenants)
      .set({
        name: "Notice Paying Studio",
        status: "active",
        comped: 0,
        billingSwitchedAt: null,
        billingNoticeSentAt: null,
        billingSwitchAt: null,
        billingNoticePayloadHash: null,
        stripeSubscriptionId: "sub_notice_existing",
        smsLineStatus: "shared",
      })
      .where(eq(tenants.slug, paying.slug));
    await publicDb
      .update(tenants)
      .set({ comped: 1, billingSwitchedAt: null, status: "active" })
      .where(eq(tenants.slug, comped.slug));
    await publicDb
      .update(tenants)
      .set({
        comped: 0,
        billingSwitchedAt: new Date("2026-09-01T00:00:00.000Z"),
        status: "active",
      })
      .where(eq(tenants.slug, switched.slug));
    await publicDb
      .update(tenants)
      .set({ comped: 0, billingSwitchedAt: null, status: "suspended" })
      .where(eq(tenants.slug, inactive.slug));
    await publicDb
      .update(tenants)
      .set({ comped: 0, billingSwitchedAt: null, status: "active" })
      .where(eq(tenants.slug, needsAttention.slug));

    const membershipsToCreate: Array<{
      userId: string;
      tenantSlug: string;
      role: string;
    }> = [];
    const usersToCreate: Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      tenantSlug: string;
    }> = [];
    const addMember = (
      tenantSlug: string,
      id: string,
      email: string,
      role: "owner" | "admin",
    ) => {
      userIds.push(id);
      usersToCreate.push({
        id,
        name: role === "owner" ? "Business Owner" : "Business Admin",
        email,
        role,
        tenantSlug,
      });
      membershipsToCreate.push({ userId: id, tenantSlug, role });
    };
    addMember(paying.slug, "notice-owner", "owner@notice.example", "owner");
    addMember(paying.slug, "notice-dupe-admin", "OWNER@NOTICE.example", "admin");
    addMember(paying.slug, "notice-admin", "admin@notice.example", "admin");
    addMember(comped.slug, "notice-comp-owner", "comp@notice.example", "owner");
    addMember(switched.slug, "notice-sw-owner", "switched@notice.example", "owner");
    addMember(inactive.slug, "notice-inactive-owner", "inactive@notice.example", "owner");
    addMember(needsAttention.slug, "notice-only-admin", "only-admin@notice.example", "admin");
    await publicDb.insert(user).values(usersToCreate);
    await publicDb.insert(memberships).values(membershipsToCreate);

    await withTenantDb(paying.slug, async (db, tables) => {
      await db.insert(tables.staff).values([
        { displayName: "A Stylist", role: "provider", isActive: 1 },
        { displayName: "B Stylist", role: "provider", isActive: 1 },
      ]);
      await db.insert(tables.businessSettings).values({ smsConfirmationEnabled: 1 });
      await db.insert(tables.smsMessages).values({
        toPhone: "+15555550123",
        body: "A billing fixture text",
        messageSid: "SM_notice_fixture",
        status: "delivered",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
    });

    emails = [];
    failure = null;
    clockTime = null;
    advanceByMs = 0;
    fakeSendEmail.mockImplementation(async (input: FakeEmail) => {
      emails.push(input);
      if (failure) return { success: false, error: failure };
      if (advanceByMs > 0 && clockTime) {
        clockTime = new Date(clockTime.getTime() + advanceByMs);
        advanceByMs = 0;
      }
      return { success: true, id: `fake-email-${emails.length}` };
    });
  }, 120_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    try {
      await verifyTestDatabaseOwnership();
      try {
        if (userIds.length > 0) {
          await publicDb.delete(memberships).where(inArray(memberships.userId, userIds));
          await publicDb.delete(user).where(inArray(user.id, userIds));
        }
      } catch {
        // Continue schema cleanup even after a failed row cleanup.
      }
      for (const fixture of [...fixtures].reverse()) await fixture.drop();
    } finally {
      vi.unstubAllEnvs();
      await closeBillingDatabase();
    }
  }, 120_000);

  itDb("dry-runs five businesses, retains provider-failure intent, serializes retries, and sends only once", async () => {
    const rows = await getBillingNoticeRows();
    expect(rows).toHaveLength(5);
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    expect(bySlug.get(paySlug)).toMatchObject({
      classification: "paying",
      currentRateLabel: "5%",
      activeProviders: 2,
      textsObserved: 1,
      textLineBillable: true,
      estimatedMonthlyCents: 2205,
      hasExistingHostedSubscription: true,
      recipientCount: 2,
    });
    expect(
      rows.map((row) => row.classification).sort(),
    ).toEqual(["comped", "inactive", "needs_attention", "paying", "switched"]);
    expect(bySlug.get(fixtures[1].slug)?.currentRateLabel).toBe("no charge");
    expect(bySlug.get(fixtures[1].slug)?.estimatedMonthlyCents).toBe(0);
    expect(bySlug.get(fixtures[4].slug)?.recipientCount).toBe(1);

    const dryRun = runNoticeCli([]);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout.split("\n").find((line) => line.startsWith("["))!)).toHaveLength(5);
    expect(dryRun.stdout).toContain("not fixed invoices");

    const mismatch = runNoticeCli(["--send", "--confirm", "0", "--allow-console"]);
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain("Confirmation mismatch");
    expect(mismatch.stdout).not.toContain("[Email Dev] Would send email");
    expect(fakeSendEmail).not.toHaveBeenCalled();

    const sent = runNoticeCli(["--send", "--confirm", "1", "--allow-console"]);
    expect(sent.status, `${sent.stderr}\n${sent.stdout}`).toBe(0);
    expect(sent.stdout.match(/\[Email Dev\] Would send email/g)).toHaveLength(1);
    expect(sent.stdout).toContain("Completed: 1 sent, 0 skipped, 0 failed.");
    const firstSuccess = await readPayingTenant();
    expect(firstSuccess.billingNoticeSentAt).toBeInstanceOf(Date);
    expect(firstSuccess.billingNoticePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(firstSuccess.billingSwitchAt).toBeInstanceOf(Date);

    const subscriptionId = firstSuccess.stripeSubscriptionId;

    await setPayingTenant({
      billingNoticeSentAt: null,
      billingSwitchAt: null,
      billingNoticePayloadHash: null,
      billingSwitchedAt: null,
    });
    fakeSendEmail.mockClear();

    failure = "temporary test provider failure";
    await expect(
      sendBillingNotice(paySlug, { allowConsoleForLocalTest: true }),
    ).rejects.toThrow(/failed/);
    const intentAfterFailure = await readPayingTenant();
    expect(intentAfterFailure.billingNoticeSentAt).toBeNull();
    expect(intentAfterFailure.billingNoticePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(intentAfterFailure.billingSwitchAt).toBeInstanceOf(Date);
    const firstIdempotencyKey = emails.at(-1)?.idempotencyKey;
    expect(firstIdempotencyKey).toContain(intentAfterFailure.billingNoticePayloadHash);

    failure = null;
    let releaseSend: (() => void) | undefined;
    fakeSendEmail.mockImplementationOnce(async (input: FakeEmail) => {
      emails.push(input);
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      return { success: true, id: "fake-retry-success" };
    });
    const firstConcurrentSend = sendBillingNotice(paySlug, {
      allowConsoleForLocalTest: true,
    });
    await vi.waitFor(() => expect(fakeSendEmail).toHaveBeenCalledTimes(2));
    const secondConcurrentSend = sendBillingNotice(paySlug, {
      allowConsoleForLocalTest: true,
    });
    releaseSend?.();
    const concurrentResults = await Promise.all([
      firstConcurrentSend,
      secondConcurrentSend,
    ]);
    expect(concurrentResults.map((result) => result.status).sort()).toEqual([
      "already_sent",
      "sent",
    ]);
    expect(fakeSendEmail).toHaveBeenCalledTimes(2);
    const directIntent = await readPayingTenant();
    expect(directIntent.billingNoticeSentAt).toBeInstanceOf(Date);
    expect(emails[1].idempotencyKey).toBe(firstIdempotencyKey);
    expect(emails[1].idempotencyKey).toContain(directIntent.billingNoticePayloadHash);
    expect(emails[1].to).toBe("owner@notice.example");
    expect(emails[1].bcc).toEqual(["admin@notice.example"]);

    const secondRun = runNoticeCli(["--send", "--confirm", "0", "--allow-console"]);
    expect(secondRun.status).toBe(0);
    expect(secondRun.stdout).toContain("Completed: 0 sent, 0 skipped, 0 failed.");
    expect(secondRun.stdout).not.toContain("[Email Dev] Would send email");
    expect(fakeSendEmail).toHaveBeenCalledTimes(2);
    const afterRepeat = await readPayingTenant();
    expect(afterRepeat.billingNoticeSentAt).toBeInstanceOf(Date);
    expect(afterRepeat.billingNoticeSentAt).toEqual(directIntent.billingNoticeSentAt);
    expect(afterRepeat.billingSwitchAt).toEqual(directIntent.billingSwitchAt);
    expect(afterRepeat.billingNoticePayloadHash).toBe(
      directIntent.billingNoticePayloadHash,
    );
    expect(afterRepeat.stripeSubscriptionId).toBe(subscriptionId);
  }, 120_000);

  itDb("reserves the emailed date across 14:00 UTC, reuses an unchanged same-day intent, and fails closed after usage-period drift", async () => {
    await setPayingTenant({
      billingNoticeSentAt: null,
      billingSwitchAt: null,
      billingNoticePayloadHash: null,
      billingSwitchedAt: null,
    });
    const start = new Date("2026-10-16T13:59:50.000Z");
    clockTime = start;
    advanceByMs = 20_000;
    const result = await sendBillingNotice(paySlug, {
      allowConsoleForLocalTest: true,
      clock: () => clockTime!,
    });
    expect(result.status).toBe("sent");
    if (result.status !== "sent") return;
    expect(emails.at(-1)?.subject).toBe(
      "Your Uptempo price changes on December 16, 2026",
    );
    expect(emails.at(-1)?.html).toContain("December 16, 2026");
    expect(result.billingSwitchAt.toISOString()).toBe("2026-12-16T14:00:00.000Z");
    expect(result.noticeSentAt.toISOString()).toBe("2026-10-16T14:00:10.000Z");
    expect(result.billingSwitchAt.getTime()).toBeGreaterThanOrEqual(
      result.noticeSentAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );

    const reservedSwitchAt = result.billingSwitchAt;
    await setPayingTenant({
      billingNoticeSentAt: null,
      billingSwitchAt: reservedSwitchAt,
      billingNoticePayloadHash: null,
      billingSwitchedAt: null,
    });
    const earliestFirstRequest = new Date(
      reservedSwitchAt.getTime() -
        60 * 24 * 60 * 60 * 1000 -
        24 * 60 * 60 * 1000 -
        19_000,
    );
    clockTime = earliestFirstRequest;
    advanceByMs = 0;
    failure = "ambiguous fake provider response";
    const beforeFailureCount = emails.length;
    await expect(
      sendBillingNotice(paySlug, {
        allowConsoleForLocalTest: true,
        clock: () => clockTime!,
      }),
    ).rejects.toThrow(/failed/);
    const failedIntent = await readPayingTenant();
    expect(failedIntent.billingNoticeSentAt).toBeNull();
    expect(failedIntent.billingNoticePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    const retryKey = emails[beforeFailureCount].idempotencyKey;
    expect(retryKey).toContain(failedIntent.billingNoticePayloadHash);

    failure = null;
    clockTime = new Date("2026-10-16T23:59:00.000Z");
    advanceByMs = 0;
    const retryResult = await sendBillingNotice(paySlug, {
      allowConsoleForLocalTest: true,
      clock: () => clockTime!,
    });
    expect(retryResult.status).toBe("sent");
    if (retryResult.status !== "sent") return;
    expect(emails.at(-1)?.idempotencyKey).toBe(retryKey);
    expect(emails.at(-1)?.subject).toContain("December 16, 2026");
    expect(retryResult.noticeSentAt.toISOString()).toBe("2026-10-16T23:59:00.000Z");
    expect(retryResult.billingSwitchAt).toEqual(reservedSwitchAt);
    expect(retryResult.billingSwitchAt.getTime()).toBeGreaterThanOrEqual(
      retryResult.noticeSentAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );

    await setPayingTenant({
      billingNoticeSentAt: null,
      billingSwitchAt: reservedSwitchAt,
      billingNoticePayloadHash: null,
      billingSwitchedAt: null,
    });
    clockTime = earliestFirstRequest;
    failure = "ambiguous fake provider response";
    const beforeDriftFailure = emails.length;
    await expect(
      sendBillingNotice(paySlug, {
        allowConsoleForLocalTest: true,
        clock: () => clockTime!,
      }),
    ).rejects.toThrow(/failed/);
    const driftIntent = await readPayingTenant();
    expect(driftIntent.billingNoticeSentAt).toBeNull();
    expect(driftIntent.billingNoticePayloadHash).toMatch(/^[a-f0-9]{64}$/);

    failure = null;
    clockTime = new Date(
      reservedSwitchAt.getTime() - 60 * 24 * 60 * 60 * 1000 - 41_000,
    );
    const providerCallsBeforeDriftRetry = emails.length;
    await expect(
      sendBillingNotice(paySlug, {
        allowConsoleForLocalTest: true,
        clock: () => clockTime!,
      }),
    ).rejects.toThrow(/manual review.*body changed/);
    expect(emails).toHaveLength(providerCallsBeforeDriftRetry);
    expect(emails).toHaveLength(beforeDriftFailure + 1);
    const afterDriftRetry = await readPayingTenant();
    expect(afterDriftRetry.billingNoticeSentAt).toBeNull();
    expect(afterDriftRetry.billingNoticePayloadHash).toBe(
      driftIntent.billingNoticePayloadHash,
    );
    expect(afterDriftRetry.billingSwitchAt).toEqual(reservedSwitchAt);
  }, 120_000);

  itDb("leaves delayed provider confirmation unmarked when it would shorten the 60-day notice", async () => {
    await setPayingTenant({
      billingNoticeSentAt: null,
      billingSwitchAt: null,
      billingNoticePayloadHash: null,
      billingSwitchedAt: null,
    });
    failure = null;
    // A 20s request budget reserves Dec 15 at 14:00; a 31s confirmation
    // crosses that slot by one second, so the emailed date is no longer safe.
    clockTime = new Date("2026-10-16T13:59:30.000Z");
    advanceByMs = 31_000;
    const providerCallsBefore = emails.length;

    await expect(
      sendBillingNotice(paySlug, {
        allowConsoleForLocalTest: true,
        clock: () => clockTime!,
      }),
    ).rejects.toThrow(/manual review.*less than 60 full days/);

    expect(emails).toHaveLength(providerCallsBefore + 1);
    const afterDelayedConfirmation = await readPayingTenant();
    expect(afterDelayedConfirmation.billingNoticePayloadHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(afterDelayedConfirmation.billingSwitchAt?.toISOString()).toBe(
      "2026-12-15T14:00:00.000Z",
    );
    expect(afterDelayedConfirmation.billingNoticeSentAt).toBeNull();
    expect(afterDelayedConfirmation.stripeSubscriptionId).toBe(
      "sub_notice_existing",
    );
    expect(clockTime?.toISOString()).toBe("2026-10-16T14:00:01.000Z");
    expect(
      afterDelayedConfirmation.billingSwitchAt!.getTime(),
    ).toBeLessThan(
      clockTime!.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  }, 120_000);

  itDb("sends day-zero notice, waits through day 59, and switches once at the 60-day boundary", async () => {
    resetFakeStripe();
    failure = null;
    clockTime = null;
    advanceByMs = 0;
    emails = [];
    fakeSendEmail.mockClear();

    const day0 = new Date("2032-01-01T13:30:00.000Z");
    const switchSlug = await makeSwitchBusiness("switchmain", {
      owner: true,
      smsLineStatus: "shared",
      smsEnabledKey: "smsAftercareEnabled",
      connectAccountId: "acct_switch_main",
      providers: 2,
    });
    const [owner] = await publicDb
      .select({ email: user.email })
      .from(user)
      .where(eq(user.tenantSlug, switchSlug));
    expect(owner?.email).toBe("switchmain-owner@example.test");

    const sent = await sendBillingNotice(switchSlug, {
      now: day0,
      allowConsoleForLocalTest: true,
    });
    expect(sent.status).toBe("sent");
    if (sent.status !== "sent") return;
    expect(sent.noticeSentAt).toEqual(day0);
    expect(sent.billingSwitchAt.toISOString()).toBe("2032-03-01T14:00:00.000Z");

    const day59 = new Date(sent.billingSwitchAt.getTime() - 1);
    await expect(switchTenant(switchSlug, day59)).resolves.toMatchObject({
      slug: switchSlug,
      outcome: "skipped",
      reason: "not_due",
    });
    expect(stripeState.calls).toHaveLength(0);

    const switchAllOffSlug = await makeSwitchBusiness("switchalloff", {
      owner: true,
      dueAt: sent.billingSwitchAt,
      smsLineStatus: "shared",
      providers: 1,
    });
    const switchCompedSlug = await makeSwitchBusiness("switchcomped", {
      owner: true,
      comped: 1,
      dueAt: sent.billingSwitchAt,
    });
    const switchInactiveSlug = await makeSwitchBusiness("switchinactive", {
      owner: true,
      status: "suspended",
      dueAt: sent.billingSwitchAt,
    });
    const switchOwnerlessSlug = await makeSwitchBusiness("switchownerless", {
      adminOnly: true,
      dueAt: sent.billingSwitchAt,
    });

    addMembershipStripeSubscription("bb_active", switchSlug, "active");
    addMembershipStripeSubscription("bb_trial", switchSlug, "trialing");
    addMembershipStripeSubscription("bb_canceled", switchSlug, "canceled");
    await withTenantDb(switchSlug, async (db, tables) => {
      const clients = await db
        .insert(tables.clients)
        .values([
          { name: "Member A" },
          { name: "Member B" },
          { name: "Member C" },
          { name: "Member D" },
        ])
        .returning({ id: tables.clients.id });
      const [plan] = await db
        .insert(tables.membershipPlans)
        .values({ name: "Beauty Bank", monthlyAmountCents: 2500 })
        .returning({ id: tables.membershipPlans.id });
      await db.insert(tables.clientMemberships).values([
        { clientId: clients[0]!.id, planId: plan!.id, stripeSubscriptionId: "bb_active", status: "active" },
        { clientId: clients[1]!.id, planId: plan!.id, stripeSubscriptionId: "bb_active", status: "active" },
        { clientId: clients[2]!.id, planId: plan!.id, stripeSubscriptionId: "bb_trial", status: "active" },
        { clientId: clients[3]!.id, planId: plan!.id, stripeSubscriptionId: "bb_canceled", status: "active" },
      ]);
    });

    const results = await Promise.all([
      switchTenant(switchSlug, sent.billingSwitchAt),
      switchTenant(switchSlug, sent.billingSwitchAt),
    ]);
    expect(results.filter((result) => result.outcome === "switched")).toHaveLength(1);
    expect(results.filter((result) => "reason" in result && result.reason === "already_switched")).toHaveLength(1);

    const [mainTenant] = await publicDb
      .select({
        processingRateBps: tenants.processingRateBps,
        billableStaff: tenants.billableStaff,
        smsLineStatus: tenants.smsLineStatus,
        billingSwitchedAt: tenants.billingSwitchedAt,
      })
      .from(tenants)
      .where(eq(tenants.slug, switchSlug));
    expect(mainTenant).toMatchObject({
      processingRateBps: null,
      billableStaff: 2,
      smsLineStatus: "shared",
      billingSwitchedAt: sent.billingSwitchAt,
    });

    const hosted = stripeState.subscriptions.find((candidate) => {
      const metadata = candidate.metadata as Record<string, string>;
      return metadata.tenantSlug === switchSlug && metadata.purpose === "uptempo_hosted_plan";
    });
    expect(hosted).toBeDefined();
    expect(hosted).toMatchObject({
      collection_method: "send_invoice",
      days_until_due: 14,
      status: "active",
    });
    expect(hosted).not.toHaveProperty("trial_period_days");
    const hostedItems = (hosted!.items as { data: Array<{ quantity?: number; price: { lookup_key: string } }> }).data;
    expect(hostedItems.map((item) => item.price.lookup_key).sort()).toEqual([
      "hosted_base_monthly",
      "hosted_extra_staff_monthly",
      "hosted_text_line_monthly",
      "hosted_texts_metered",
    ]);
    expect(hostedItems.find((item) => item.price.lookup_key === "hosted_extra_staff_monthly")?.quantity).toBe(1);
    expect(stripeState.customers[0]?.email).toBe("switchmain-owner@example.test");
    expect(stripeState.calls.find((call) => call.method === "accounts.update")?.params).toEqual({
      settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "monday" } } },
    });
    expect(fakeStripe.subscriptions.retrieve.mock.calls.filter(([id]) => id === "bb_active")).toHaveLength(1);
    expect(stripeState.calls.filter((call) =>
      call.method === "subscriptions.update" &&
      call.params?.application_fee_percent === 5,
    )).toHaveLength(2);
    expect(stripeState.calls.filter((call) => call.id === "bb_active" && call.method === "subscriptions.update")[0]?.params).toEqual({
      application_fee_percent: 5,
      proration_behavior: "none",
    });
    expect(stripeState.calls.filter((call) => call.id === "bb_canceled" && call.method === "subscriptions.update")).toHaveLength(0);

    const afterSuccessCalls = stripeState.calls.length;
    await expect(switchTenant(switchSlug, sent.billingSwitchAt)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "already_switched",
    });
    expect(stripeState.calls).toHaveLength(afterSuccessCalls);

    await expect(switchTenant(switchCompedSlug, sent.billingSwitchAt)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "comped",
    });
    await expect(switchTenant(switchInactiveSlug, sent.billingSwitchAt)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "inactive",
    });
    const providerCallsBeforeOwnerless = stripeState.calls.length;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(switchTenant(switchOwnerlessSlug, sent.billingSwitchAt)).rejects.toMatchObject({ code: "owner_missing" });
    } finally {
      errorSpy.mockRestore();
    }
    expect(stripeState.calls).toHaveLength(providerCallsBeforeOwnerless);

    const [ownerless] = await publicDb
      .select({ billingSwitchedAt: tenants.billingSwitchedAt })
      .from(tenants)
      .where(eq(tenants.slug, switchOwnerlessSlug));
    expect(ownerless?.billingSwitchedAt).toBeNull();
    await publicDb
      .update(tenants)
      .set({ billingNoticeSentAt: null, billingSwitchAt: null })
      .where(eq(tenants.slug, switchOwnerlessSlug));

    await expect(switchTenant(switchAllOffSlug, sent.billingSwitchAt)).resolves.toMatchObject({ outcome: "switched" });
    const [allOffTenant] = await publicDb
      .select({ smsLineStatus: tenants.smsLineStatus })
      .from(tenants)
      .where(eq(tenants.slug, switchAllOffSlug));
    expect(allOffTenant?.smsLineStatus).toBe("off");
    const allOffHosted = stripeState.subscriptions.find((candidate) => {
      const metadata = candidate.metadata as Record<string, string>;
      return metadata.tenantSlug === switchAllOffSlug && metadata.purpose === "uptempo_hosted_plan";
    });
    const allOffItems = (allOffHosted!.items as { data: Array<{ price: { lookup_key: string } }> }).data;
    expect(allOffItems.map((item) => item.price.lookup_key)).not.toContain("hosted_text_line_monthly");
    expect(allOffItems.map((item) => item.price.lookup_key)).not.toContain("hosted_texts_metered");
  }, 120_000);

  itDb("rolls back database state after accepted Stripe creation and recovers the same IDs after a 25-hour retry", async () => {
    resetFakeStripe();
    const dueAt = new Date("2033-01-01T14:00:00.000Z");
    const slug = await makeSwitchBusiness("switchrecover", {
      owner: true,
      dueAt,
      connectAccountId: "acct_switch_recovery",
      smsEnabledKey: "smsRemindersEnabled",
      providers: 1,
    });
    stripeState.failPayout = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(switchTenant(slug, dueAt)).rejects.toThrow(/fake payout provider failure/);
    } finally {
      errorSpy.mockRestore();
    }
    const [rolledBack] = await publicDb
      .select({
        processingRateBps: tenants.processingRateBps,
        stripeSubscriptionId: tenants.stripeSubscriptionId,
        platformStripeCustomerId: tenants.platformStripeCustomerId,
        billingSwitchedAt: tenants.billingSwitchedAt,
      })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    expect(rolledBack).toMatchObject({
      processingRateBps: 320,
      stripeSubscriptionId: null,
      platformStripeCustomerId: null,
      billingSwitchedAt: null,
    });
    const acceptedCustomerId = String(stripeState.customers[0]?.id);
    const acceptedSubscription = stripeState.subscriptions.find((candidate) => {
      const metadata = candidate.metadata as Record<string, string>;
      return metadata.tenantSlug === slug && metadata.purpose === "uptempo_hosted_plan";
    });
    expect(acceptedSubscription).toBeDefined();
    const acceptedSubscriptionId = String(acceptedSubscription?.id);
    const acceptedItemCount = (acceptedSubscription!.items as { data: unknown[] }).data.length;
    expect(stripeState.calls.filter((call) => call.method === "customers.create")).toHaveLength(1);
    expect(stripeState.calls.filter((call) => call.method === "subscriptions.create")).toHaveLength(1);
    expect(stripeState.calls.filter((call) => call.method === "customers.list")).toHaveLength(1);

    stripeState.failPayout = false;
    stripeState.hideCustomerSearchSlug = slug;
    const retryAt = new Date(dueAt.getTime() + 25 * 60 * 60 * 1000);
    await expect(switchTenant(slug, retryAt)).resolves.toMatchObject({ outcome: "switched" });
    const [completed] = await publicDb
      .select({
        platformStripeCustomerId: tenants.platformStripeCustomerId,
        stripeSubscriptionId: tenants.stripeSubscriptionId,
        billingSwitchedAt: tenants.billingSwitchedAt,
      })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    expect(completed).toMatchObject({
      platformStripeCustomerId: acceptedCustomerId,
      stripeSubscriptionId: acceptedSubscriptionId,
      billingSwitchedAt: retryAt,
    });
    expect(stripeState.calls.filter((call) => call.method === "customers.create")).toHaveLength(1);
    expect(stripeState.calls.filter((call) => call.method === "subscriptions.create")).toHaveLength(1);
    expect((acceptedSubscription!.items as { data: unknown[] }).data).toHaveLength(acceptedItemCount);
    expect(stripeState.calls.filter((call) => call.method === "customers.list")).toHaveLength(2);
  }, 120_000);

  itDb("continues the daily runner after one tenant's membership ownership mismatch", async () => {
    resetFakeStripe();
    const dueAt = new Date("2034-01-01T14:00:00.000Z");
    const failedSlug = await makeSwitchBusiness("switchbadmember", { owner: true, dueAt });
    const goodSlug = await makeSwitchBusiness("switchjobgood", { owner: true, dueAt });
    await withTenantDb(failedSlug, async (db, tables) => {
      const [client] = await db.insert(tables.clients).values({ name: "Membership Client" }).returning({ id: tables.clients.id });
      const [plan] = await db.insert(tables.membershipPlans).values({ name: "Membership", monthlyAmountCents: 1200 }).returning({ id: tables.membershipPlans.id });
      await db.insert(tables.clientMemberships).values({
        clientId: client!.id,
        planId: plan!.id,
        stripeSubscriptionId: "bb_wrong_owner",
        status: "active",
      });
    });
    addMembershipStripeSubscription("bb_wrong_owner", goodSlug, "active");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let result;
    try {
      result = await runDueBillingSwitches(dueAt);
    } finally {
      errorSpy.mockRestore();
    }
    expect(result?.failures).toBe(1);
    expect(result?.results.find((entry) => entry.slug === failedSlug)).toMatchObject({
      outcome: "failed",
      diagnostic: "switch_failed",
    });
    expect(result?.results.find((entry) => entry.slug === goodSlug)).toMatchObject({ outcome: "switched" });
    const [failedTenant] = await publicDb
      .select({ billingSwitchedAt: tenants.billingSwitchedAt, processingRateBps: tenants.processingRateBps })
      .from(tenants)
      .where(eq(tenants.slug, failedSlug));
    expect(failedTenant).toMatchObject({ billingSwitchedAt: null, processingRateBps: 320 });
    const [goodTenant] = await publicDb
      .select({ billingSwitchedAt: tenants.billingSwitchedAt })
      .from(tenants)
      .where(eq(tenants.slug, goodSlug));
    expect(goodTenant?.billingSwitchedAt).toEqual(dueAt);
  }, 120_000);
});
