import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { createHash } from "node:crypto";
import { render } from "@react-email/render";
import { BillingChangeNotice } from "@/emails/billing-change-notice";
import { hostedMonthlyCents } from "@/lib/billing/hosted-pricing";
import { countBillableStaff } from "@/lib/billing/billable-staff";
import { ensureHostedSubscription, type BillingDatabaseContext } from "@/lib/billing/subscriptions";
import {
  processingFeePercent,
  processingRateBps,
  processingRateLabel,
} from "@/lib/billing/processing-fee";
import { isSingleMode } from "@/lib/config/mode";
import { getEmailT } from "@/lib/terms/email";
import { closePublicDb, publicDb } from "@/lib/db";
import { closeShardClients } from "@/lib/db/shards";
import { withTenantDb } from "@/lib/db/tenant";
import { memberships, tenants, user } from "@/lib/db/schema";
import { getEmailProvider } from "@/lib/providers/email";
import { buildFromAddress, sendEmail } from "@/lib/email/send";
import { setWeeklyPayouts } from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTICE_DAYS = 60;
const PROVIDER_REQUEST_BUDGET_MS = 20_000;
const RESEND_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const OWNER_ADMIN_ROLES = ["owner", "admin"] as const;
const SMS_SETTING_KEYS = [
  "smsRemindersEnabled",
  "smsConfirmationEnabled",
  "smsAftercareEnabled",
  "smsFormRequestsEnabled",
  "smsIntakeRequestsEnabled",
] as const;
const PLACEHOLDER_RESEND_KEYS = new Set([
  "re_placeholder",
  "test",
  "your-resend-api-key",
]);

export type BillingClass =
  | "comped"
  | "switched"
  | "inactive"
  | "needs_attention"
  | "paying";

export type BillingNoticeTenant = {
  comped: number | null;
  billingSwitchedAt: Date | null;
  status: string | null;
  ownerEmail: string | null;
};

export function classifyTenant(tenant: BillingNoticeTenant): BillingClass {
  if (tenant.comped === 1) return "comped";
  if (tenant.billingSwitchedAt != null) return "switched";
  if (tenant.status !== "active") return "inactive";
  if (!isUsableEmail(tenant.ownerEmail)) return "needs_attention";
  return "paying";
}

/** First 14:00 UTC at or after 60 complete days from the notice timestamp. */
export function plannedBillingSwitchAt(sentAt: Date): Date {
  const threshold = new Date(sentAt.getTime() + NOTICE_DAYS * DAY_MS);
  const planned = new Date(
    Date.UTC(
      threshold.getUTCFullYear(),
      threshold.getUTCMonth(),
      threshold.getUTCDate(),
      14,
      0,
      0,
      0,
    ),
  );
  if (planned.getTime() < threshold.getTime()) {
    planned.setUTCDate(planned.getUTCDate() + 1);
  }
  return planned;
}

export function formatBillingSwitchDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export type BillingNoticeRow = {
  slug: string;
  name: string;
  classification: BillingClass;
  currentRateLabel: string;
  activeProviders: number;
  textsObserved: number;
  textPeriodStart: string;
  textPeriodEndExclusive: string;
  textLineBillable: boolean;
  estimatedMonthlyCents: number;
  plannedSwitchAt: Date | null;
  noticeSentAt: Date | null;
  hasExistingHostedSubscription: boolean;
  recipientCount: number;
};

type RecipientSet = {
  ownerEmails: string[];
  adminEmails: string[];
  allEmails: string[];
};

type UsageSnapshot = {
  activeProviders: number;
  textsObserved: number;
  textPeriodStart: Date;
  textPeriodEndExclusive: Date;
  smsSettingsEnabled: boolean;
};

function isUsableEmail(value: string | null | undefined): value is string {
  return Boolean(
    value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
  );
}

function cleanEmails(values: Array<string | null | undefined>): string[] {
  const byAddress = new Map<string, string>();
  for (const value of values) {
    if (!isUsableEmail(value)) continue;
    const trimmed = value.trim();
    const normalized = trimmed.toLocaleLowerCase("en-US");
    if (!byAddress.has(normalized)) byAddress.set(normalized, trimmed);
  }
  return [...byAddress.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, display]) => display);
}

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function textLineIsBillable(
  smsLineStatus: string | null,
  smsSettingsEnabled: boolean,
): boolean {
  return (
    smsLineStatus === "active" ||
    (smsLineStatus === "shared" && smsSettingsEnabled)
  );
}

