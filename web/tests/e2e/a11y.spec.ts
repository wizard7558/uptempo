import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/ui-gallery",
  "/schedule",
  "/clients",
  "/settings",
  "/book/test-salon",
  "/q/test-salon",
  "/",
  "/pricing",
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

test("booking steps 1 to 4 meet WCAG AA and 44px targets", async ({ page }) => {
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

  const check = async () => {
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    expect(await undersizedTargets(page)).toEqual([]);
  };

  await check();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible({ timeout: 15000 });
  await check();

  await expect(page.locator("[data-booking-date]").first()).toBeVisible({ timeout: 15000 });
  await page.locator("[data-booking-date]").first().click();
  await page.locator("[data-slot-double-book]").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
  await check();

  await page.getByLabel("Name").fill("E2E Test Client");
  await page.getByLabel("Phone").fill("+15555550199");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your booking" })).toBeVisible({
    timeout: 15000,
  });
  await check();
});

test("request steps 1 to 4 meet WCAG AA and 44px targets", async ({ page }) => {
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
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
  await check();

  await page.getByLabel("Name").fill("Studio Client");
  await page.getByLabel("Phone").fill("+15555550199");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Send request" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await check();
});

test("class steps meet WCAG AA and 44px targets", async ({ page }) => {
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
  await check();

  await page.getByLabel("Name").fill("Gym Visitor");
  await page.getByLabel("Phone").fill("+15555550199");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Confirm this session" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await check();
});

test("booking stays on the light background when the device prefers dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/book/test-salon", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-theme-scope='booking']")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
});
