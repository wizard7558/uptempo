import { listVerticals, type Vertical, type VerticalId } from "@/lib/verticals";

export type MarketingIndustryId = Exclude<VerticalId, "general">;

/** Seeded demo business per industry (scripts/seed-demo-accounts.ts). */
export const DEMO_BUSINESS_SLUGS: Partial<Record<MarketingIndustryId, string>> = {
  hair_salon: "demo-salon",
  barber: "demo-barber",
  nail_salon: "demo-nails",
  tattoo: "demo-tattoo",
  massage_wellness: "demo-massage",
  personal_training: "demo-studio",
};

export const CALENDAR_DEMO_SLUG = "demo-salon";

export function industrySlug(id: MarketingIndustryId): string {
  return id.replace(/_/g, "-");
}

export function marketingIndustries(): (Vertical & { id: MarketingIndustryId })[] {
  return listVerticals().filter(
    (vertical): vertical is Vertical & { id: MarketingIndustryId } => vertical.id !== "general",
  );
}

export function industryFromSlug(slug: string): (Vertical & { id: MarketingIndustryId }) | null {
  return marketingIndustries().find((vertical) => industrySlug(vertical.id) === slug) ?? null;
}

/** Path of the booking-page screenshot that capture-screenshots.ts writes for an industry. */
export function bookingScreenshot(id: MarketingIndustryId): string | null {
  return DEMO_BUSINESS_SLUGS[id] ? `/marketing/booking-${industrySlug(id)}.png` : null;
}

export const CALENDAR_SCREENSHOT = "/marketing/calendar-week.png";

/** CSS pixels. The calendar shot is the 1024px main column of a 1280x800 window, without the sidebar. */
export const SCREENSHOT_SIZES = {
  booking: { width: 390, height: 844 },
  calendar: { width: 1024, height: 800 },
} as const;
