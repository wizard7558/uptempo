import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";
import { industrySlug, marketingIndustries } from "../../src/lib/marketing/industries";
import {
  scoreBookingColorMode,
  validateScoreFixtureEnvironment,
} from "../../src/lib/testing/score-e2e-fixture";

const BRANDING_SCHEMAS = [
  "tenant_test-salon",
  "tenant_test-studio",
  "tenant_test-gym",
  "tenant_test-home",
] as const;
const TEST_BRAND_COLOR = "#315CCB";
const BOOKING_COLOR_MODE = scoreBookingColorMode(process.env.SCORE_BOOKING_COLOR_MODE);
type BrandingRow = { id: string; brand_color: string | null; color_mode: string | null };
const originalBranding = new Map<string, BrandingRow[]>();
const insertedBrandingIds = new Map<string, string>();
let brandingFixtureStarted = false;

function playwrightFfmpegPath(): string {
  const requireFromWeb = createRequire(`${process.cwd()}/package.json`);
  const requireFromPlaywright = createRequire(requireFromWeb.resolve("@playwright/test"));
  const { registry } = requireFromPlaywright("playwright-core/lib/server/registry/index") as {
    registry: {
      findExecutable(name: string): { executablePath(): string };
    };
  };
  return registry.findExecutable("ffmpeg").executablePath();
}

function bookingSessionCookie(clientId: string): string {
  const secret = process.env.BOOKING_SESSION_SECRET || "e2e-booking-session-secret";
  const signature = createHmac("sha256", secret).update(clientId).digest("hex");
  return `booking_session=${clientId}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
}

async function restoreTestBranding(sql: ReturnType<typeof postgres>) {
  for (const schema of BRANDING_SCHEMAS) {
    const rows = originalBranding.get(schema) ?? [];
    if (rows.length === 0) {
      const insertedId = insertedBrandingIds.get(schema);
      if (insertedId) {
        await sql.unsafe(`DELETE FROM "${schema}".branding_settings WHERE id = $1`, [insertedId]);
      }
      continue;
    }
    for (const row of rows) {
      await sql.unsafe(
        `UPDATE "${schema}".branding_settings SET brand_color = $1, color_mode = $2 WHERE id = $3`,
        [row.brand_color, row.color_mode, row.id],
      );
    }
  }
}

test.beforeAll(async () => {
  const { databaseUrl, colorMode } = validateScoreFixtureEnvironment(process.env);
  const sql = postgres(databaseUrl, { max: 1 });
  brandingFixtureStarted = true;
  try {
    for (const schema of BRANDING_SCHEMAS) {
      const rows = await sql.unsafe<BrandingRow[]>(
        `SELECT id, brand_color, color_mode FROM "${schema}".branding_settings ORDER BY id`,
      );
      originalBranding.set(schema, rows);
      if (rows.length > 0) {
        await sql.unsafe(
          `UPDATE "${schema}".branding_settings SET brand_color = $1, color_mode = $2`,
          [TEST_BRAND_COLOR, colorMode],
        );
      } else {
        const [inserted] = await sql.unsafe<{ id: string }[]>(
          `INSERT INTO "${schema}".branding_settings (brand_color, color_mode) VALUES ($1, $2) RETURNING id`,
          [TEST_BRAND_COLOR, colorMode],
        );
        insertedBrandingIds.set(schema, inserted.id);
      }
    }
  } catch (error) {
    try {
      await restoreTestBranding(sql);
    } finally {
      await sql.end();
    }
    throw error;
  }
  await sql.end();
});

test.afterAll(async () => {
  if (!brandingFixtureStarted) return;
  const { databaseUrl } = validateScoreFixtureEnvironment(process.env);
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await restoreTestBranding(sql);
  } finally {
    await sql.end();
  }
});

const PAGES = [
  "/ui-gallery",
  "/schedule",
  "/clients",
  "/settings",
  "/book/test-salon",
  "/q/test-salon",
  "/",
  "/pricing",
  "/open-source",
  ...marketingIndustries().map((industry) => `/for/${industrySlug(industry.id)}`),
] as const;

const ADMIN_PAGES = new Set(["/schedule", "/clients", "/settings"]);

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const TARGETS =
  "button, input, select, [role=button], [role=switch], [role=checkbox], [role=tab]";

async function undersizedTargets(page: Page): Promise<string[]> {
  return page.locator(TARGETS).evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      if (!(node instanceof HTMLElement)) return [];
      if (node.closest("[data-target-exempt]")) return [];
      const link = node.closest("a");
      if (link?.closest("p, li, td, blockquote, figcaption, dd")) return [];
      if (node.closest("[hidden], [aria-hidden='true']")) return [];
      let current: Node | null = node;
      while (current) {
        if (current instanceof HTMLElement && current.tagName === "NEXTJS-PORTAL") return [];
        const root = current.getRootNode();
        if (root instanceof ShadowRoot) {
          current = root.host;
          continue;
        }
        current = (current as HTMLElement).parentElement;
      }
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return [];
      }
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      if (rect.width >= 44 && rect.height >= 44) return [];
      const name =
        node.getAttribute("aria-label") ||
        node.textContent?.trim().slice(0, 40) ||
        node.tagName;
      return [
        `${node.tagName.toLowerCase()} "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      ];
    }),
  );
}