export type BillingSwitchEligibility = {
  comped: number | null;
  status: string | null;
  billingNoticeSentAt: Date | null;
  billingSwitchAt: Date | null;
  billingSwitchedAt: Date | null;
};

/** Requires a delivered notice and 60 complete days before any mutation. */
export function isBillingSwitchDue(
  tenant: BillingSwitchEligibility,
  now: Date,
): boolean {
  return (
    tenant.status === "active" &&
    tenant.comped === 0 &&
    tenant.billingSwitchedAt == null &&
    tenant.billingNoticeSentAt != null &&
    tenant.billingSwitchAt != null &&
    tenant.billingSwitchAt.getTime() <= now.getTime() &&
    tenant.billingNoticeSentAt.getTime() + NOTICE_DAYS * DAY_MS <=
      now.getTime()
  );
}

function addProviderRequestBudget(date: Date): Date {
  return new Date(date.getTime() + PROVIDER_REQUEST_BUDGET_MS);
}

export function billingNoticeRetryDeadline(switchAt: Date): Date {
  const latestPossibleFirstRequest =
    switchAt.getTime() - NOTICE_DAYS * DAY_MS - PROVIDER_REQUEST_BUDGET_MS;
  const earliestPossibleFirstRequest =
    latestPossibleFirstRequest - RESEND_IDEMPOTENCY_RETENTION_MS;
  const latestRetryCompletion =
    earliestPossibleFirstRequest + RESEND_IDEMPOTENCY_RETENTION_MS;
  return new Date(
    latestRetryCompletion - PROVIDER_REQUEST_BUDGET_MS,
  );
}

