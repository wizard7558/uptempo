import { addDays, addMonths, endOfWeek, format, parse, startOfWeek } from "date-fns";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

const SCHEMA = `"tenant_test-salon"`;
const ROOM = "Color Room";
const HOST_CLIENT_ID = "f0e2e201-0000-4000-8000-000000000001";
const DAY_DATE_FORMAT = "EEEE, MMM d, yyyy";

function daytimeZone(now = new Date()): string {
  const shift = 12 - now.getUTCHours();
  if (shift === 0) return "UTC";
  if (shift > 0) return `Etc/GMT-${shift}`;
  return `Etc/GMT+${-shift}`;
}

async function expectCalendarView(
  page: Page,
  view: "Day" | "Week" | "Month",
) {
  await expect(page.getByTestId("schedule-view-switcher")).toHaveAttribute(
    "data-client-ready",
    "true",
  );
  const button = page.getByRole("button", { name: view, exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const viewData = page.locator(`[data-calendar-view="${view.toLowerCase()}"]`);
  await expect(viewData).toBeVisible();
  await expect(viewData).toHaveAttribute("aria-busy", "false");
}

async function expectNeutralCalendarSurface(locator: Locator) {
  const colors = await locator.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;background-color:var(--card);color:var(--card-foreground);border:1px solid var(--border)";
    document.body.append(probe);
    const actual = getComputedStyle(element);
    const expected = getComputedStyle(probe);
    const result = {
      background: actual.backgroundColor,
      expectedBackground: expected.backgroundColor,
      foreground: actual.color,
      expectedForeground: expected.color,
      border: actual.borderTopColor,
      expectedBorder: expected.borderTopColor,
      borderWidth: actual.borderTopWidth,
    };
    probe.remove();
    return result;
  });

  expect(colors.background).toBe(colors.expectedBackground);
  expect(colors.foreground).toBe(colors.expectedForeground);
  expect(colors.border).toBe(colors.expectedBorder);
  expect(colors.borderWidth).toBe("1px");
}

