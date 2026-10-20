import crypto from "crypto";
import { z } from "zod";
import { and, desc, eq, gt, isNull, lt, lte, sql } from "drizzle-orm";
import { withTenantDb, type TenantTransaction } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { normalizePhone } from "@/lib/phone";

export const OTP_EXPIRY_SECONDS = 600; // 10 minutes
export const MAX_ATTEMPTS = 3;
export const REVIEW_OTP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const OTP_CODE_PATTERN = /^\d{6}$/;
const EMAIL_SCHEMA = z.string().email();

export type BookingIdentifier = {
  identifier: string;
  type: "email" | "phone";
};

/** Normalize and validate a booking identifier before routes apply budgets or touch data. */
export function normalizeBookingIdentifier(
  value: string,
): BookingIdentifier | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    const identifier = trimmed.toLowerCase();
    if (!EMAIL_SCHEMA.safeParse(identifier).success) return null;
    return { identifier, type: "email" };
  }

  if (!/^[+\d\s().-]+$/.test(trimmed)) return null;
  const identifier = normalizePhone(trimmed);
  if (!identifier) return null;
  return { identifier, type: "phone" };
}

/** Normalize an optional phone with the same input rules as a phone OTP identity. */
export function normalizeBookingPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[+\d\s().-]+$/.test(trimmed)) return null;
  return normalizePhone(trimmed);
}

export type ReviewOtpConfig =
  | { status: "absent"; email?: undefined }
  | { status: "invalid"; email?: string }
  | {
      status: "valid";
      email: string;
      tenantSlug: string;
      code: string;
      expiresAt: Date;
    };

function configuredReviewEmail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return EMAIL_SCHEMA.safeParse(normalized).success ? normalized : undefined;
}

/** Parse all four bounded review settings without exposing them in logs or responses. */
export function readReviewOtpConfig(now = new Date()): ReviewOtpConfig {
  const raw = {
    email: process.env.REVIEW_OTP_EMAIL,
    code: process.env.REVIEW_OTP_CODE,
    tenantSlug: process.env.REVIEW_OTP_TENANT_SLUG,
    expiresAt: process.env.REVIEW_OTP_EXPIRES_AT,
  };
  if (!Object.values(raw).some((value) => value !== undefined)) {
    return { status: "absent" };
  }

  const email = configuredReviewEmail(raw.email);
  const invalid = (): ReviewOtpConfig => ({ status: "invalid", email });
  if (
    !email ||
    !raw.code ||
    !OTP_CODE_PATTERN.test(raw.code) ||
    !raw.tenantSlug ||
    raw.tenantSlug.trim() !== raw.tenantSlug ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(raw.tenantSlug) ||
    !raw.expiresAt ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.expiresAt)
  ) {
    return invalid();
  }

  const expiresAt = new Date(raw.expiresAt);
  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.toISOString() !== raw.expiresAt ||
    expiresAt.getTime() <= now.getTime() ||
    expiresAt.getTime() > now.getTime() + REVIEW_OTP_MAX_AGE_MS
  ) {
    return invalid();
  }

  return {
    status: "valid",
    email,
    tenantSlug: raw.tenantSlug,
    code: raw.code,
    expiresAt,
  };
}

/** Generate a cryptographically secure six-digit OTP code. */
export function generateOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

