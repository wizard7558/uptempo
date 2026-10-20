import { AuthError } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { createTermsT } from "@/lib/terms/translator";
import { getVertical, type Vertical } from "@/lib/verticals";
import { DAY_NAMES } from "@/lib/scheduling/week";
import { asc, eq } from "drizzle-orm";

const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60] as const;

export type OnboardingServiceRow = {
  id: string;
  name: string;
  minutes: number;
  priceCents: number | null;
  active: boolean;
};

export type OnboardingReview = {
  businessName: string;
  phone: string;
  address: string;
  services: OnboardingServiceRow[];
  hoursSummary: string;
  policyText: string;
  forms: { id: string; name: string }[];
  theme: {
    brandColor: string;
    fontPairing: string;
    cornerStyle: string;
    density: string;
    colorMode: string;
  } | null;
};

type ReviewCopy = {
  starterHours: string;
  hoursMissing: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function slotInterval(minutes: number): number {
  return (SLOT_INTERVALS as readonly number[]).includes(minutes) ? minutes : 15;
}

function field(
  id: string,
  label: string,
  type: "text" | "signature" = "text",
) {
  return { id, type, label, required: true };
}

function formsForPack(pack: Vertical) {
  const t = createTermsT(pack.terms, "onboarding");
  const rows: {
    name: string;
    kind: "intake" | "consent";
    fields: ReturnType<typeof field>[];
    minAge?: number;
    requiresId?: number;
  }[] = [];

  if (pack.clientFields.length > 0) {
    rows.push({
      name: t("clientForm"),
      kind: "intake",
      fields: pack.clientFields.map((item) => field(item.key, item.label)),
    });
  }
  if (pack.requestFields && pack.requestFields.length > 0) {
    rows.push({
      name: t("requestForm"),
      kind: "intake",
      fields: pack.requestFields.map((label) => field(label, label)),
    });
  }
  if (pack.modules.includes("consent_id")) {
    rows.push({
      name: t("consentForm"),
      kind: "consent",
      minAge: 18,
      requiresId: 1,
      fields: [field("signature", t("signature"), "signature")],
    });
  }
  if (rows.length === 0) {
    rows.push({
      name: t("visitNotesName"),
      kind: "intake",
      fields: [field("notes", t("visitNotesField"))],
    });
  }
  return rows;
}

function summarizeHours(
  rows: { dayOfWeek: number; startTime: string; endTime: string; isEnabled: number }[],
  copy: ReviewCopy,
): string {
  const enabled = rows.filter((row) => row.isEnabled === 1);
  const days = new Set(enabled.map((row) => row.dayOfWeek));
  const starter =
    [1, 2, 3, 4, 5, 6].every((day) => days.has(day)) &&
    !days.has(0) &&
    enabled.every(
      (row) => row.startTime.startsWith("09:00") && row.endTime.startsWith("17:00"),
    );
  if (starter) return copy.starterHours;
  if (enabled.length === 0) return copy.hoursMissing;
  return enabled
    .map((row) => `${DAY_NAMES[row.dayOfWeek]} ${row.startTime.slice(0, 5)} to ${row.endTime.slice(0, 5)}`)
    .join(". ");
}

/**
 * Fills an empty tenant schema from its industry pack. Safe to call again:
 * each group is inserted only when that group is still empty.
 */
export async function seedIndustryPack(slug: string, ownerUserId: string): Promise<void> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return;
  const pack = getVertical(tenant.industry);
  const policyText = createTermsT(pack.terms, "onboarding")("policySeed", {
    hours: "24",
    late: "50",
    noShow: "100",
  });

  await withTenantDb(slug, async (db, tables) => {
    const {
      staff,
      locations,
      workingHours,
      serviceCategories,
      services,
      staffServices,
      businessSettings,
      formTemplates,
      brandingSettings,
    } = tables;

    const [owner] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.userId, ownerUserId))
      .limit(1);
    if (!owner) return;

    const [existingLocation] = await db
      .select({ id: locations.id })
      .from(locations)
      .limit(1);
    let locationId = existingLocation?.id;
    if (!locationId) {
      const [created] = await db
        .insert(locations)
        .values({ name: tenant.name, address: null })
        .returning({ id: locations.id });
      locationId = created.id;
    }

    const [existingHour] = await db
      .select({ id: workingHours.id })
      .from(workingHours)
      .limit(1);
    if (!existingHour) {
      await db.insert(workingHours).values(
        [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          staffId: owner.id,
          dayOfWeek,
          locationId,
          startTime: "09:00",
          endTime: "17:00",
          isEnabled: 1,
        })),
      );
    }

    const existingCategories = await db
      .select({ slug: serviceCategories.slug })
      .from(serviceCategories);
    const have = new Set(existingCategories.map((row) => row.slug));
    const missingCategories = pack.categories.filter((category) => !have.has(category.slug));
    if (missingCategories.length > 0) {
      await db
        .insert(serviceCategories)
        .values(
          missingCategories.map((category, index) => ({
            slug: category.slug,
            name: category.name,
            sortOrder: index,
            isDefault: 1,
            isActive: 1,
          })),
        )
        .onConflictDoNothing();
    }

    const existingServices = await db.select({ id: services.id }).from(services);
    if (existingServices.length === 0 && pack.serviceTemplates.length > 0) {
      const inserted = await db
        .insert(services)
        .values(
          pack.serviceTemplates.map((template) => ({
            name: template.name,
            description: template.description ?? null,
            defaultDurationMinutes: template.minutes,
            priceCents: template.priceCents,
            category: template.category,
            activeMinutes: template.activeMinutes ?? null,
            processingMinutes: template.processingMinutes ?? null,
            bufferAfterMin: clamp(pack.defaults.bufferAfterMinutes, 0, 240),
            depositType: template.deposit?.type ?? null,
            depositAmount: template.deposit?.amount ?? null,
            isClass: template.isClass ? 1 : 0,
            classCapacity: template.capacity ?? null,
          })),
        )
        .returning({ id: services.id });
      if (inserted.length > 0) {
        await db.insert(staffServices).values(
          inserted.map((service) => ({
            staffId: owner.id,
            serviceId: service.id,
          })),
        );
      }
    } else if (existingServices.length > 0) {
      const [link] = await db
        .select({ id: staffServices.id })
        .from(staffServices)
        .limit(1);
      if (!link) {
        await db.insert(staffServices).values(
          existingServices.map((service) => ({
            staffId: owner.id,
            serviceId: service.id,
          })),
        );
      }
    }

    const [policy] = await db
      .select({ id: businessSettings.id })
      .from(businessSettings)
      .limit(1);
    if (!policy) {
      await db.insert(businessSettings).values({
        timezone: tenant.timezone,
        cancellationWindowHours: 24,
        cancellationFeePercent: 50,
        noShowFeePercent: 100,
        minNoticeMinutes: clamp(pack.defaults.minNoticeHours * 60, 0, 20160),
        maxAdvanceDays: clamp(pack.defaults.maxAdvanceDays, 1, 730),
        slotIntervalMinutes: slotInterval(pack.defaults.slotIntervalMinutes),
        sameDayBooking: 1,
        requireCardOnFile: 1,
        policyText,
      });
    }

    const [existingForm] = await db
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .limit(1);
    if (!existingForm) {
      await db.insert(formTemplates).values(formsForPack(pack));
    }

    const [branding] = await db
      .select({ id: brandingSettings.id })
      .from(brandingSettings)
      .limit(1);
    if (!branding) {
      await db.insert(brandingSettings).values({
        brandColor: "#B3122E",
        fontPairing: "score",
        cornerStyle: "soft",
        density: "comfortable",
        colorMode: "light",
      });
    }
  });
}

