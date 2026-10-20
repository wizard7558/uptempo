import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { validateScoreFixtureEnvironment } from "@/lib/testing/score-e2e-fixture";

const TARGET_TENANT = "test-salon";
const OTHER_TENANT = "test-studio";
const TARGET_SCHEMA = "tenant_test-salon";
const OTHER_SCHEMA = "tenant_test-studio";
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

type FixtureSql = ReturnType<typeof postgres>;
type InvitationFixture = {
  sql: FixtureSql;
  token: string;
  email: string;
};

async function withInvitationFixture(
  email: string,
  role: "provider" | "stylist",
  run: (fixture: InvitationFixture) => Promise<void>,
  expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS),
) {
  // Validate before creating a SQL client so this fixture cannot reach a configured database.
  const { databaseUrl } = validateScoreFixtureEnvironment(process.env);
  const sql = postgres(databaseUrl, { max: 1 });
  const token = randomUUID();
  const invitedBy = `e2e-inviter-${randomUUID()}`;
  let testError: unknown;

  try {
    await sql`
      INSERT INTO team_invitations
        (tenant_slug, email, role, invited_by, token, status, expires_at)
      VALUES
        (${TARGET_TENANT}, ${email}, ${role}, ${invitedBy}, ${token}, 'pending', ${expiresAt})
    `;
    await run({ sql, token, email });
  } catch (error) {
    testError = error;
    throw error;
  } finally {
    const cleanupErrors: Array<{ label: string; error: unknown }> = [];
    const cleanup = async (label: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push({ label, error });
      }
    };

    let userId: string | undefined;
    try {
      const [invitee] = await sql<{ id: string }[]>`
        SELECT id FROM "user" WHERE email = ${email} LIMIT 1
      `;
      userId = invitee?.id;
    } catch (error) {
      cleanupErrors.push({ label: "find run-owned user", error });
    }

    if (userId) {
      await cleanup("delete run-owned sessions", () =>
        sql`DELETE FROM "session" WHERE user_id = ${userId}`,
      );
      await cleanup("delete run-owned accounts", () =>
        sql`DELETE FROM "account" WHERE user_id = ${userId}`,
      );
      await cleanup("delete run-owned target membership", () =>
        sql`
          DELETE FROM memberships
          WHERE user_id = ${userId} AND tenant_slug = ${TARGET_TENANT}
        `,
      );
      await cleanup("delete run-owned source membership", () =>
        sql`
          DELETE FROM memberships
          WHERE user_id = ${userId} AND tenant_slug = ${OTHER_TENANT}
        `,
      );
      await cleanup("delete run-owned target staff row", () =>
        sql.unsafe(
          `DELETE FROM "${TARGET_SCHEMA}"."staff" WHERE user_id = $1`,
          [userId],
        ),
      );
      await cleanup("delete run-owned source staff row", () =>
        sql.unsafe(
          `DELETE FROM "${OTHER_SCHEMA}"."staff" WHERE user_id = $1`,
          [userId],
        ),
      );
    }

    await cleanup("delete run-owned invitation", () =>
      sql`
        DELETE FROM team_invitations
        WHERE token = ${token} AND tenant_slug = ${TARGET_TENANT}
      `,
    );
    if (userId) {
      await cleanup("delete run-owned user", () =>
        sql`DELETE FROM "user" WHERE id = ${userId} AND email = ${email}`,
      );
    }
    await cleanup("close fixture SQL client", () => sql.end({ timeout: 5 }));

    if (cleanupErrors.length > 0) {
      if (testError) {
        console.error("[team-invitation] Fixture cleanup failed after test failure", cleanupErrors);
      } else {
        throw new AggregateError(
          cleanupErrors.map(({ error }) => error),
          `Invitation fixture cleanup failed: ${cleanupErrors.map(({ label }) => label).join(", ")}`,
        );
      }
    }
  }
}

function createInviteeEmail(label: string) {
  return `${label}-${randomUUID()}@example.test`;
}

async function acceptNewAccount(page: Page, token: string, name: string) {
  await page.goto(`/invite/${token}`);
  await page.locator("#accept-name").fill(name);
  await page.locator("#accept-password").fill("local-invite-password-123");
  await page.locator("#accept-confirm-password").fill("local-invite-password-123");
  await page.getByRole("button", { name: "Accept & Create Account" }).click();
  await expect(page).toHaveURL(/\/schedule\/?$/);
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
}