async function accessibleStateIssues(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const violations = results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id} ${node.target.join(", ")} ${node.failureSummary ?? ""}`,
    ),
  );
  const smallTargets = await undersizedTargets(page);
  return [...violations, ...smallTargets.map((target) => `target-size ${target}`)];
}

async function expectAccessibleState(page: Page) {
  expect(await accessibleStateIssues(page)).toEqual([]);
}

async function waitForScheduleControlsReady(page: Page) {
  await expect(page.getByTestId("schedule-view-switcher")).toHaveAttribute(
    "data-client-ready",
    "true",
  );
}

async function waitForCalendarView(
  page: Page,
  expectedView: "Day" | "Week" | "Month",
) {
  await waitForScheduleControlsReady(page);
  const button = page.getByRole("button", { name: expectedView, exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const viewData = page.locator(
    `[data-calendar-view="${expectedView.toLowerCase()}"]`,
  );
  await expect(viewData).toBeVisible();
  await expect(viewData).toHaveAttribute("aria-busy", "false");
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function expectAccentFill(
  page: Page,
  locator: Locator,
  scopeSelector = ":root",
) {
  await page.mouse.move(0, 0);
  const colors = await locator.evaluate((element, selector) => {
    const scope = document.querySelector<HTMLElement>(selector);
    if (!scope) throw new Error(`Missing theme scope ${selector}`);
    const styles = getComputedStyle(scope);
    const probe = document.createElement("span");
    document.body.append(probe);
    probe.style.color = styles.getPropertyValue("--accent").trim();
    const accent = getComputedStyle(probe).color;
    probe.style.color = styles.getPropertyValue("--accent-foreground").trim();
    const foreground = getComputedStyle(probe).color;
    probe.remove();
    return { accent, foreground };
  }, scopeSelector);
  await expect
    .poll(() => locator.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(colors.accent);
  await expect
    .poll(() => locator.evaluate((element) => getComputedStyle(element).color))
    .toBe(colors.foreground);
}

async function expectAccentBorder(
  page: Page,
  locator: Locator,
  scopeSelector = ":root",
) {
  const accent = await page.locator(scopeSelector).evaluate((scope) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(scope).getPropertyValue("--accent").trim();
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect
    .poll(() => locator.evaluate((element) => getComputedStyle(element).borderTopColor))
    .toBe(accent);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const path of PAGES) {
      test(`${path} meets WCAG AA and 44px targets`, async ({ page }) => {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        expect(new URL(page.url()).pathname).toBe(path);
        if (scheme === "dark" && ADMIN_PAGES.has(path)) {
          await page.locator("html.dark").waitFor();
        }
        await page.evaluate(() => document.fonts.ready);
        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        const violationIds = results.violations.map(
          (violation) =>
            `${violation.id} x${violation.nodes.length} ${violation.nodes[0]?.html.slice(0, 140) ?? ""}`,
        );
        expect(violationIds).toEqual([]);
        const small = await undersizedTargets(page);
        expect(small).toEqual([]);
      });
    }
  });
}

test("booking steps 1 to 4 meet WCAG AA and 44px targets", async ({ page }, testInfo) => {
  await page.route("**/api/booking/send-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, type: "phone" }),
    }),
  );
  await page.route("**/api/booking/verify-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "set-cookie": bookingSessionCookie("f0e2e200-0000-4000-8000-000000000001") },
      body: JSON.stringify({
        clientId: "f0e2e200-0000-4000-8000-000000000001",
        name: "E2E Test Client",
        isReturning: true,
      }),
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/book/test-salon", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible({
    timeout: 15000,
  });
  await attachScreenshot(page, testInfo, "book-step-1-service");

  const check = async () => {
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    expect(await undersizedTargets(page)).toEqual([]);
  };

  await check();
  const serviceCheckbox = page.getByRole("checkbox").first();
  await serviceCheckbox.check();
  await expect(serviceCheckbox).toHaveAttribute("aria-checked", "true");
  await expectAccentBorder(
    page,
    serviceCheckbox.locator("xpath=ancestor::label[1]"),
    "[data-theme-scope='booking']",
  );
  await attachScreenshot(page, testInfo, "book-step-1-selected");
  await expectAccentFill(
    page,
    page.getByRole("button", { name: /Anyone available/ }),
    "[data-theme-scope='booking']",
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible({ timeout: 15000 });

  await expect(page.locator("[data-booking-date]").first()).toBeVisible({ timeout: 15000 });
  const selectedDate = page.locator("[data-booking-date]").first();
  await selectedDate.click();
  await expect(selectedDate).toHaveAttribute("data-selected-single", "true");
  await expect(selectedDate).toHaveAttribute("aria-pressed", "true");
  await expectAccentFill(page, selectedDate, "[data-theme-scope='booking']");
  const selectedTime = page.locator("[data-slot-double-book]").first();
  await selectedTime.click();
  await expect(selectedTime).toHaveAttribute("aria-pressed", "true");
  await expectAccentFill(page, selectedTime, "[data-theme-scope='booking']");
  await attachScreenshot(page, testInfo, "book-step-2-time");
  await check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
  await attachScreenshot(page, testInfo, "book-step-3-details");
  await check();

  await page.getByLabel("Name").fill("E2E Test Client");
  await page.getByLabel("Phone").fill("+15555550199");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your booking" })).toBeVisible({
    timeout: 15000,
  });
  await attachScreenshot(page, testInfo, "book-step-4-confirm");
  await check();
  await page.setViewportSize({ width: 1280, height: 800 });
  await attachScreenshot(page, testInfo, "book-step-4-confirm-desktop");
});

test("request steps 1 to 4 meet WCAG AA and 44px targets", async ({ page }, testInfo) => {
  await page.route("**/api/booking/send-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, type: "phone" }),
    }),
  );
  await page.route("**/api/booking/verify-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "set-cookie": bookingSessionCookie("f0e2e200-0000-4000-8000-000000000101") },
      body: JSON.stringify({
        clientId: "f0e2e200-0000-4000-8000-000000000101",
        name: "Studio Client",
        isReturning: true,
      }),
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/book/test-studio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Choose a piece" })).toBeVisible({
    timeout: 15000,
  });
  await attachScreenshot(page, testInfo, "request-step-1-service");
  // Continue is a client handler. Wait until scripts settle so the click cannot
  // fall through to a native form submit that reloads step 1.
  await page.waitForLoadState("networkidle");

  const check = async () => {
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    expect(await undersizedTargets(page)).toEqual([]);
  };

  await check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible({ timeout: 15000 });
  await check();

  await page.getByLabel("Where on your body?").fill("Left forearm");
  await page.getByLabel("About how big?").selectOption({ label: "Medium (2 to 5 in)" });
  await attachScreenshot(page, testInfo, "request-step-2-description");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
  await page.getByLabel("Name").fill("Studio Client");
  await page.getByLabel("Phone").fill("+15555550199");
  await attachScreenshot(page, testInfo, "request-step-3-details");
  await check();

  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Send request" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await attachScreenshot(page, testInfo, "request-step-4-confirm");
  await check();
  await page.setViewportSize({ width: 1280, height: 800 });
  await attachScreenshot(page, testInfo, "request-step-4-confirm-desktop");
});

test("class steps meet WCAG AA and 44px targets", async ({ page }, testInfo) => {
  await page.route("**/api/booking/send-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, type: "phone" }),
    }),
  );
  await page.route("**/api/booking/verify-code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "set-cookie": bookingSessionCookie("f0e2e200-0000-4000-8000-000000000302") },
      body: JSON.stringify({
        clientId: "f0e2e200-0000-4000-8000-000000000302",
        name: "Gym Visitor",
        isReturning: true,
      }),
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/book/test-gym/classes", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Full, join the waitlist").first()).toBeVisible({ timeout: 15000 });
  await attachScreenshot(page, testInfo, "class-step-1-schedule");
  await page.waitForLoadState("networkidle");

  const check = async () => {
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    expect(await undersizedTargets(page)).toEqual([]);
  };

  await check();
  await page.getByRole("button", { name: /Full, join the waitlist/ }).click();
  await expect(page.getByText("Step 3 of 4")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await page.getByLabel("Name").fill("Gym Visitor");
  await page.getByLabel("Phone").fill("+15555550199");
  await attachScreenshot(page, testInfo, "class-step-3-details");
  await check();

  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Confirm this session" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await attachScreenshot(page, testInfo, "class-step-4-confirm");
  await check();
  await page.setViewportSize({ width: 1280, height: 800 });
  await attachScreenshot(page, testInfo, "class-step-4-confirm-desktop");
});

test("booking follows synthetic tenant mode even when the device prefers dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/book/test-salon", { waitUntil: "domcontentloaded" });
  const themeScope = page.locator("[data-theme-scope='booking']");
  const mode = BOOKING_COLOR_MODE;
  await expect(themeScope).toHaveClass(new RegExp(`(?:^|\\s)${mode}(?:\\s|$)`));
  await expect(themeScope).toHaveCSS(
    "background-color",
    mode === "dark" ? "rgb(14, 14, 14)" : "rgb(255, 255, 255)",
  );
});

test("selected booking controls use the tenant accent and primary actions stay primary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/book/test-salon", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible({ timeout: 15000 });
  const serviceCheckbox = page.getByRole("checkbox").first();
  await serviceCheckbox.check();
  await expect(serviceCheckbox).toHaveAttribute("aria-checked", "true");
  const selectedServiceRow = serviceCheckbox.locator("xpath=ancestor::label[1]");
  await page.mouse.move(0, 0);
  const serviceRowStyle = await selectedServiceRow.evaluate((element) => {
    const scope = element.closest<HTMLElement>("[data-theme-scope='booking']");
    if (!scope) throw new Error("Missing booking theme scope for selected service");
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(scope).getPropertyValue("--accent").trim();
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      accent,
      background: style.backgroundColor,
      edgeWidth: style.borderTopWidth,
    };
  });
  expect(serviceRowStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(serviceRowStyle.edgeWidth)).toBeGreaterThan(0);
  // The synthetic #315CCB brand is adjusted for AA against each tenant surface.
  const expectedAccent =
    BOOKING_COLOR_MODE === "dark" ? "rgb(87, 122, 214)" : "rgb(49, 92, 203)";
  expect(serviceRowStyle.accent).toBe(expectedAccent);
  await expectAccentBorder(page, selectedServiceRow, "[data-theme-scope='booking']");

  const selectedStaff = page.getByRole("button", { name: /Anyone available/ });
  await expect(selectedStaff).toHaveAttribute("aria-pressed", "true");
  await expectAccentFill(page, selectedStaff, "[data-theme-scope='booking']");
  const primary = page.getByRole("button", { name: "Continue" });
  const primaryBackground = await primary.evaluate((element) => getComputedStyle(element).backgroundColor);
  const primaryTokenColor = await page.locator("[data-theme-scope='booking']").evaluate((element) => {
    const token = getComputedStyle(element).getPropertyValue("--primary").trim();
    const probe = document.createElement("span");
    probe.style.color = token;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(primaryBackground).toBe(primaryTokenColor);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  const date = page.locator("[data-booking-date]").first();
  await expect(date).toBeVisible();
  await date.click();
  await expect(date).toHaveAttribute("data-selected-single", "true");
  await expect(date).toHaveAttribute("aria-pressed", "true");
  await expectAccentFill(page, date, "[data-theme-scope='booking']");
  const time = page.locator("[data-slot-double-book]").first();
  await time.click();
  await expect(time).toHaveAttribute("aria-pressed", "true");
  await expectAccentFill(page, time, "[data-theme-scope='booking']");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`admin sidebar hydrates once on schedule and walk-ins in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.emulateMedia({ colorScheme });

    const checkPage = async (
      pathname: string,
      width: number,
      exerciseResize = false,
    ) => {
      const sidebar = page.locator('[data-slot="sidebar"]:visible');
      const sidebarTrigger = page.locator('[data-slot="sidebar-trigger"]');
      const readSidebarCookie = () =>
        page.evaluate(
          () =>
            document.cookie
              .split("; ")
              .find((part) => part.startsWith("sidebar_state=")) ?? null,
        );
      const sidebarCookieBefore = await readSidebarCookie();

      if (width === 390) {
        await expect(sidebarTrigger).toHaveAccessibleName("Open navigation menu");
        await sidebarTrigger.click();
      }
      await expect(sidebar).toHaveCount(1);
      await expect(sidebar).toBeVisible();
      await expect(sidebar.locator('a[href="/schedule"][aria-label="Calendar"]')).toHaveCount(1);
      await expect(sidebar.locator('a[href="/walk-ins"][aria-label="Walk-ins"]')).toHaveCount(1);
      if (width === 390) {
        const dialog = page.getByRole("dialog");
        const dialogHasFocus = () =>
          page.evaluate(() => {
            const active = document.activeElement;
            return active instanceof HTMLElement && Boolean(active.closest('[role="dialog"]'));
          });
        await expect(dialog).toBeVisible();
        await expect.poll(dialogHasFocus).toBe(true);
        await page.keyboard.press("Tab");
        await expect.poll(dialogHasFocus).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(sidebarTrigger).toBeFocused();
        await expect.poll(readSidebarCookie).toBe(sidebarCookieBefore);

        if (exerciseResize) {
          await sidebarTrigger.click();
          await expect(dialog).toBeVisible();
          await page.setViewportSize({ width: 1280, height: 800 });
          await expect(dialog).toBeHidden();
          await expect(sidebar).toHaveCount(1);
          await expect(sidebarTrigger).toBeFocused();
          await page.setViewportSize({ width: 390, height: 844 });
          await expect(sidebar).toHaveCount(0);
          await expect(sidebarTrigger).toHaveAccessibleName("Open navigation menu");
          await expect.poll(readSidebarCookie).toBe(sidebarCookieBefore);
        }
      } else {
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      if (pathname === "/schedule") {
        await expect(page.locator('[data-testid="schedule-date-navigation"]:visible').first()).toBeVisible();
      } else {
        await expect(page.locator("main h1")).toHaveText("Walk-ins");
      }
      if (colorScheme === "dark") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/dark/);
      }
      await expect(page.getByRole("button", { name: /^Alerts/ })).toBeVisible();
      await page.waitForTimeout(300);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors.filter((message) => /hydration|react error #41[89]/i.test(message))).toEqual([]);
    };

    try {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        for (const pathname of ["/schedule", "/walk-ins"] as const) {
          await page.goto(pathname, { waitUntil: "domcontentloaded" });
          await checkPage(pathname, width, width === 390 && pathname === "/schedule");
          await page.reload({ waitUntil: "domcontentloaded" });
          await checkPage(pathname, width);
        }
      }
    } finally {
      const browserErrorsPath = testInfo.outputPath("admin-sidebar-browser-errors.txt");
      await writeFile(
        browserErrorsPath,
        JSON.stringify({ pageErrors, consoleErrors }, null, 2),
        "utf8",
      );
      await testInfo.attach("admin-sidebar-browser-errors.txt", {
        path: browserErrorsPath,
        contentType: "application/json",
      });
    }
  });
}