async function lockVerificationIdentifier(
  tx: TenantTransaction,
  tenantSlug: string,
  identifier: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${tenantSlug}), hashtext(${identifier}))`,
  );
}

async function createVerificationForResolvedTenant(
  tenantSlug: string,
  identifier: string,
  type: "email" | "phone",
): Promise<string> {
  const normalized = normalizeBookingIdentifier(identifier);
  if (!normalized || normalized.type !== type) {
    throw new Error("Invalid booking verification identifier");
  }

  return withTenantDb(tenantSlug, async (db, { bookingVerifications }) =>
    db.transaction(async (tx) => {
      await lockVerificationIdentifier(tx, tenantSlug, normalized.identifier);
      await tx
        .delete(bookingVerifications)
        .where(eq(bookingVerifications.identifier, normalized.identifier));

      const code = generateOTP();
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);
      await tx.insert(bookingVerifications).values({
        identifier: normalized.identifier,
        type,
        code,
        attempts: 0,
        expiresAt,
      });
      return code;
    }),
  );
}

/** Create a verification record in the current tenant. */
export async function createVerification(
  identifier: string,
  type: "email" | "phone",
): Promise<string> {
  return createVerificationForResolvedTenant(await getTenantSlug(), identifier, type);
}

export async function createVerificationForTenant(
  tenantSlug: string,
  identifier: string,
  type: "email" | "phone",
): Promise<string> {
  return createVerificationForResolvedTenant(tenantSlug, identifier, type);
}

/** Create the configured review challenge only for an existing client in its tenant. */
export async function createReviewVerificationForTenant(
  tenantSlug: string,
  identifier: string,
): Promise<string | null> {
  const normalized = normalizeBookingIdentifier(identifier);
  if (!normalized || normalized.type !== "email") return null;

  const initialConfig = readReviewOtpConfig();
  if (
    initialConfig.status !== "valid" ||
    initialConfig.tenantSlug !== tenantSlug ||
    initialConfig.email !== normalized.identifier
  ) {
    return null;
  }

  return withTenantDb(tenantSlug, async (db, { bookingVerifications, clients }) =>
    db.transaction(async (tx) => {
      await lockVerificationIdentifier(tx, tenantSlug, normalized.identifier);

      // Recheck after waiting so an expired or changed setting cannot issue a new challenge.
      const config = readReviewOtpConfig();
      if (
        config.status !== "valid" ||
        config.tenantSlug !== tenantSlug ||
        config.email !== normalized.identifier
      ) {
        return null;
      }

      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(sql`lower(${clients.email})`, config.email),
            isNull(clients.deletedAt),
          ),
        )
        .limit(1);
      if (!client) return null;

      const now = new Date();
      const expiresAt = new Date(
        Math.min(
          now.getTime() + OTP_EXPIRY_SECONDS * 1000,
          config.expiresAt.getTime(),
        ),
      );
      await tx
        .delete(bookingVerifications)
        .where(eq(bookingVerifications.identifier, normalized.identifier));
      await tx.insert(bookingVerifications).values({
        identifier: normalized.identifier,
        type: "email",
        code: config.code,
        attempts: 0,
        expiresAt,
      });
      return config.code;
    }),
  );
}

/** Verify a code against a live persisted challenge, consuming success exactly once. */
export async function verifyCode(
  identifier: string,
  code: string,
): Promise<{ valid: true; type: string } | { valid: false }> {
  return verifyCodeForTenant(await getTenantSlug(), identifier, code);
}

export async function verifyCodeForTenant(
  tenantSlug: string,
  identifier: string,
  code: string,
): Promise<{ valid: true; type: string } | { valid: false }> {
  const normalized = normalizeBookingIdentifier(identifier);
  if (!normalized || !OTP_CODE_PATTERN.test(code)) return { valid: false };

  const initialConfig = readReviewOtpConfig();
  const isReviewIdentity = initialConfig.email === normalized.identifier;
  if (
    isReviewIdentity &&
    (initialConfig.status !== "valid" || initialConfig.tenantSlug !== tenantSlug)
  ) {
    return { valid: false };
  }

  return withTenantDb(tenantSlug, async (db, { bookingVerifications }) =>
    db.transaction(async (tx) => {
      await lockVerificationIdentifier(tx, tenantSlug, normalized.identifier);
      const now = new Date();
      const config = isReviewIdentity ? readReviewOtpConfig(now) : null;
      if (
        isReviewIdentity &&
        (!config ||
          config.status !== "valid" ||
          config.tenantSlug !== tenantSlug ||
          config.email !== normalized.identifier)
      ) {
        return { valid: false };
      }

      const predicates = [
        eq(bookingVerifications.identifier, normalized.identifier),
        eq(bookingVerifications.type, normalized.type),
        gt(bookingVerifications.expiresAt, now),
      ];
      if (config?.status === "valid") {
        predicates.push(
          eq(bookingVerifications.code, config.code),
          lte(bookingVerifications.expiresAt, config.expiresAt),
        );
      }

      const [record] = await tx
        .select()
        .from(bookingVerifications)
        .where(and(...predicates))
        .orderBy(desc(bookingVerifications.createdAt))
        .limit(1);
      if (!record || record.attempts >= MAX_ATTEMPTS) {
        return { valid: false };
      }

      if (record.code !== code) {
        await tx
          .update(bookingVerifications)
          .set({ attempts: sql`${bookingVerifications.attempts} + 1` })
          .where(
            and(
              eq(bookingVerifications.id, record.id),
              lt(bookingVerifications.attempts, MAX_ATTEMPTS),
              gt(bookingVerifications.expiresAt, now),
            ),
          )
          .returning({ id: bookingVerifications.id });
        return { valid: false };
      }

      // Consume matching live rows first, then remove any older duplicates for this identifier.
      const consumed = await tx
        .delete(bookingVerifications)
        .where(
          and(
            eq(bookingVerifications.identifier, normalized.identifier),
            eq(bookingVerifications.type, normalized.type),
            eq(bookingVerifications.code, code),
            lt(bookingVerifications.attempts, MAX_ATTEMPTS),
            gt(bookingVerifications.expiresAt, now),
            ...(config?.status === "valid"
              ? [lte(bookingVerifications.expiresAt, config.expiresAt)]
              : []),
          ),
        )
        .returning({ type: bookingVerifications.type });
      if (!consumed.some((row) => row.type === normalized.type)) {
        return { valid: false };
      }
      await tx
        .delete(bookingVerifications)
        .where(eq(bookingVerifications.identifier, normalized.identifier));
      return { valid: true, type: record.type };
    }),
  );
}
