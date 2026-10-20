import { hairSalon } from "@/lib/verticals/hair-salon";
import { getVertical } from "@/lib/verticals";

export type ServiceCategory =
  | "cut"
  | "color"
  | "extensions"
  | "style"
  | "treatment"
  | "addon"
  | "other";

export interface ServiceCategoryOption {
  slug: string;
  name: string;
}

export interface TenantServiceCategory extends ServiceCategoryOption {
  isDefault: boolean;
  isActive: boolean;
}

export const SERVICE_CATEGORY_OPTIONS = hairSalon.categories.map((c) => ({
  value: c.slug as ServiceCategory,
  label: c.name,
}));

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> =
  SERVICE_CATEGORY_OPTIONS.reduce(
    (acc, option) => {
      acc[option.value] = option.label;
      return acc;
    },
    {} as Record<ServiceCategory, string>,
  );

export function formatServiceCategory(category: string | null | undefined) {
  if (!category) return "Other";
  return SERVICE_CATEGORY_LABELS[category as ServiceCategory] ?? "Other";
}

/**
 * Legacy salon category rows are hidden from other industries only when they
 * are still untouched pack defaults. The caller supplies referenced slugs so
 * categories in use by any service remain available.
 */
export function getSuppressibleLegacyCategorySlugs(
  categories: readonly TenantServiceCategory[],
  industry: string | null | undefined,
): string[] {
  const packSlugs = new Set(getVertical(industry).categories.map((c) => c.slug));
  const legacyNames = new Map(hairSalon.categories.map((c) => [c.slug, c.name]));

  return categories
    .filter(
      (category) =>
        category.slug !== "other" &&
        category.isDefault &&
        legacyNames.get(category.slug) === category.name &&
        !packSlugs.has(category.slug),
    )
    .map((category) => category.slug);
}

export function filterServiceCategoriesForIndustry(
  categories: readonly TenantServiceCategory[],
  industry: string | null | undefined,
  referencedSlugs: ReadonlySet<string> = new Set(),
): TenantServiceCategory[] {
  const suppressible = new Set(
    getSuppressibleLegacyCategorySlugs(categories, industry).filter(
      (slug) => !referencedSlugs.has(slug),
    ),
  );
  return categories.filter((category) => !suppressible.has(category.slug));
}

/** Prefer tenant labels; keep an unknown service slug readable in the UI. */
export function formatTenantServiceCategory(
  category: string | null | undefined,
  options: readonly ServiceCategoryOption[],
): string {
  if (!category) return "Other";
  const known = options.find((option) => option.slug === category);
  if (known) return known.name;

  const readable = category
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return readable || "Other";
}
