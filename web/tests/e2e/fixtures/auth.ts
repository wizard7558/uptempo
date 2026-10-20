import postgres from "postgres";
import { createHmac } from "node:crypto";

/**
 * E2E test auth fixture.
 *
 * Seeds a real admin user and session directly in the database so that
 * Playwright tests can authenticate via the session cookie. This bypasses
 * the magic-link flow while still exercising the real server-side
 * `auth.api.getSession({ headers })` code path.
 *
 * better-auth uses hono's signed cookie format:
 *   cookie_value = `${token}.${base64_hmac_sha256(token, secret)}`
 *
 * The HMAC-SHA256 signature is computed using the BETTER_AUTH_SECRET
 * environment variable and encoded as standard base64.
 */

export type E2eTestUser = { id: string; email: string; name: string };

const TEST_USER: E2eTestUser = {
  id: "e2e-test-user-001",
  email: "e2e-admin@test.bookuptempo.com",
  name: "E2E Admin",
};

/** Owner of the seeded non-salon (tattoo) tenant `test-studio`. */
export const STUDIO_TEST_USER: E2eTestUser = {
  id: "e2e-test-user-002",
  email: "e2e-studio@test.bookuptempo.com",
  name: "E2E Studio Owner",
};

/** Owner of the seeded home-services tenant `test-home` (on-site visits). */
export const HOME_TEST_USER: E2eTestUser = {
  id: "e2e-test-user-003",
  email: "e2e-home@test.bookuptempo.com",
  name: "E2E Home Owner",
};

/** Owner of the seeded personal-training tenant `test-gym` (classes). */
export const GYM_TEST_USER: E2eTestUser = {
  id: "e2e-test-user-004",
  email: "e2e-gym@test.bookuptempo.com",
  name: "E2E Gym Owner",
};

/**
 * The better-auth session cookie for a signed value, in Playwright's
 * `addCookies` shape. better-auth names it "better-auth.session_token"
 * (prefix "better-auth" + "." + "session_token").
 */
export function sessionCookie(signedValue: string) {
  return {
    name: "better-auth.session_token",
    value: encodeURIComponent(signedValue),
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false, // false for localhost
    sameSite: "Lax" as const,
  };
}

/**
 * Sign a value using HMAC-SHA256 in the same format hono uses for signed cookies.
 * Format: base64(hmac_sha256(value, secret))
 */
function signCookieValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(value)
    .digest("base64");
  return `${value}.${signature}`;
}

/**
 * Seed a test admin user and session in the database, then return
 * the signed cookie value ready to be set in the browser context.
 */
export async function seedTestSession(
  testUser: E2eTestUser = TEST_USER,
): Promise<{
  signedCookieValue: string;
  sessionToken: string;
  userId: string;
}> {
  const secret = process.env.BETTER_AUTH_SECRET!;

  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for E2E auth setup. Set it in your .env file.",
    );
  }

  const sql = postgres(process.env.DATABASE_URL!);
  const sessionToken = `e2e-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionId = `e2e-sid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  try {
    // Create or update test user (better-auth schema uses snake_case columns).
    await sql`
      INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at)
      VALUES (
        ${testUser.id},
        ${testUser.email},
        ${testUser.name},
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
    `;

    // Expired sessions for this synthetic user are safe to prune; valid
    // sessions must remain available to other Playwright projects using the
    // storageState cookie created by the setup project.
    await sql`
      DELETE FROM "session"
      WHERE user_id = ${testUser.id} AND expires_at <= NOW()
    `;

    // Insert session (better-auth schema).
    await sql`
      INSERT INTO "session" (id, user_id, token, expires_at, created_at, updated_at)
      VALUES (
        ${sessionId},
        ${testUser.id},
        ${sessionToken},
        ${expiresAt.toISOString()},
        NOW(),
        NOW()
      )
    `;
  } finally {
    await sql.end();
  }

  // Sign the token the same way hono/better-auth does
  const signedCookieValue = signCookieValue(sessionToken, secret);

  return { signedCookieValue, sessionToken, userId: testUser.id };
}

/**
 * Remove all test sessions (call in globalTeardown or afterAll if needed).
 */
export async function cleanupTestSession(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!);
  await sql`DELETE FROM "session" WHERE user_id = ${TEST_USER.id}`;
  await sql.end();
}

/**
 * The `booking_session` cookie the public pages read for a signed-in client:
 * `${clientId}.${hmacHex}`, HMAC-SHA256 over the client id with the same secret
 * as src/lib/booking/session-cookie.ts. e2e mocks the OTP verify call, so no
 * real cookie is ever set; this stands in for it.
 */
export function bookingSessionCookie(clientId: string, host: string) {
  const secret = process.env.BOOKING_SESSION_SECRET || "dev-secret";
  const hmac = createHmac("sha256", secret).update(clientId).digest("hex");
  return {
    name: "booking_session",
    value: `${clientId}.${hmac}`,
    domain: host,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
  };
}
