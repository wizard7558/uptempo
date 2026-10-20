import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const SCHEMA = `"tenant_test-salon"`;
const ROOM = "Color Room";
const HOST_CLIENT_ID = "f0e2e201-0000-4000-8000-000000000001";

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
      await expect(page.getByRole("button", { name: "Day", exact: true })).toBeVisible({
        timeout: 15000,
      });
      const week = page.getByRole("button", { name: "Week", exact: true });
      await week.click();
      await expectCalendarView(page, "Week");
      const month = page.getByRole("button", { name: "Month", exact: true });
      await month.click();
      await expectCalendarView(page, "Month");
      await expect(page.getByText("Mon", { exact: true })).toBeVisible();
      const day = page.getByRole("button", { name: "Day", exact: true });
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
      await page.screenshot({
        path: testInfo.outputPath("calendar-day-desktop.png"),
        fullPage: false,
      });

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
