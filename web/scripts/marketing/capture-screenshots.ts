/**
 * Saves the marketing screenshots in public/marketing/:
 *   booking-<industry>.png  step 1 of each demo business's booking page, 390x844 at 2x
 *   calendar-week.png       an owner's week calendar with one booking open, 1024x800 at 2x.
 *                           Skipped when the week has no bookings.
 *
 * Booking pages come from the seeded demo businesses (scripts/seed-demo-accounts.ts)
 * and need no login. The calendar needs a signed-in owner, from either:
 *   DEMO_CREDENTIALS_FILE           the seed script's login file (signs in as the demo owner), or
 *   MARKETING_CAPTURE_STORAGE_STATE a Playwright storage state, e.g. tests/e2e/.auth/admin.json
 *                                   from `npx playwright test --project=setup` against a dev server.
 *
 *   MARKETING_CAPTURE_BASE_URL  site to capture (default https://www.bookuptempo.com)
 *   MARKETING_CAPTURE_ONLY      "booking" or "calendar" to capture one set
 *
 * Run: npm run marketing:screenshots
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import sharp from "sharp";
import {
  CALENDAR_DEMO_SLUG,
  CALENDAR_SCREENSHOT,
  DEMO_BUSINESS_SLUGS,
  SCREENSHOT_SIZES,
  bookingScreenshot,
  type MarketingIndustryId,
} from "../../src/lib/marketing/industries";

const SCALE = 2;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

type Login = { tenant: string; role: string; email: string; password: string };

function ownerLogin(slug: string): Login | null {
  const file = process.env.DEMO_CREDENTIALS_FILE;
  if (!file) return null;
  const { logins } = JSON.parse(readFileSync(file, "utf8")) as { logins: Login[] };
  return logins.find((login) => login.tenant === slug && login.role === "owner") ?? null;
}

async function save(buffer: Buffer, publicPath: string) {
  const out = path.join(PUBLIC_DIR, publicPath);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp(buffer).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out);
  console.log(`[screenshots] wrote ${path.relative(process.cwd(), out)}`);
}

async function captureBooking(browser: Browser, baseUrl: string, id: MarketingIndustryId, slug: string) {
  const context = await browser.newContext({
    viewport: SCREENSHOT_SIZES.booking,
    deviceScaleFactor: SCALE,
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/book/${slug}`, { waitUntil: "networkidle" });
  await page.locator("h1, h2").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await save(await page.screenshot(), bookingScreenshot(id)!);
  await context.close();
}

async function signedInContext(browser: Browser, baseUrl: string): Promise<BrowserContext | null> {
  const options = {
    viewport: { width: 1280, height: SCREENSHOT_SIZES.calendar.height },
    deviceScaleFactor: SCALE,
    colorScheme: "light" as const,
  };
  const storageState = process.env.MARKETING_CAPTURE_STORAGE_STATE;
  if (storageState) return browser.newContext({ ...options, storageState });

  const login = ownerLogin(CALENDAR_DEMO_SLUG);
  if (!login) return null;
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(login.email);
  await page.getByLabel("Password").fill(login.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.close();
  return context;
}

async function captureCalendar(browser: Browser, baseUrl: string) {
  const context = await signedInContext(browser, baseUrl);
  if (!context) {
    console.log("[screenshots] no DEMO_CREDENTIALS_FILE or MARKETING_CAPTURE_STORAGE_STATE; skipped the calendar");
    return;
  }
  const page = await context.newPage();
  await page.goto(`${baseUrl}/schedule`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.waitForLoadState("networkidle");
  const booking = page.locator('[role="button"][data-target-exempt="duration"]').first();
  try {
    await booking.waitFor({ state: "attached", timeout: 15_000 });
  } catch {
    console.log("[screenshots] no bookings on this week's calendar; skipped the calendar");
    await context.close();
    return;
  }
  await booking.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await booking.click();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const main = await page.locator("main").boundingBox();
  if (!main) throw new Error("No <main> on /schedule");
  const { width, height } = SCREENSHOT_SIZES.calendar;
  await save(await page.screenshot({ clip: { x: main.x, y: 0, width, height } }), CALENDAR_SCREENSHOT);
  await context.close();
}

async function main() {
  const baseUrl = (process.env.MARKETING_CAPTURE_BASE_URL ?? "https://www.bookuptempo.com").replace(/\/$/, "");
  const only = process.env.MARKETING_CAPTURE_ONLY;
  const browser = await chromium.launch();
  try {
    if (only !== "calendar") {
      for (const [id, slug] of Object.entries(DEMO_BUSINESS_SLUGS) as [MarketingIndustryId, string][]) {
        await captureBooking(browser, baseUrl, id, slug);
      }
    }
    if (only !== "booking") await captureCalendar(browser, baseUrl);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