test("admin sidebar closes the topmost nested menu before the mobile sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });

  const sidebar = page.locator('[data-slot="sidebar"]:visible');
  const sidebarTrigger = page.locator('[data-slot="sidebar-trigger"]');
  await expect(sidebarTrigger).toHaveAccessibleName("Open navigation menu");
  await sidebarTrigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const businessSwitchTrigger = sidebar.getByRole("button", {
    name: /Current .*:/,
  });
  await expect(businessSwitchTrigger).toBeVisible();
  await businessSwitchTrigger.click();

  const businessMenu = page.getByRole("menu");
  await expect(businessMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(businessMenu).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(businessSwitchTrigger).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(sidebarTrigger).toBeFocused();

  await sidebarTrigger.click();
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!dialogBox || !viewport) throw new Error("Mobile sidebar geometry is unavailable");

  const outsideX = viewport.width - 2;
  expect(outsideX).toBeGreaterThan(dialogBox.x + dialogBox.width);
  await page.mouse.click(outsideX, Math.floor(viewport.height / 2));
  await expect(dialog).toBeHidden();
  await expect(sidebarTrigger).toBeFocused();
});

const QUEUE_SCHEMA = '"tenant_test-salon"';
const QUEUE_PHONE = "+15555550188";
const QUEUE_PHONE_FORMATTED = "(555) 555-0188";
const QUEUE_CUSTOMER = "Score QA Visitor";

