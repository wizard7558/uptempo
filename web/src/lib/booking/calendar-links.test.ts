import { describe, it, expect } from "vitest";
import { generateCalendarLinks } from "./calendar-links";

describe("generateCalendarLinks", () => {
  const start = new Date("2026-04-08T13:00:00.000Z");
  const end = new Date("2026-04-08T13:30:00.000Z");

  it("embeds location into generated links when provided", () => {
    const location = "Primary Location - 100 Oak Ave";
    const links = generateCalendarLinks({
      staffName: "Alex",
      serviceSummary: "Haircut",
      start,
      end,
      businessName: "Test Salon",
      location,
    });

    expect(links.google.length).toBeGreaterThan(20);
    expect(links.google).toContain(encodeURIComponent("100 Oak"));
    expect(links.outlook.length).toBeGreaterThan(20);
    expect(links.ical.length).toBeGreaterThan(50);
    // iCal is URL-encoded in the data: URL
    expect(decodeURIComponent(links.ical)).toContain("100 Oak Ave");
  });

  it("works without location", () => {
    const links = generateCalendarLinks({
      staffName: "Alex",
      serviceSummary: "Haircut",
      start,
      end,
      businessName: "Test Salon",
      location: null,
    });
    expect(links.google).toContain("http");
    expect(links.ical).toContain("BEGIN:VCALENDAR");
  });
});
