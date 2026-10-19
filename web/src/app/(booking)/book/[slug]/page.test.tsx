import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

type SearchQuery = Record<string, string | string[] | undefined>;
type BookingPageContentProps = { slug: string; query: SearchQuery };
type WizardProps = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => [{ displayName: "Avery Quinn" }]),
  };
  query.select.mockReturnValue(query);
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);

  const tables = {
    staff: { id: {}, displayName: {} },
    locations: { isActive: {}, id: {}, name: {} },
  };

  return {
    BookingPageSkeleton: vi.fn(() => null),
    BookingWizard: vi.fn(() => null),
    ClassScheduleCard: vi.fn(() => null),
    RequestWizard: vi.fn(() => null),
    businessPageMetadata: vi.fn(async () => ({})),
    clearBookingSession: vi.fn(async () => undefined),
    eq: vi.fn(() => ({})),
    getBookingBrandingCached: vi.fn(async () => null),
    getBookingSession: vi.fn(async () => null as string | null),
    getBookingVerificationChannel: vi.fn(() => "email"),
    getBusinessBySlugCached: vi.fn(async () => ({ id: "business-1", name: "Fade Co" })),
    getBusinessSettingsForTenant: vi.fn(async () => ({ timezone: "America/Los_Angeles", requireCardOnFile: 0 })),
    getPublicBookingFlow: vi.fn(async () => "book"),
    getStaffServices: vi.fn(async () => ({
      services: [
        { serviceId: "service-cut", serviceName: "Cut", durationMinutes: 30 },
        { serviceId: "service-color", serviceName: "Color", durationMinutes: 60 },
      ],
    })),
    getT: vi.fn(async () => (key: string) => key),
    getTenantBySlug: vi.fn(async () => null),
    getTenantSlug: vi.fn(async () => "fade-co"),
    hasModule: vi.fn(async () => false),
    hasUpcomingClasses: vi.fn(async () => false),
    isBookingPageOpen: vi.fn(() => true),
    isTenantProvisioned: vi.fn(async () => true),
    loadRequestWizardProps: vi.fn(async () => ({})),
    notFound: vi.fn(() => undefined),
    redirect: vi.fn(() => undefined),
    withTenantDb: vi.fn(async (
      tenantSlug: string,
      callback: (db: typeof query, schema: typeof tables) => Promise<unknown>,
    ) => {
      void tenantSlug;
      return callback(query, tables);
    }),
  };
});

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/actions/booking-public", () => ({ getStaffServices: mocks.getStaffServices }));
vi.mock("@/lib/booking/session-cookie", () => ({
  clearBookingSession: mocks.clearBookingSession,
  getBookingSession: mocks.getBookingSession,
}));
vi.mock("@/lib/policies/business-policy", () => ({ getBusinessSettingsForTenant: mocks.getBusinessSettingsForTenant }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: mocks.withTenantDb }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: mocks.getTenantSlug }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq }));
vi.mock("@/lib/booking/cached-lookups", () => ({
  getBookingBrandingCached: mocks.getBookingBrandingCached,
  getBusinessBySlugCached: mocks.getBusinessBySlugCached,
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: mocks.getTenantBySlug,
  isTenantProvisioned: mocks.isTenantProvisioned,
}));
vi.mock("@/lib/onboarding/state", () => ({ isBookingPageOpen: mocks.isBookingPageOpen }));
vi.mock("@/lib/terms/server", () => ({ getT: mocks.getT }));
vi.mock("@/lib/seo/tenant-metadata", () => ({ businessPageMetadata: mocks.businessPageMetadata }));
vi.mock("@/components/booking-public/page-skeletons", () => ({ BookingPageSkeleton: mocks.BookingPageSkeleton }));
vi.mock("./booking-wizard", () => ({ BookingWizard: mocks.BookingWizard }));
vi.mock("@/lib/requests/flow", () => ({ getPublicBookingFlow: mocks.getPublicBookingFlow }));
vi.mock("@/lib/requests/wizard-props", () => ({ loadRequestWizardProps: mocks.loadRequestWizardProps }));
vi.mock("@/components/booking-public/request-wizard", () => ({ RequestWizard: mocks.RequestWizard }));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: mocks.hasModule }));
vi.mock("@/lib/classes/public", () => ({ hasUpcomingClasses: mocks.hasUpcomingClasses }));
vi.mock("./classes/class-schedule", () => ({ ClassScheduleCard: mocks.ClassScheduleCard }));
vi.mock("@/lib/booking/verification-channel", () => ({
  getBookingVerificationChannel: mocks.getBookingVerificationChannel,
}));

import BookingPage from "./page";

async function getWizard(query: SearchQuery): Promise<ReactElement<WizardProps>> {
  const page = await BookingPage({
    params: Promise.resolve({ slug: "fade-co" }),
    searchParams: Promise.resolve(query),
  });
  const child = page.props.children as ReactElement<BookingPageContentProps>;
  const renderContent = child.type as (
    props: BookingPageContentProps,
  ) => Promise<ReactElement<WizardProps>>;
  return renderContent(child.props);
}

const prefillCases: { name: string; query: SearchQuery; expected: string | undefined }[] = [
  { name: "staff only", query: { staff: "staff-new" }, expected: "staff-new" },
  { name: "legacy stylist only", query: { stylist: "staff-legacy" }, expected: "staff-legacy" },
  { name: "both keys with staff taking precedence", query: { staff: "staff-new", stylist: "staff-legacy" }, expected: "staff-new" },
  { name: "array staff falling back to a string stylist", query: { staff: ["staff-array"], stylist: "staff-legacy" }, expected: "staff-legacy" },
  { name: "array values ignored", query: { staff: ["staff-array"], stylist: ["staff-legacy"] }, expected: undefined },
  { name: "absent keys ignored", query: {}, expected: undefined },
  { name: "empty staff preserving precedence", query: { staff: "", stylist: "staff-legacy" }, expected: "" },
];

describe("booking-page staff-prefill query compatibility", () => {
  it.each(prefillCases)("uses $name", async ({ query, expected }) => {
    const wizard = await getWizard(query);

    expect(wizard.props.prefillStaffId).toBe(expected);
  });

  it("keeps the existing service and reschedule prefills", async () => {
    const wizard = await getWizard({
      staff: "staff-new",
      stylist: "staff-legacy",
      services: "service-cut,service-color",
      reschedule: "appointment-42",
    });

    expect(wizard.props.prefillStaffId).toBe("staff-new");
    expect(wizard.props.prefillServiceIds).toEqual(["service-cut", "service-color"]);
    expect(wizard.props.reschedulingAppointmentId).toBe("appointment-42");
  });
});
