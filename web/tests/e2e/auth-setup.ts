import { test as setup } from "@playwright/test";
import { seedTestSession, sessionCookie } from "./fixtures/auth";

const AUTH_STATE_PATH = "tests/e2e/.auth/admin.json";

/**
 * Playwright setup project: seeds a real admin session in the database
 * and saves the signed session cookie as storageState for reuse across
 * admin test projects.
 *
 * This replaces the broken page.route() mock approach which only
 * intercepted client-side fetches, not the server-side
 * auth.api.getSession({ headers }) call in the admin layout.
 */
setup("seed admin session", async ({ context }) => {
  const { signedCookieValue } = await seedTestSession();

  // Set the better-auth session cookie (signed token: `token.hmac_signature`).
  await context.addCookies([sessionCookie(signedCookieValue)]);

  // Save the authenticated state for reuse by admin test projects
  await context.storageState({ path: AUTH_STATE_PATH });
});
