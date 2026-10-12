import crypto from "crypto";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { eq, and, gt } from "drizzle-orm";

export const OTP_EXPIRY_SECONDS = 600; // 10 minutes
export const MAX_ATTEMPTS = 3;

/**
 * Generate a cryptographically secure 6-digit OTP code.
 */
export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

async function createVerificationForResolvedTenant(
  tenantSlug: string,
  identifier: string,
  type: "email" | "phone",
): Promise<string> {
  return withTenantDb(tenantSlug, async (db, { bookingVerifications }) => {
    await db
      .delete(bookingVerifications)
      .where(eq(bookingVerifications.identifier, identifier));

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    await db.insert(bookingVerifications).values({
      identifier,
      type,
      code,
      attempts: 0,
      expiresAt,
    });

    return code;
  });
}

/**
 * Create a verification record in the database.
 * Deletes any existing verifications for the same identifier before inserting.
 * Returns the generated code string.
 */
export async function createVerification(
  identifier: string,
  type: "email" | "phone",
): Promise<string> {
  const slug = await getTenantSlug();
  return createVerificationForResolvedTenant(slug, identifier, type);
}

export async function createVerificationForTenant(
  tenantSlug: string,
  identifier: string,
  type: "email" | "phone",
): Promise<string> {
  return createVerificationForResolvedTenant(tenantSlug, identifier, type);
}

/**
 * Verify a code against the stored verification record.
 * Returns { valid: true, type } on success, { valid: false } on failure.
 * Increments attempt count on wrong code. Max 3 attempts allowed.
 */
export async function verifyCode(
  identifier: string,
  code: string,
): Promise<{ valid: true; type: string } | { valid: false }> {
  const slug = await getTenantSlug();
  return verifyCodeForTenant(slug, identifier, code);
}

/**
 * App Store review mode: when REVIEW_OTP_EMAIL and REVIEW_OTP_CODE are both
 * set, that one identifier verifies with the static 6-digit code instead of a
 * sent one (Apple reviewers cannot receive our email/SMS). Disabled unless
 * both env vars are configured; all other identifiers are unaffected.
 */
function isReviewOtp(identifier: string, code: string): boolean {
  const reviewEmail = process.env.REVIEW_OTP_EMAIL?.trim().toLowerCase();
  const reviewCode = process.env.REVIEW_OTP_CODE?.trim();
  return Boolean(
    reviewEmail &&
      reviewCode &&
      identifier.trim().toLowerCase() === reviewEmail &&
      code === reviewCode,
  );
}

export async function verifyCodeForTenant(
  tenantSlug: string,
  identifier: string,
  code: string,
): Promise<{ valid: true; type: string } | { valid: false }> {
  if (isReviewOtp(identifier, code)) {
    return { valid: true, type: "email" };
  }

  const now = new Date();

  return withTenantDb(tenantSlug, async (db, { bookingVerifications }) => {
    // Find matching non-expired verification
    const [record] = await db
      .select()
      .from(bookingVerifications)
      .where(
        and(
          eq(bookingVerifications.identifier, identifier),
          gt(bookingVerifications.expiresAt, now),
        ),
      )
      .limit(1);

    if (!record) {
      return { valid: false };
    }

    // Check attempt limit
    if (record.attempts >= MAX_ATTEMPTS) {
      return { valid: false };
    }

    // Check code match
    if (record.code !== code) {
      // Increment attempts
      await db
        .update(bookingVerifications)
        .set({ attempts: record.attempts + 1 })
        .where(eq(bookingVerifications.id, record.id));
      return { valid: false };
    }

    // Code is correct -- delete the record and return success
    await db
      .delete(bookingVerifications)
      .where(eq(bookingVerifications.id, record.id));

    return { valid: true, type: record.type };
  });
}