export function isBillingNoticeRetryWithinProviderWindow(
  switchAt: Date,
  requestStartedAt: Date,
): boolean {
  return (
    requestStartedAt.getTime() < billingNoticeRetryDeadline(switchAt).getTime()
  );
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateIsAtLeast(left: Date | null, right: Date): boolean {
  return left != null && left.getTime() >= right.getTime();
}

async function loadRecipientSets(
  slugs: string[],
  db: BillingDatabaseContext = publicDb,
): Promise<Map<string, RecipientSet>> {
  const result = new Map<string, RecipientSet>();
  if (slugs.length === 0) return result;

  const membershipsForBilling = await db
    .select({
      tenantSlug: memberships.tenantSlug,
      role: memberships.role,
      email: user.email,
    })
    .from(memberships)
    .innerJoin(user, eq(memberships.userId, user.id))
    .where(
      and(
        inArray(memberships.tenantSlug, slugs),
        inArray(memberships.role, [...OWNER_ADMIN_ROLES]),
      ),
    );

  const membershipBuckets = new Map<
    string,
    { owners: string[]; admins: string[] }
  >();
  for (const { tenantSlug, role, email } of membershipsForBilling) {
    const bucket = membershipBuckets.get(tenantSlug) ?? {
      owners: [],
      admins: [],
    };
    if (role === "owner") bucket.owners.push(email);
    if (role === "admin") bucket.admins.push(email);
    membershipBuckets.set(tenantSlug, bucket);
  }

  for (const slug of slugs) {
    const memberBucket = membershipBuckets.get(slug) ?? {
      owners: [],
      admins: [],
    };
    let ownerEmails = cleanEmails(memberBucket.owners);
    let adminEmails = cleanEmails(memberBucket.admins);

    // Older accounts used user.tenant_slug and user.role before memberships
    // became authoritative. Only consult that relation when the corresponding
    // membership role has no usable address.
    if (ownerEmails.length === 0 || adminEmails.length === 0) {
      const legacyUsers = await db
        .select({ role: user.role, email: user.email })
        .from(user)
        .where(
          and(
            eq(user.tenantSlug, slug),
            inArray(user.role, [...OWNER_ADMIN_ROLES]),
          ),
        );
      if (ownerEmails.length === 0) {
        ownerEmails = cleanEmails(
          legacyUsers.filter((person) => person.role === "owner").map((person) => person.email),
        );
      }
      if (adminEmails.length === 0) {
        adminEmails = cleanEmails(
          legacyUsers.filter((person) => person.role === "admin").map((person) => person.email),
        );
      }
    }

    const owners = cleanEmails(ownerEmails);
    const ownerKeys = new Set(owners.map((email) => email.toLocaleLowerCase("en-US")));
    const admins = cleanEmails(adminEmails).filter(
      (email) => !ownerKeys.has(email.toLocaleLowerCase("en-US")),
    );
    result.set(slug, {
      ownerEmails: owners,
      adminEmails: admins,
      allEmails: [...owners, ...admins],
    });
  }
  return result;
}

async function loadUsageSnapshot(slug: string, now: Date): Promise<UsageSnapshot> {
  const textPeriodEndExclusive = utcDayStart(now);
  const textPeriodStart = new Date(
    textPeriodEndExclusive.getTime() - 30 * DAY_MS,
  );

  return withTenantDb(slug, async (db, { staff, businessSettings, smsMessages }) => {
    const [[staffRow], [settings], [usageRow]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(staff)
        .where(and(eq(staff.role, "provider"), eq(staff.isActive, 1))),
      db
        .select({
          smsRemindersEnabled: businessSettings.smsRemindersEnabled,
          smsConfirmationEnabled: businessSettings.smsConfirmationEnabled,
          smsAftercareEnabled: businessSettings.smsAftercareEnabled,
          smsFormRequestsEnabled: businessSettings.smsFormRequestsEnabled,
          smsIntakeRequestsEnabled: businessSettings.smsIntakeRequestsEnabled,
        })
        .from(businessSettings)
        .limit(1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(smsMessages)
        .where(
          and(
            isNotNull(smsMessages.messageSid),
            ne(smsMessages.status, "failed"),
            gte(smsMessages.createdAt, textPeriodStart),
            lt(smsMessages.createdAt, textPeriodEndExclusive),
          ),
        ),
    ]);

    const textSettingEnabled = SMS_SETTING_KEYS.some(
      (key) => settings?.[key] === 1,
    );
    return {
      activeProviders: staffRow?.count ?? 0,
      textsObserved: usageRow?.count ?? 0,
      textPeriodStart,
      textPeriodEndExclusive,
      smsSettingsEnabled: textSettingEnabled,
    };
  });
}

export async function getBillingNoticeRows(
  now: Date = new Date(),
): Promise<BillingNoticeRow[]> {
  if (isSingleMode()) {
    throw new Error("Hosted billing notices are unavailable in single mode.");
  }

  const tenantRows = await publicDb
    .select({
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      comped: tenants.comped,
      processingRateBps: tenants.processingRateBps,
      smsLineStatus: tenants.smsLineStatus,
      billingNoticeSentAt: tenants.billingNoticeSentAt,
      billingSwitchAt: tenants.billingSwitchAt,
      billingSwitchedAt: tenants.billingSwitchedAt,
      stripeSubscriptionId: tenants.stripeSubscriptionId,
    })
    .from(tenants)
    .orderBy(asc(tenants.slug));
  const recipientSets = await loadRecipientSets(
    tenantRows.map((tenant) => tenant.slug),
  );
  const earliestForNewNotice = plannedBillingSwitchAt(
    addProviderRequestBudget(now),
  );
  const result: BillingNoticeRow[] = [];

  // Keep tenant-schema reads sequential so a large account list does not open
  // an unbounded number of shard queries at once.
  for (const tenant of tenantRows) {
    const recipients = recipientSets.get(tenant.slug) ?? {
      ownerEmails: [],
      adminEmails: [],
      allEmails: [],
    };
    const classification = classifyTenant({
      comped: tenant.comped,
      billingSwitchedAt: tenant.billingSwitchedAt,
      status: tenant.status,
      ownerEmail: recipients.ownerEmails[0] ?? null,
    });
    const usage = await loadUsageSnapshot(tenant.slug, now);
    const textLineBillable = textLineIsBillable(
      tenant.smsLineStatus,
      usage.smsSettingsEnabled,
    );
    const currentBps = processingRateBps({
      comped: tenant.comped,
      processingRateBps: tenant.processingRateBps,
    });
    const plannedAt =
      classification === "paying"
        ? tenant.billingNoticeSentAt && tenant.billingSwitchAt
          ? tenant.billingSwitchAt
          : dateIsAtLeast(tenant.billingSwitchAt, earliestForNewNotice)
            ? tenant.billingSwitchAt
            : earliestForNewNotice
        : null;

    result.push({
      slug: tenant.slug,
      name: tenant.name,
      classification,
      currentRateLabel:
        tenant.comped === 1 ? "no charge" : processingRateLabel(currentBps),
      activeProviders: usage.activeProviders,
      textsObserved: usage.textsObserved,
      textPeriodStart: dateOnly(usage.textPeriodStart),
      textPeriodEndExclusive: dateOnly(usage.textPeriodEndExclusive),
      textLineBillable,
      estimatedMonthlyCents:
        tenant.comped === 1
          ? 0
          : hostedMonthlyCents({
              staff: usage.activeProviders,
              textLine: textLineBillable,
              texts: usage.textsObserved,
            }),
      plannedSwitchAt: plannedAt,
      noticeSentAt: tenant.billingNoticeSentAt,
      hasExistingHostedSubscription: tenant.stripeSubscriptionId != null,
      recipientCount: recipients.allEmails.length,
    });
  }
  return result;
}

export function countUnnotifiedPaying(rows: BillingNoticeRow[]): number {
  return rows.filter(
    (row) => row.classification === "paying" && row.noticeSentAt == null,
  ).length;
}

function isLoopbackDatabase(): boolean {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return false;
    const hostname = new URL(databaseUrl).hostname
      .toLocaleLowerCase("en-US")
      .replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function assertBillingNoticeProviderAllowed(
  allowConsoleForLocalTest = false,
): void {
  const provider = getEmailProvider();
  if (provider.id === "smtp") {
    throw new Error(
      "Billing notices require Resend idempotency; SMTP is unsupported for this send.",
    );
  }
  if (provider.id === "console") {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.VERCEL_ENV === "production" ||
      !allowConsoleForLocalTest ||
      !isLoopbackDatabase()
    ) {
      throw new Error(
        "Console billing-notice sends require explicit local permission and a loopback database outside production.",
      );
    }
    return;
  }

  const key = process.env.RESEND_API_KEY?.trim().toLocaleLowerCase("en-US");
  if (!key || PLACEHOLDER_RESEND_KEYS.has(key)) {
    throw new Error("A non-placeholder Resend key is required for billing notices.");
  }
}

export type BillingNoticeSendResult =
  | { status: "sent"; slug: string; noticeSentAt: Date; billingSwitchAt: Date }
  | { status: "already_sent" | "skipped"; slug: string };

type SendOptions = {
  now?: Date;
  /** Injectable clock for deterministic database integration tests. */
  clock?: () => Date;
  allowConsoleForLocalTest?: boolean;
};

function sendClockNow(options: SendOptions): Date {
  if (options.clock) return new Date(options.clock());
  if (options.now) return new Date(options.now);
  return new Date();
}

async function reserveSwitchDate(slug: string, now: Date): Promise<
  | { status: "reserved"; switchAt: Date }
  | { status: "already_sent" | "skipped" }
> {
  return publicDb.transaction(async (tx) => {
    const [tenant] = await tx
      .select({
        status: tenants.status,
        comped: tenants.comped,
        billingNoticeSentAt: tenants.billingNoticeSentAt,
        billingSwitchAt: tenants.billingSwitchAt,
        billingNoticePayloadHash: tenants.billingNoticePayloadHash,
        billingSwitchedAt: tenants.billingSwitchedAt,
      })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .for("update");
    if (!tenant) return { status: "skipped" };
    if (tenant.billingNoticeSentAt) return { status: "already_sent" };

    const recipients = await loadRecipientSets([slug]);
    const ownerEmail = recipients.get(slug)?.ownerEmails[0] ?? null;
    if (
      classifyTenant({
        status: tenant.status,
        comped: tenant.comped,
        billingSwitchedAt: tenant.billingSwitchedAt,
        ownerEmail,
      }) !== "paying"
    ) {
      return { status: "skipped" };
    }

    const earliest = plannedBillingSwitchAt(addProviderRequestBudget(now));
    if (
      tenant.billingNoticePayloadHash &&
      tenant.billingSwitchAt &&
      tenant.billingSwitchAt.getTime() < earliest.getTime()
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: its reserved switch date no longer has enough provider-time margin.`,
      );
    }
    const switchAt = dateIsAtLeast(tenant.billingSwitchAt, earliest)
      ? tenant.billingSwitchAt!
      : earliest;
    if (
      !tenant.billingNoticePayloadHash &&
      tenant.billingSwitchAt?.getTime() !== switchAt.getTime()
    ) {
      await tx
        .update(tenants)
        .set({ billingSwitchAt: switchAt, updatedAt: now })
        .where(eq(tenants.slug, slug));
    }
    return { status: "reserved", switchAt };
  });
}

type PreparedNotice = {
  tenant: {
    slug: string;
    name: string;
    status: string | null;
    comped: number | null;
    processingRateBps: number | null;
    smsLineStatus: string | null;
    billingSwitchAt: Date | null;
    billingSwitchedAt: Date | null;
  };
  recipients: RecipientSet;
  subject: string;
  from: string;
  html: string;
  text: string;
  payloadHash: string;
  freshIntent: boolean;
};

async function prepareAndRecordNoticeIntent(
  slug: string,
  switchAt: Date,
  now: Date,
): Promise<PreparedNotice | { status: "already_sent" | "skipped" }> {
  return publicDb.transaction(async (tx) => {
    const [tenant] = await tx
      .select({
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        comped: tenants.comped,
        processingRateBps: tenants.processingRateBps,
        smsLineStatus: tenants.smsLineStatus,
        billingNoticeSentAt: tenants.billingNoticeSentAt,
        billingSwitchAt: tenants.billingSwitchAt,
        billingNoticePayloadHash: tenants.billingNoticePayloadHash,
        billingSwitchedAt: tenants.billingSwitchedAt,
      })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .for("update");
    if (!tenant) return { status: "skipped" };
    if (tenant.billingNoticeSentAt) return { status: "already_sent" };
    if (
      !tenant.billingSwitchAt ||
      tenant.billingSwitchAt.getTime() !== switchAt.getTime()
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: its reserved switch date changed.`,
      );
    }
    if (
      tenant.billingSwitchAt.getTime() <
      plannedBillingSwitchAt(addProviderRequestBudget(now)).getTime()
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: its reserved switch date no longer has enough provider-time margin.`,
      );
    }

    const recipientSet =
      (await loadRecipientSets([slug])).get(slug) ?? {
        ownerEmails: [],
        adminEmails: [],
        allEmails: [],
      };
    if (
      classifyTenant({
        status: tenant.status,
        comped: tenant.comped,
        billingSwitchedAt: tenant.billingSwitchedAt,
        ownerEmail: recipientSet.ownerEmails[0] ?? null,
      }) !== "paying" ||
      recipientSet.allEmails.length === 0
    ) {
      return { status: "skipped" };
    }

    const usage = await loadUsageSnapshot(slug, now);
    const textLineBillable = textLineIsBillable(
      tenant.smsLineStatus,
      usage.smsSettingsEnabled,
    );
    const estimatedMonthlyCents = hostedMonthlyCents({
      staff: usage.activeProviders,
      textLine: textLineBillable,
      texts: usage.textsObserved,
    });
    const dateLabel = formatBillingSwitchDate(tenant.billingSwitchAt);
    const t = await getEmailT(slug, "emails");
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(estimatedMonthlyCents / 100);
    const subject = t("billingChange.subject", { date: dateLabel });
    const message = BillingChangeNotice({
      t,
      businessName: tenant.name,
      date: dateLabel,
      currentRate: processingRateLabel(
        processingRateBps({
          comped: tenant.comped,
          processingRateBps: tenant.processingRateBps,
        }),
      ),
      amount,
      activeProviders: usage.activeProviders,
      textsObserved: usage.textsObserved,
      textPeriodStart: formatBillingSwitchDate(usage.textPeriodStart),
      textPeriodEnd: formatBillingSwitchDate(
        new Date(usage.textPeriodEndExclusive.getTime() - DAY_MS),
      ),
      hasTextLine: textLineBillable,
      usesSharedLine: tenant.smsLineStatus === "shared",
    });
    const html = await render(message);
    const text = await render(message, { plainText: true });
    const from = buildFromAddress();
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          slug,
          switchAt: tenant.billingSwitchAt.toISOString(),
          from,
          to: recipientSet.ownerEmails[0],
          bcc: [
            ...recipientSet.ownerEmails.slice(1),
            ...recipientSet.adminEmails,
          ],
          subject,
          html,
          text,
        }),
      )
      .digest("hex");

    const freshIntent = tenant.billingNoticePayloadHash == null;
    if (!freshIntent && tenant.billingNoticePayloadHash !== payloadHash) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: the reserved recipient list or email body changed after intent was recorded.`,
      );
    }
    if (freshIntent) {
      await tx
        .update(tenants)
        .set({ billingNoticePayloadHash: payloadHash, updatedAt: now })
        .where(eq(tenants.slug, slug));
    } else if (!isBillingNoticeRetryWithinProviderWindow(switchAt, now)) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: the provider idempotency retry window is no longer safe.`,
      );
    }

    return {
      tenant,
      recipients: recipientSet,
      subject,
      from,
      html,
      text,
      payloadHash,
      freshIntent,
    };
  });
}

export async function sendBillingNotice(
  slug: string,
  options: SendOptions = {},
): Promise<BillingNoticeSendResult> {
  if (isSingleMode()) {
    throw new Error("Hosted billing notices are unavailable in single mode.");
  }
  assertBillingNoticeProviderAllowed(options.allowConsoleForLocalTest);

  const reserveTime = sendClockNow(options);
  const reservation = await reserveSwitchDate(slug, reserveTime);
  if (reservation.status !== "reserved") {
    return { status: reservation.status, slug };
  }
  const prepared = await prepareAndRecordNoticeIntent(
    slug,
    reservation.switchAt,
    sendClockNow(options),
  );
  if ("status" in prepared) return { status: prepared.status, slug };

  return publicDb.transaction(async (tx) => {
    const [tenant] = await tx
      .select({
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        comped: tenants.comped,
        processingRateBps: tenants.processingRateBps,
        smsLineStatus: tenants.smsLineStatus,
        billingNoticeSentAt: tenants.billingNoticeSentAt,
        billingSwitchAt: tenants.billingSwitchAt,
        billingNoticePayloadHash: tenants.billingNoticePayloadHash,
        billingSwitchedAt: tenants.billingSwitchedAt,
      })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .for("update");
    if (!tenant) return { status: "skipped", slug };
    if (tenant.billingNoticeSentAt) return { status: "already_sent", slug };
    const recipients = await loadRecipientSets([slug]);
    const recipientSet = recipients.get(slug) ?? {
      ownerEmails: [],
      adminEmails: [],
      allEmails: [],
    };
    if (
      classifyTenant({
        status: tenant.status,
        comped: tenant.comped,
        billingSwitchedAt: tenant.billingSwitchedAt,
        ownerEmail: recipientSet.ownerEmails[0] ?? null,
      }) !== "paying" ||
      recipientSet.allEmails.length === 0
    ) {
      return { status: "skipped", slug };
    }
    const currentRecipients = recipientSet.allEmails;
    if (
      tenant.name !== prepared.tenant.name ||
      tenant.comped !== prepared.tenant.comped ||
      tenant.processingRateBps !== prepared.tenant.processingRateBps ||
      tenant.smsLineStatus !== prepared.tenant.smsLineStatus ||
      tenant.billingSwitchedAt?.getTime() !==
        prepared.tenant.billingSwitchedAt?.getTime() ||
      JSON.stringify(currentRecipients) !==
        JSON.stringify(prepared.recipients.allEmails)
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: business or recipient details changed after intent was recorded.`,
      );
    }
    if (buildFromAddress() !== prepared.from) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: the sender address changed after intent was recorded.`,
      );
    }
    if (
      tenant.billingSwitchAt?.getTime() !== prepared.tenant.billingSwitchAt?.getTime() ||
      tenant.billingNoticePayloadHash !== prepared.payloadHash
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: its persisted intent changed before send.`,
      );
    }
    const dispatchTime = sendClockNow(options);
    if (
      prepared.tenant.billingSwitchAt!.getTime() <
      plannedBillingSwitchAt(addProviderRequestBudget(dispatchTime)).getTime()
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: its switch date is too close to the provider request deadline.`,
      );
    }
    if (
      !prepared.freshIntent &&
      !isBillingNoticeRetryWithinProviderWindow(
        reservation.switchAt,
        dispatchTime,
      )
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: the provider idempotency retry window is no longer safe.`,
      );
    }

    // One visible owner address, with all other owners/admins hidden. The key
    // is derived from the immutable payload intent, never from a new body.
    const idempotencyKey = `billing-notice:${slug}:${prepared.payloadHash}`;
    const delivery = await sendEmail({
      to: prepared.recipients.ownerEmails[0],
      bcc: [
        ...prepared.recipients.ownerEmails.slice(1),
        ...prepared.recipients.adminEmails,
      ],
      subject: prepared.subject,
      html: prepared.html,
      text: prepared.text,
      idempotencyKey,
    });
    if (!delivery.success) {
      throw new Error(
        `Billing notice to ${slug} failed: ${delivery.error ?? "provider did not confirm delivery"}`,
      );
    }

    const noticeSentAt = sendClockNow(options);
    if (
      prepared.tenant.billingSwitchAt!.getTime() <
      noticeSentAt.getTime() + NOTICE_DAYS * DAY_MS
    ) {
      throw new Error(
        `Billing notice for ${slug} needs manual review: provider confirmation left less than 60 full days before the reserved switch date.`,
      );
    }
    await tx
      .update(tenants)
      .set({
        billingNoticeSentAt: noticeSentAt,
        updatedAt: noticeSentAt,
      })
      .where(eq(tenants.slug, slug));
    return {
      status: "sent",
      slug,
      noticeSentAt,
      billingSwitchAt: prepared.tenant.billingSwitchAt!,
    };
  });
}