async function expectAcceptedMembership(
  sql: FixtureSql,
  token: string,
  email: string,
  expectedTenantSlugs: string[],
  expectedInvitationRole: "provider" | "stylist",
) {
  const [invitation] = await sql<{ status: string; role: string }[]>`
    SELECT status, role FROM team_invitations
    WHERE token = ${token} AND tenant_slug = ${TARGET_TENANT}
  `;
  expect(invitation).toEqual({ status: "accepted", role: expectedInvitationRole });

  const [invitee] = await sql<
    { id: string; email: string; name: string; role: string; tenant_slug: string }[]
  >`
    SELECT id, email, name, role, tenant_slug FROM "user" WHERE email = ${email}
  `;
  expect(invitee).toMatchObject({
    email,
    role: "provider",
    tenant_slug: TARGET_TENANT,
  });

  const memberships = await sql<{ tenant_slug: string; role: string }[]>`
    SELECT tenant_slug, role FROM memberships WHERE user_id = ${invitee.id}
    ORDER BY tenant_slug
  `;
  expect(
    memberships.map(({ tenant_slug, role }) => `${tenant_slug}:${role}`).sort(),
  ).toEqual(expectedTenantSlugs.map((slug) => `${slug}:provider`).sort());

  const targetStaff = await sql.unsafe(
    `SELECT user_id, email, display_name, role, is_active FROM "${TARGET_SCHEMA}"."staff" WHERE user_id = $1`,
    [invitee.id],
  ) as Array<{
    user_id: string;
    email: string | null;
    display_name: string;
    role: string;
    is_active: number;
  }>;
  expect(targetStaff).toHaveLength(1);
  expect(targetStaff[0]).toMatchObject({
    user_id: invitee.id,
    email,
    role: "provider",
    is_active: 1,
  });

  const sourceStaff = await sql.unsafe(
    `SELECT user_id FROM "${OTHER_SCHEMA}"."staff" WHERE user_id = $1`,
    [invitee.id],
  );
  expect(sourceStaff).toHaveLength(0);

  console.log(
    `[team-invitation db-readback] ${JSON.stringify({
      invitation: { status: invitation.status, role: invitation.role },
      user: {
        id: invitee.id,
        tenantSlug: invitee.tenant_slug,
        role: invitee.role,
      },
      memberships: memberships.map(({ tenant_slug, role }) => ({
        tenantSlug: tenant_slug,
        role,
      })),
      targetStaff: targetStaff.map(({ user_id, email: staffEmail, role, is_active }) => ({
        userId: user_id,
        email: staffEmail,
        role,
        isActive: is_active,
      })),
      otherTenantStaffRows: sourceStaff.length,
    })}`,
  );

  return invitee.id;
}

test.describe("provider team invitation acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test("a new provider accepts an invitation and reaches the schedule", async ({ page }) => {
    const email = createInviteeEmail("provider");
    await withInvitationFixture(email, "provider", async ({ sql, token }) => {
      await acceptNewAccount(page, token, "Provider Invitee");
      await expectAcceptedMembership(sql, token, email, [TARGET_TENANT], "provider");

      const differentTenantMemberships = await sql`
        SELECT tenant_slug FROM memberships
        WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})
          AND tenant_slug <> ${TARGET_TENANT}
      `;
      expect(differentTenantMemberships).toHaveLength(0);
    });
  });

  test("a legacy stylist invitation creates provider membership and staff", async ({ page }) => {
    const email = createInviteeEmail("legacy-stylist");
    await withInvitationFixture(email, "stylist", async ({ sql, token }) => {
      await acceptNewAccount(page, token, "Legacy Stylist Invitee");
      await expectAcceptedMembership(sql, token, email, [TARGET_TENANT], "stylist");
    });
  });

  test("an existing matching-email account joins and keeps its original membership", async ({ page }) => {
    const email = createInviteeEmail("existing-provider");
    await withInvitationFixture(email, "provider", async ({ sql, token }) => {
      await page.goto("/login");
      const signupResponse = await page.request.post(
        new URL("/api/auth/sign-up/email", page.url()).toString(),
        {
          data: {
            name: "Existing Invitee",
            email,
            password: "local-invite-password-123",
          },
          headers: { Origin: new URL(page.url()).origin },
        },
      );
      expect(
        signupResponse.ok(),
        `Local Better Auth signup failed: ${await signupResponse.text()}`,
      ).toBe(true);

      const [invitee] = await sql<{ id: string }[]>`
        SELECT id FROM "user" WHERE email = ${email}
      `;
      expect(invitee?.id).toBeTruthy();
      await sql`
        INSERT INTO memberships (user_id, tenant_slug, role)
        VALUES (${invitee.id}, ${OTHER_TENANT}, 'provider')
      `;
      await sql`
        UPDATE "user" SET tenant_slug = ${OTHER_TENANT}, role = 'provider'
        WHERE id = ${invitee.id}
      `;

      await page.goto(`/invite/${token}`);
      await expect(page.getByText("You're signed in as")).toBeVisible();
      await page.getByRole("button").click();
      await expect(page).toHaveURL(/\/schedule\/?$/);
      await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

      await expectAcceptedMembership(
        sql,
        token,
        email,
        [TARGET_TENANT, OTHER_TENANT],
        "provider",
      );
      const preservedMembership = await sql`
        SELECT user_id, role FROM memberships
        WHERE user_id = ${invitee.id} AND tenant_slug = ${OTHER_TENANT}
      `;
      expect(preservedMembership).toEqual([
        { user_id: invitee.id, role: "provider" },
      ]);
    });
  });

  test("an expired invitation is rejected and marked expired", async ({ page }) => {
    const email = createInviteeEmail("expired-provider");
    await withInvitationFixture(
      email,
      "provider",
      async ({ sql, token }) => {
        await page.goto(`/invite/${token}`);
        await expect(page.getByRole("heading", { name: "Invalid invitation" })).toBeVisible();

        const [invitation] = await sql<{ status: string }[]>`
          SELECT status FROM team_invitations
          WHERE token = ${token} AND tenant_slug = ${TARGET_TENANT}
        `;
        expect(invitation?.status).toBe("expired");
        console.log(
          `[team-invitation db-readback] ${JSON.stringify({
            invitation: { status: invitation.status },
            invalidInvitationPage: true,
          })}`,
        );
      },
      new Date(Date.now() - 60_000),
    );
  });
});