async function cleanupQueueFixture(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(
    `DELETE FROM ${QUEUE_SCHEMA}.appointments WHERE client_id IN (SELECT id FROM ${QUEUE_SCHEMA}.clients WHERE phone = $1)`,
    [QUEUE_PHONE],
  );
  await sql.unsafe(
    `DELETE FROM ${QUEUE_SCHEMA}.queue_entries WHERE phone = $1 OR name = $2`,
    [QUEUE_PHONE, QUEUE_CUSTOMER],
  );
  await sql.unsafe(`DELETE FROM ${QUEUE_SCHEMA}.clients WHERE phone = $1`, [QUEUE_PHONE]);
  await sql.unsafe(
    `DELETE FROM otp_rate_limits WHERE tenant_slug = 'test-salon' AND normalized_key LIKE 'queue_join:%'`,
  );
}

test("queue join and status stay accessible on mobile", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const { databaseUrl } = validateScoreFixtureEnvironment(process.env);
  const sql = postgres(databaseUrl, { max: 1 });
  let originalQueueOpen: number | boolean | null = null;
  let customerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  const browserErrors: string[] = [];
  const captureErrors = (target: Page, label: string) => {
    target.on("pageerror", (error) => browserErrors.push(`${label} pageerror: ${error.message}`));
    target.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`${label} console.error: ${message.text()}`);
    });
  };
  captureErrors(page, "staff");
  try {
    const [settings] = await sql.unsafe<{ queue_open: number | boolean }[]>(
      `SELECT queue_open FROM ${QUEUE_SCHEMA}.business_settings LIMIT 1`,
    );
    originalQueueOpen = settings?.queue_open ?? null;
    await cleanupQueueFixture(sql);
    await sql.unsafe(`UPDATE ${QUEUE_SCHEMA}.business_settings SET queue_open = 0`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/walk-ins");
    await expect(page.getByRole("heading", { name: "Walk-ins", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Open the line" }).click();
    await expect(page.getByText("The line is open", { exact: true })).toBeVisible();

    customerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const customer = await customerContext.newPage();
    captureErrors(customer, "customer");
    await customer.setViewportSize({ width: 390, height: 844 });
    await customer.goto("/q/test-salon");
    await expect(customer.getByLabel("Your name")).toBeVisible();
    await expect(customer).toHaveTitle("Join the line");
    await expectAccessibleState(customer);
    await attachScreenshot(customer, testInfo, "queue-join");
    await customer.getByLabel("Your name").fill(QUEUE_CUSTOMER);
    await customer.getByLabel("Phone").fill(QUEUE_PHONE_FORMATTED);
    await customer.getByLabel("Service").selectOption({ label: "Haircut" });
    await customer.getByRole("button", { name: "Join the line" }).click();
    await expect(customer.getByRole("status")).toContainText(/^You're number 1\./);
    await attachScreenshot(customer, testInfo, "queue-status");
    await expectAccessibleState(customer);
    expect(browserErrors).toEqual([]);
  } finally {
    try {
      await customerContext?.close();
    } finally {
      try {
        await cleanupQueueFixture(sql);
      } finally {
        try {
          if (originalQueueOpen !== null) {
            await sql.unsafe(
              `UPDATE ${QUEUE_SCHEMA}.business_settings SET queue_open = $1`,
              [originalQueueOpen],
            );
          }
        } finally {
          await sql.end();
        }
      }
    }
    const browserErrorsPath = testInfo.outputPath("queue-browser-errors.txt");
    await writeFile(
      browserErrorsPath,
      browserErrors.length ? browserErrors.join("\n") : "No browser console errors or page errors captured.",
      "utf8",
    );
    await testInfo.attach("queue-browser-errors.txt", {
      path: browserErrorsPath,
      contentType: "text/plain",
    });
  }
});

function daytimeZone(now = new Date()): string {
  const shift = 12 - now.getUTCHours();
  if (shift === 0) return "UTC";
  if (shift > 0) return `Etc/GMT-${shift}`;
  return `Etc/GMT+${-shift}`;
}

test("calendar views and details stay accessible on desktop and phone", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { databaseUrl, colorMode } = validateScoreFixtureEnvironment(process.env);
  const sql = postgres(databaseUrl, { max: 1 });
  const roomName = `Score QA Room ${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
  let originalTimezone: string | null = null;
  const roomIds: string[] = [];
  const checkedCalendarStates: string[] = [];
  const calendarAccessibilityIssues: string[] = [];
  const checkCalendarState = async (state: string) => {
    if (state === "phone agenda") {
      await expect(page.getByTestId("agenda-list")).toBeVisible();
    } else {
      const expectedView = state.startsWith("month")
        ? "Month"
        : state.startsWith("week") || state === "appointment details"
          ? "Week"
          : "Day";
      const scheduleGrid = page.getByTestId("schedule-grid-panel");
      await expect(scheduleGrid).toBeVisible();
      const viewData = scheduleGrid.locator(
        `[data-calendar-view="${expectedView.toLowerCase()}"]`,
      );
      await expect(viewData).toHaveCount(1);
      await waitForCalendarView(page, expectedView);
      if (state === "rooms") {
        await expect(
          page.getByRole("button", { name: "Rooms", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      }
    }
    checkedCalendarStates.push(state);
    const issues = await accessibleStateIssues(page);
    calendarAccessibilityIssues.push(...issues.map((issue) => `${state}: ${issue}`));
  };
  try {
    const [settings] = await sql.unsafe<{ timezone: string | null }[]>(
      `SELECT timezone FROM ${QUEUE_SCHEMA}.business_settings LIMIT 1`,
    );
    originalTimezone = settings?.timezone ?? null;
    if (!originalTimezone) throw new Error("Business timezone could not be read");
    const existingRooms = await sql.unsafe<{ id: string }[]>(
      `SELECT id FROM ${QUEUE_SCHEMA}.resources WHERE name LIKE $1 LIMIT 1`,
      [`${roomName}%`],
    );
    if (existingRooms.length > 0) throw new Error("Score QA rooms already exist in the synthetic fixture");
    await sql.unsafe(`UPDATE ${QUEUE_SCHEMA}.business_settings SET timezone = $1`, [daytimeZone()]);
    for (let index = 1; index <= 5; index++) {
      const [room] = await sql.unsafe<{ id: string }[]>(
        `INSERT INTO ${QUEUE_SCHEMA}.resources (name, kind, capacity, is_active) VALUES ($1, 'room', 1, 1) RETURNING id`,
        [`${roomName} ${index}`],
      );
      roomIds.push(room.id);
    }

    await page.emulateMedia({ colorScheme: colorMode });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/schedule");
    await waitForScheduleControlsReady(page);
    await expect(page.getByRole("group", { name: "Calendar view" })).toBeVisible();
    const day = page.getByRole("button", { name: "Day", exact: true });
    await expect(day).toBeVisible({ timeout: 15000 });
    await expect(day).toHaveAttribute("aria-pressed", "true");
    await expectAccentFill(page, day);

    const activeNav = page.locator('[data-slot="sidebar-menu-button"][data-active="true"]').first();
    await expect(activeNav).toBeVisible();
    const navColors = await activeNav.evaluate((element) => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const probe = document.createElement("span");
      probe.style.color = accent;
      document.body.append(probe);
      const accentRgb = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { accentRgb, color: style.color, shadow: style.boxShadow };
    });
    expect(navColors.color).toBe(navColors.accentRgb);
    expect(navColors.shadow).toContain(navColors.accentRgb);

    const host = page.getByRole("button", { name: /E2E Host Client/ });
    let hostOffset = 0;
    let foundHost = false;
    for (; hostOffset < 12; hostOffset++) {
      try {
        await expect(host.first()).toBeVisible({ timeout: 5000 });
        foundHost = true;
        break;
      } catch {
        await page.getByRole("button", { name: "Next", exact: true }).click();
      }
    }
    expect(foundHost).toBe(true);
    await host.first().scrollIntoViewIfNeeded();
    await expect(host.first()).toBeInViewport();
    await checkCalendarState("day");
    await attachScreenshot(page, testInfo, "calendar-day-desktop");

    await page.getByRole("button", { name: "Today", exact: true }).click();
    const week = page.getByRole("button", { name: "Week", exact: true });
    await week.click();
    await expect(week).toHaveAttribute("aria-pressed", "true");
    await expectAccentFill(page, week);
    const todayHeader = page.locator('button[aria-current="date"]');
    await expect(todayHeader).toBeVisible();
    await expectAccentFill(page, todayHeader.locator("span").nth(1));
    await checkCalendarState("week showing today");
    await attachScreenshot(page, testInfo, "calendar-week-today-desktop");

    const month = page.getByRole("button", { name: "Month", exact: true });
    await month.click();
    await expect(month).toHaveAttribute("aria-pressed", "true");
    await expectAccentFill(page, month);
    await expect(page.getByRole("button", { name: /, \w+ \d{1,2}, \d{4}/ }).first()).toBeVisible();
    const currentDay = page.locator('button[aria-current="date"]');
    await expect(currentDay).toBeVisible();
    await expectAccentFill(page, currentDay.locator("span").first());
    await checkCalendarState("month showing today");
    await attachScreenshot(page, testInfo, "calendar-month-desktop");

    await day.click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    for (let step = 0; step < hostOffset; step++) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await expect(host.first()).toBeVisible({ timeout: 15000 });
    const rooms = page.getByRole("button", { name: "Rooms", exact: true });
    await expect(rooms).toBeVisible();
    await rooms.click();
    await expect(rooms).toHaveAttribute("aria-pressed", "true");
    await expectAccentFill(page, rooms);
    const roomColumns = page.getByTestId("room-column").filter({ hasText: roomName });
    await expect(roomColumns).toHaveCount(5);
    await expect(roomColumns.first()).toBeVisible();
    const scheduleGrid = page.getByTestId("schedule-grid-panel");
    const resourceGrid = page.getByTestId("day-grid-scroll");
    const roomDock = page.getByTestId("appointment-dock");
    const globalSearch = page.getByRole("button", { name: "Search", exact: true });
    const roomsBounds = await Promise.all([
      scheduleGrid.boundingBox(),
      roomDock.boundingBox(),
      globalSearch.boundingBox(),
      page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      })),
    ]);
    expect(roomsBounds[0]).not.toBeNull();
    expect(roomsBounds[1]).not.toBeNull();
    expect(roomsBounds[2]).not.toBeNull();
    expect(roomsBounds[0]!.x).toBeGreaterThanOrEqual(0);
    expect(roomsBounds[0]!.x + roomsBounds[0]!.width).toBeLessThanOrEqual(
      roomsBounds[1]!.x + 1,
    );
    expect(roomsBounds[1]!.x + roomsBounds[1]!.width).toBeLessThanOrEqual(
      roomsBounds[3].viewportWidth,
    );
    expect(roomsBounds[2]!.x).toBeGreaterThanOrEqual(0);
    expect(roomsBounds[2]!.x + roomsBounds[2]!.width).toBeLessThanOrEqual(
      roomsBounds[3].viewportWidth,
    );
    expect(roomsBounds[3].documentWidth).toBeLessThanOrEqual(roomsBounds[3].viewportWidth);
    const resourceScroll = await resourceGrid.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    const roomsBoundsPath = testInfo.outputPath("calendar-rooms-viewport-bounds.json");
    await writeFile(
      roomsBoundsPath,
      JSON.stringify(
        {
          scheduleGrid: roomsBounds[0],
          appointmentDock: roomsBounds[1],
          globalSearch: roomsBounds[2],
          viewport: roomsBounds[3],
          resourceScroll,
        },
        null,
        2,
      ),
      "utf8",
    );
    await testInfo.attach("calendar-rooms-viewport-bounds.json", {
      path: roomsBoundsPath,
      contentType: "application/json",
    });
    await expect(resourceGrid).toHaveAttribute("role", "region");
    await expect(resourceGrid).toHaveAttribute("aria-label", "Calendar view");
    await expect(resourceGrid).toHaveAttribute("tabindex", "0");
    expect(resourceScroll.overflowX).toBe("auto");
    expect(resourceScroll.scrollWidth).toBeGreaterThan(resourceScroll.clientWidth);
    await checkCalendarState("rooms");
    await attachScreenshot(page, testInfo, "calendar-rooms-desktop");

    await page.getByRole("button", { name: "People", exact: true }).click();
    await expect(host.first()).toBeVisible({ timeout: 15000 });
    await week.click();
    await expect(week).toHaveAttribute("aria-pressed", "true");
    await host.first().scrollIntoViewIfNeeded();
    await expect(host.first()).toBeInViewport();
    await checkCalendarState("week showing the host appointment");
    await attachScreenshot(page, testInfo, "calendar-week-desktop");
    await host.first().click();
    const dock = page.getByTestId("appointment-dock");
    await expect(dock).toBeVisible();
    await checkCalendarState("appointment details");
    await attachScreenshot(page, testInfo, "calendar-details-desktop");
    await dock.getByRole("button", { name: "Close", exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("agenda-list")).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E Host Client/ })).toBeVisible();
    const dateNav = page.getByTestId("schedule-date-navigation");
    const navButtons = dateNav.getByRole("button");
    const previous = navButtons.nth(0);
    const dateLabel = navButtons.nth(1);
    const next = navButtons.nth(2);
    const today = navButtons.nth(3);
    await expect(today).toBeVisible();
    for (const control of [previous, dateLabel, next, today]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(horizontalOverflow).toBe(false);
    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dateLabel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(today).toBeFocused();
    await page.keyboard.press("Enter");
    for (let step = 0; step < hostOffset; step++) {
      await next.click();
    }
    await expect(page.getByRole("button", { name: /E2E Host Client/ })).toBeVisible();
    await checkCalendarState("phone agenda");
    await attachScreenshot(page, testInfo, "calendar-phone-agenda");
    const accessibilityResultsPath = testInfo.outputPath("calendar-accessibility-results.txt");
    await writeFile(
      accessibilityResultsPath,
      [
        `Checked states: ${checkedCalendarStates.join(", ")}`,
        calendarAccessibilityIssues.length
          ? `Findings:\n${calendarAccessibilityIssues.join("\n")}`
          : "No Axe violations or targets below 44px.",
      ].join("\n"),
      "utf8",
    );
    await testInfo.attach("calendar-accessibility-results.txt", {
      path: accessibilityResultsPath,
      contentType: "text/plain",
    });
    expect(calendarAccessibilityIssues).toEqual([]);
  } finally {
    try {
      for (const roomId of roomIds) {
        await sql.unsafe(`DELETE FROM ${QUEUE_SCHEMA}.appointment_resources WHERE resource_id = $1`, [roomId]);
        await sql.unsafe(`DELETE FROM ${QUEUE_SCHEMA}.resources WHERE id = $1`, [roomId]);
      }
    } finally {
      try {
        if (originalTimezone) {
          await sql.unsafe(`UPDATE ${QUEUE_SCHEMA}.business_settings SET timezone = $1`, [originalTimezone]);
        }
      } finally {
        await sql.end();
      }
    }
  }
});

test("record a short booking and calendar interaction", async ({ browser }, testInfo) => {
  test.skip(BOOKING_COLOR_MODE !== "light", "One representative recording is sufficient");
  test.setTimeout(90_000);
  const videoDir = testInfo.outputPath("recording");
  await mkdir(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: "tests/e2e/.auth/admin.json",
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  const video = page.video();
  const baseUrl = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
  let testFailed = false;
  let testFailure: unknown;
  const recordingErrors: string[] = [];
  try {
    await page.goto(`${baseUrl}/book/test-salon`);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("[data-booking-date]").first().click();
    await page.locator("[data-slot-double-book]").first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Name")).toBeVisible();
    await page.waitForTimeout(1000);
    await page.goto(`${baseUrl}/schedule`);
    await waitForScheduleControlsReady(page);
    const week = page.getByRole("button", { name: "Week", exact: true });
    await expect(week).toBeVisible();
    await expect(week).toBeEnabled();
    await week.click();
    await waitForCalendarView(page, "Week");
    const day = page.getByRole("button", { name: "Day", exact: true });
    await day.click();
    await waitForCalendarView(page, "Day");
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    try {
      await context.close();
    } catch (error) {
      if (testFailed) {
        recordingErrors.push(`Failed to close recording context: ${String(error)}`);
      } else {
        testFailed = true;
        testFailure = error;
      }
    }

    try {
      if (!video) throw new Error("Playwright did not create a recording for this context");
      const videoPath = testInfo.outputPath("book-calendar-interaction.webm");
      await video.saveAs(videoPath);
      const videoStat = await stat(videoPath);
      expect(videoStat.size).toBeGreaterThan(0);
      const decodeCheckPath = testInfo.outputPath("book-calendar-interaction-decode-check.webm");
      const ffmpegOutput = execFileSync(
        playwrightFfmpegPath(),
        [
          "-hide_banner",
          "-v",
          "error",
          "-i",
          videoPath,
          "-map",
          "0:v:0",
          "-c:v",
          "libvpx",
          "-deadline",
          "realtime",
          "-f",
          "webm",
          decodeCheckPath,
          "-progress",
          "pipe:1",
          "-nostats",
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      const decodedFrameCounts = Array.from(
        ffmpegOutput.matchAll(/^frame=(\d+)$/gm),
        (match) => Number(match[1]),
      );
      expect(Math.max(...decodedFrameCounts)).toBeGreaterThan(0);
      await testInfo.attach("book-calendar-interaction", {
        path: videoPath,
        contentType: "video/webm",
      });
    } catch (error) {
      if (testFailed) {
        recordingErrors.push(`Failed to save, validate, or attach recording: ${String(error)}`);
      } else {
        testFailed = true;
        testFailure = error;
      }
    }

    if (recordingErrors.length > 0) {
      try {
        const recordingErrorsPath = testInfo.outputPath("recording-save-errors.txt");
        await writeFile(recordingErrorsPath, recordingErrors.join("\n"), "utf8");
        await testInfo.attach("recording-save-errors.txt", {
          path: recordingErrorsPath,
          contentType: "text/plain",
        });
      } catch {
        // Preserve the original interaction error if attaching diagnostics fails.
      }
    }
  }

  if (testFailed) throw testFailure;
});