export type BillingSwitchFailureCode = "owner_missing" | "switch_failed";

export class BillingSwitchError extends Error {
  constructor(readonly code: BillingSwitchFailureCode) {
    super(code === "owner_missing"
      ? "The billing owner address is unavailable."
      : "The hosted billing switch failed.");
    this.name = "BillingSwitchError";
  }
}

export type BillingSwitchTenantResult =
  | { slug: string; outcome: "switched" }
  | {
      slug: string;
      outcome: "skipped";
      reason:
        | "single_mode"
        | "not_found"
        | "comped"
        | "inactive"
        | "already_switched"
        | "not_due";
    }
  | {
      slug: string;
      outcome: "failed";
      diagnostic: BillingSwitchFailureCode;
    };

export type BillingSwitchRunResult = {
  skipped?: "single_mode";
  results: BillingSwitchTenantResult[];
  failures: number;
};

async function loadSmsSettingsEnabled(slug: string): Promise<boolean> {
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [settings] = await db
      .select({
        smsRemindersEnabled: businessSettings.smsRemindersEnabled,
        smsConfirmationEnabled: businessSettings.smsConfirmationEnabled,
        smsAftercareEnabled: businessSettings.smsAftercareEnabled,
        smsFormRequestsEnabled: businessSettings.smsFormRequestsEnabled,
        smsIntakeRequestsEnabled: businessSettings.smsIntakeRequestsEnabled,
      })
      .from(businessSettings)
      .limit(1);
    return SMS_SETTING_KEYS.some((key) => settings?.[key] === 1);
  });
}