export async function loadOnboardingReview(
  slug: string,
  ownerUserId: string,
  businessName: string,
  copy: ReviewCopy,
): Promise<OnboardingReview | null> {
  try {
    return await withTenantDb(slug, async (db, tables) => {
      const { staff, locations, services, workingHours, businessSettings, formTemplates, brandingSettings } =
        tables;
      const [owner] = await db
        .select({ phone: staff.phone })
        .from(staff)
        .where(eq(staff.userId, ownerUserId))
        .limit(1);
      const [location] = await db
        .select({ address: locations.address })
        .from(locations)
        .orderBy(asc(locations.createdAt))
        .limit(1);
      const serviceRows = await db
        .select({
          id: services.id,
          name: services.name,
          minutes: services.defaultDurationMinutes,
          priceCents: services.priceCents,
          isActive: services.isActive,
        })
        .from(services)
        .orderBy(asc(services.name));
      const hourRows = await db
        .select({
          dayOfWeek: workingHours.dayOfWeek,
          startTime: workingHours.startTime,
          endTime: workingHours.endTime,
          isEnabled: workingHours.isEnabled,
        })
        .from(workingHours);
      const [policy] = await db
        .select({ policyText: businessSettings.policyText })
        .from(businessSettings)
        .limit(1);
      const formRows = await db
        .select({ id: formTemplates.id, name: formTemplates.name })
        .from(formTemplates)
        .orderBy(asc(formTemplates.createdAt));
      const [theme] = await db
        .select({
          brandColor: brandingSettings.brandColor,
          fontPairing: brandingSettings.fontPairing,
          cornerStyle: brandingSettings.cornerStyle,
          density: brandingSettings.density,
          colorMode: brandingSettings.colorMode,
        })
        .from(brandingSettings)
        .limit(1);

      return {
        businessName,
        phone: owner?.phone ?? "",
        address: location?.address ?? "",
        services: serviceRows.map((row) => ({
          id: row.id,
          name: row.name,
          minutes: row.minutes,
          priceCents: row.priceCents,
          active: row.isActive === 1,
        })),
        hoursSummary: summarizeHours(hourRows, copy),
        policyText: policy?.policyText ?? "",
        forms: formRows,
        theme: theme ?? null,
      };
    });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return null;
  }
}
