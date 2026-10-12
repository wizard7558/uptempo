import { test, expect } from "@playwright/test";
import { STUDIO_TEST_USER, bookingSessionCookie, seedTestSession, sessionCookie } from "./fixtures/auth";

/**
 * Multi-session projects on the seeded `test-studio` tattoo tenant.
 *
 * The seed (scripts/seed-e2e-data.ts) creates the "Sleeve" project: quoted
 * $1,200 over 3 sessions, 2 completed, a $200 deposit and two $400 session
 * payments, so $200 is left to pay and $200 of deposit credit is unused. It
 * has a fixed access token and no design yet.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const STUDIO_HOST = "test-studio.localhost";
const STUDIO_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000101";
const SLEEVE_TOKEN = "e2eSleeveProjectToken0123456789a";

test("the owner sees what is left to pay and the unused deposit credit on a project", async ({ context, page }) => {
  const { signedCookieValue } = await seedTestSession(STUDIO_TEST_USER);
  await context.addCookies([sessionCookie(signedCookieValue)]);

  await page.goto("http://localhost:3000/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const row = page.getByRole("row", { name: /Sleeve/ }).first();
  await expect(row).toContainText("Studio Client");
  await expect(row).toContainText("2 of 3 sessions");
  await expect(row).toContainText("$200.00");

  await row.getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Sleeve" }).first()).toBeVisible();
  // `:visible` skips the hidden copy Next streaming can leave in the DOM.
  await expect(page.locator('dt:visible:has-text("Left to pay") + dd')).toHaveText("$200.00");
  await expect(page.locator('dt:visible:has-text("Deposit credit") + dd')).toHaveText("$200.00");
  await expect(page.locator('dt:visible:has-text("Paid so far") + dd')).toHaveText("$1,000.00");
  await expect(page.getByRole("link", { name: /Book the next/ }).first()).toHaveAttribute(
    "href",
    /\/schedule\?client=f0e2e200-0000-4000-8000-000000000101&projectId=f0e2e200-0000-4000-8000-000000000301/,
  );
});

test("the client's design page says no design has been shared yet", async ({ page }) => {
  await page.goto(`http://${STUDIO_HOST}:3000/book/test-studio/project/${SLEEVE_TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your design" })).toBeVisible();
  await expect(page.getByText("No design has been shared yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve design" })).toHaveCount(0);
});

test("closing a team member's books shows the Books closed panel to clients, and reopening restores the form", async ({ context, page }) => {
  const { signedCookieValue } = await seedTestSession(STUDIO_TEST_USER);
  await context.addCookies([
    sessionCookie(signedCookieValue),
    bookingSessionCookie(STUDIO_CLIENT_ID, STUDIO_HOST),
  ]);

  async function setBooks(option: "Open" | "Closed") {
    await page.goto("http://localhost:3000/settings/staff");
    await page.getByRole("button", { name: "Edit Riley Artist" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Books" }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await expect(dialog.getByText("Saved.")).toBeVisible();
  }

  try {
    await setBooks("Closed");

    const clientPage = await context.newPage();
    await clientPage.goto(`http://${STUDIO_HOST}:3000/book/test-studio`);
    await expect(clientPage.getByRole("heading", { name: "Books are closed" })).toBeVisible();
    await expect(clientPage.getByText("We're not taking new requests right now")).toBeVisible();
    await clientPage.close();
  } finally {
    // A failure above must not leave Riley Artist closed for later specs.
    await setBooks("Open");
  }

  const reopened = await context.newPage();
  await reopened.goto(`http://${STUDIO_HOST}:3000/book/test-studio`);
  await expect(reopened.getByRole("heading", { name: "Books are closed" })).toHaveCount(0);
  await expect(reopened.getByText("Step 1 of 4")).toBeVisible();
});