async function updateActiveMembershipFees(
  slug: string,
  stripe: ReturnType<typeof getStripe>,
): Promise<void> {
  const subscriptionIds = await withTenantDb(
    slug,
    async (db, { clientMemberships }) => {
      const rows = await db
        .select({ stripeSubscriptionId: clientMemberships.stripeSubscriptionId })
        .from(clientMemberships)
        .where(
          and(
            eq(clientMemberships.status, "active"),
            isNotNull(clientMemberships.stripeSubscriptionId),
          ),
        );
      return [...new Set(
        rows
          .map((row) => row.stripeSubscriptionId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      )];
    },
  );

  for (const subscriptionId of subscriptionIds) {
    const subscription = await stripe.subscriptions.retrieve(
      subscriptionId,
      {},
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    if (
      subscription.metadata?.tenantSlug !== slug ||
      subscription.metadata?.purpose !== "beauty_bank_membership"
    ) {
      throw new Error("Client membership subscription ownership mismatch.");
    }
    if (subscription.status !== "active" && subscription.status !== "trialing") {
      continue;
    }
    await stripe.subscriptions.update(
      subscriptionId,
      {
        application_fee_percent: processingFeePercent({ comped: 0 }),
        proration_behavior: "none",
      },
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
  }
}

/** Apply the 6.5b cutover under one tenant-row lock and one public DB transaction. */
export async function switchTenant(
  slug: string,
  now: Date = new Date(),
): Promise<BillingSwitchTenantResult> {
  if (isSingleMode()) return { slug, outcome: "skipped", reason: "single_mode" };

  try {
    return await publicDb.transaction(async (tx) => {
      const [tenant] = await tx
        .select({
          slug: tenants.slug,
          status: tenants.status,
          comped: tenants.comped,
          processingRateBps: tenants.processingRateBps,
          smsLineStatus: tenants.smsLineStatus,
          stripeConnectAccountId: tenants.stripeConnectAccountId,
          billingNoticeSentAt: tenants.billingNoticeSentAt,
          billingSwitchAt: tenants.billingSwitchAt,
          billingSwitchedAt: tenants.billingSwitchedAt,
        })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .for("update");

      if (!tenant) return { slug, outcome: "skipped", reason: "not_found" };
      if (tenant.billingSwitchedAt != null) {
        return { slug, outcome: "skipped", reason: "already_switched" };
      }
      if (tenant.comped === 1) {
        return { slug, outcome: "skipped", reason: "comped" };
      }
      if (tenant.status !== "active") {
        return { slug, outcome: "skipped", reason: "inactive" };
      }
      if (!isBillingSwitchDue(tenant, now)) {
        return { slug, outcome: "skipped", reason: "not_due" };
      }

      const billingDb = tx as unknown as BillingDatabaseContext;
      const recipientSet = (await loadRecipientSets([slug], billingDb)).get(slug);
      const ownerEmail = recipientSet?.ownerEmails[0];
      if (!ownerEmail) throw new BillingSwitchError("owner_missing");

      const [billableStaff, smsSettingsEnabled] = await Promise.all([
        countBillableStaff(slug),
        loadSmsSettingsEnabled(slug),
      ]);
      const smsLineStatus =
        tenant.smsLineStatus === "shared" && !smsSettingsEnabled
          ? "off"
          : tenant.smsLineStatus;

      await tx
        .update(tenants)
        .set({
          processingRateBps: null,
          billableStaff,
          smsLineStatus,
          updatedAt: now,
        })
        .where(eq(tenants.slug, slug));

      const hosted = await ensureHostedSubscription(slug, {
        trialDays: 0,
        billingSwitch: true,
        ownerEmail,
        db: billingDb,
      });
      if (!("subscriptionId" in hosted)) {
        throw new Error(`Hosted subscription could not be switched (${hosted.skipped}).`);
      }

      if (tenant.stripeConnectAccountId) {
        await setWeeklyPayouts(tenant.stripeConnectAccountId);
      }

      await updateActiveMembershipFees(slug, getStripe());

      await tx
        .update(tenants)
        .set({ billingSwitchedAt: now, updatedAt: now })
        .where(eq(tenants.slug, slug));
      return { slug, outcome: "switched" };
    });
  } catch (error) {
    const code =
      error instanceof BillingSwitchError ? error.code : "switch_failed";
    console.error("[billing] automatic switch failed", slug, code);
    throw error;
  }
}

/** Process every due tenant independently so one provider failure cannot block others. */
export async function runDueBillingSwitches(
  now: Date = new Date(),
): Promise<BillingSwitchRunResult> {
  if (isSingleMode()) {
    return { skipped: "single_mode", results: [], failures: 0 };
  }

  const candidates = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(
      and(
        eq(tenants.comped, 0),
        isNull(tenants.billingSwitchedAt),
        isNotNull(tenants.billingNoticeSentAt),
        isNotNull(tenants.billingSwitchAt),
        lte(tenants.billingSwitchAt, now),
      ),
    )
    .orderBy(asc(tenants.slug));

  const results: BillingSwitchTenantResult[] = [];
  for (const { slug } of candidates) {
    try {
      results.push(await switchTenant(slug, now));
    } catch (error) {
      const diagnostic =
        error instanceof BillingSwitchError ? error.code : "switch_failed";
      console.error("[billing] automatic switch tenant result", slug, diagnostic);
      results.push({ slug, outcome: "failed", diagnostic });
    }
  }
  return {
    results,
    failures: results.filter((result) => result.outcome === "failed").length,
  };
}

export async function closeBillingDatabase(): Promise<void> {
  await closeShardClients();
  await closePublicDb();
}
