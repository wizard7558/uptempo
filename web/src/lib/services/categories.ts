import { hairSalon } from "@/lib/verticals/hair-salon";

export type ServiceCategory =
  | "cut"
  | "color"
  | "extensions"
  | "style"
  | "treatment"
  | "addon"
  | "other";

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