function parseDayDateLabel(label: string): Date {
  const date = parse(label, DAY_DATE_FORMAT, new Date());
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Could not parse calendar day label: ${label}`);
  }
  return date;
}

function desktopDateLabel(date: Date, view: "Week" | "Month"): string {
  if (view === "Month") return format(date, "MMMM yyyy");
  return `${format(startOfWeek(date, { weekStartsOn: 1 }), "MMM d")} - ${format(endOfWeek(date, { weekStartsOn: 1 }), "MMM d, yyyy")}`;
}

async function expectResponsiveNavigation(
  page: Page,
  view: "Week" | "Month",
) {
  const dateNav = page.getByTestId("schedule-date-navigation");
  const controls = dateNav.getByRole("button");
  const previous = controls.nth(0);
  const dateLabel = controls.nth(1);
  const next = controls.nth(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("agenda-list")).toBeVisible();
  await expect
    .poll(() => dateLabel.innerText())
    .toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /);
  const selectedDate = parseDayDateLabel(await dateLabel.innerText());
  const selectedDateLabel = format(selectedDate, DAY_DATE_FORMAT);

  await next.click();
  await expect(dateLabel).toHaveText(format(addDays(selectedDate, 1), DAY_DATE_FORMAT));
  await previous.click();
  await expect(dateLabel).toHaveText(selectedDateLabel);
  await previous.click();
  await expect(dateLabel).toHaveText(format(addDays(selectedDate, -1), DAY_DATE_FORMAT));
  await next.click();
  await expect(dateLabel).toHaveText(selectedDateLabel);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expectCalendarView(page, view);
  await expect(dateLabel).toHaveText(desktopDateLabel(selectedDate, view));
  const nextDesktopDate =
    view === "Week" ? addDays(selectedDate, 7) : addMonths(selectedDate, 1);
  await next.click();
  await expect(dateLabel).toHaveText(desktopDateLabel(nextDesktopDate, view));
  await previous.click();
  if (view === "Month") {
    await dateLabel.click();
    const selectedDayAttribute = await page.evaluate((isoDate) => {
      const [year, month, day] = isoDate.split("-").map(Number);
      return new Date(year!, month! - 1, day!).toLocaleDateString();
    }, format(selectedDate, "yyyy-MM-dd"));
    await page
      .locator(`[data-slot="calendar"] button[data-day="${selectedDayAttribute}"]`)
      .click();
    await page.keyboard.press("Escape");
    await expect(dateLabel).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-slot="popover-content"]')).toBeHidden();
  }
  await expect(dateLabel).toHaveText(desktopDateLabel(selectedDate, view));
}

test.describe("admin calendar", () => {
  test("day, rooms, check-in, text, drag, and the phone agenda", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const sql = postgres(process.env.DATABASE_URL!);
    let originalTimezone: string | null = null;
    try {
      const settings = await sql.unsafe(
        `SELECT timezone FROM ${SCHEMA}.business_settings LIMIT 1`,
      );
      originalTimezone =
        typeof settings[0]?.timezone === "string" ? settings[0].timezone : null;
      if (!originalTimezone) throw new Error("Business timezone could not be read");

      const displayTimezone = daytimeZone();
      await sql.unsafe(
        `UPDATE ${SCHEMA}.business_settings SET timezone = '${displayTimezone}'`,
      );
      await sql.unsafe(`
        INSERT INTO ${SCHEMA}.resources (name, kind, capacity, is_active)
        VALUES ('${ROOM}', 'room', 1, 1)
      `);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/schedule");
      await expectCalendarView(page, "Day");
      const week = page.getByRole("button", { name: "Week", exact: true });
      const month = page.getByRole("button", { name: "Month", exact: true });
      const day = page.getByRole("button", { name: "Day", exact: true });
      await expect(page.getByRole("button", { name: "Day", exact: true })).toBeVisible({
        timeout: 15000,
      });
      await week.click();
      await expectCalendarView(page, "Week");
      await month.click();
      await expectCalendarView(page, "Month");
      await expect(page.getByText("Mon", { exact: true })).toBeVisible();
      await day.click();
      await expectCalendarView(page, "Day");

      const host = page.getByRole("button", { name: /E2E Host Client/ });
      let foundHost = false;
      for (let i = 0; i < 12; i++) {
        try {
          await expect(host.first()).toBeVisible({ timeout: 5000 });
          foundHost = true;
          break;
        } catch {
          await page.getByRole("button", { name: "Next", exact: true }).click();
        }
      }
      expect(foundHost).toBe(true);
      await expectNeutralCalendarSurface(host.first());
      const hostDetails = (await host.first().getAttribute("aria-label")) ?? "";
      expect(hostDetails).toMatch(/^E2E Host Client, E2E Host Block, .+, .+$/);
      const processingBand = host.first().locator('[aria-hidden="true"]');
      await expect(processingBand).toHaveCount(1);
      await expect
        .poll(() =>
          processingBand.evaluate((element) => getComputedStyle(element).backgroundImage),
        )
        .toContain("repeating-linear-gradient");
      await page.screenshot({
        path: testInfo.outputPath("calendar-day-desktop.png"),
        fullPage: false,
      });

      await week.click();
      await expectCalendarView(page, "Week");
      await expect(host.first()).toBeVisible();
      await expectNeutralCalendarSurface(host.first());

      await month.click();
      await expectCalendarView(page, "Month");
      const monthHost = page.locator(
        '[data-calendar-view="month"] div[title^="E2E Host Client"]',
      );
      await expect(monthHost.first()).toBeVisible();
      await expectNeutralCalendarSurface(monthHost.first());

      await day.click();
      await expectCalendarView(page, "Day");
      await expect(host.first()).toBeVisible();

      await page.emulateMedia({ colorScheme: "dark" });
      await expect
        .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
        .toBe(true);
      await expectNeutralCalendarSurface(host.first());
      await page.screenshot({
        path: testInfo.outputPath("calendar-day-dark-neutral-card.png"),
        fullPage: false,
      });
      await page.emulateMedia({ colorScheme: "light" });
      await expect
        .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
        .toBe(false);

      const rooms = page.getByRole("button", { name: "Rooms", exact: true });
      await expect(rooms).toBeEnabled();
      await rooms.click();
      await expect(rooms).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("room-column").filter({ hasText: ROOM })).toBeVisible();
      const people = page.getByRole("button", { name: "People", exact: true });
      await expect(people).toBeEnabled();
      await people.click();
      await expect(people).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("person-column").filter({ hasText: "Test Stylist" })).toBeVisible();
      await expect(host.first()).toBeVisible({ timeout: 15000 });

      await host.first().click();
      const dock = page.getByTestId("appointment-dock");
      await expect(dock).toBeVisible();
      await dock.getByRole("button", { name: "Check in", exact: true }).click();
      await expect(dock.getByRole("button", { name: "Checked in", exact: true })).toBeVisible({
        timeout: 10000,
      });

      await dock.getByRole("button", { name: "Send a text", exact: true }).click();
      await page.getByRole("textbox", { name: "Send a text" }).fill("See you soon");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("Text sent")).toBeVisible({ timeout: 10000 });

      const [message] = await sql.unsafe(
        `SELECT body, message_type, message_sid, status FROM ${SCHEMA}.sms_messages WHERE body = 'See you soon' ORDER BY created_at DESC LIMIT 1`,
      );
      expect(message?.body).toBe("See you soon");
      expect(message?.message_type).toBe("manual");
      expect(message?.status).toBe("queued");
      expect(message?.message_sid).toMatch(/^log-/);

      const block = host.first();
      await block.scrollIntoViewIfNeeded();
      const box = await block.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + 24, box!.y + 16);
      await page.mouse.down();
      await page.mouse.move(box!.x + 24, box!.y + 140, { steps: 12 });
      await page.mouse.up();
      await expect(page.getByRole("heading", { name: "Move and notify the client?" })).toBeVisible();
      await page.getByRole("button", { name: "Don't move" }).click();
      await expect(page.getByRole("heading", { name: "Move and notify the client?" })).toBeHidden();

      await dock.getByRole("button", { name: "Close", exact: true }).click();

      await week.click();
      await expectCalendarView(page, "Week");
      await expectResponsiveNavigation(page, "Week");
      await month.click();
      await expectCalendarView(page, "Month");
      await expectResponsiveNavigation(page, "Month");

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTestId("agenda-list")).toBeVisible();
      await expect(page.getByRole("button", { name: /E2E Host Client/ })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("calendar-agenda-phone.png"),
        fullPage: false,
      });
    } finally {
      await sql.unsafe(
        `DELETE FROM ${SCHEMA}.appointment_resources WHERE resource_id IN (SELECT id FROM ${SCHEMA}.resources WHERE name = '${ROOM}')`,
      );
      await sql.unsafe(`DELETE FROM ${SCHEMA}.resources WHERE name = '${ROOM}'`);
      await sql.unsafe(
        `UPDATE ${SCHEMA}.appointments SET checked_in_at = NULL WHERE client_id = '${HOST_CLIENT_ID}'`,
      );
      if (originalTimezone) {
        await sql.unsafe(
          `UPDATE ${SCHEMA}.business_settings SET timezone = $1`,
          [originalTimezone],
        );
      }
      await sql.end();
    }
  });
});
