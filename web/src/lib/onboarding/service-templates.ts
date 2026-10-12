import { HAIR_SALON_ONBOARDING_TEMPLATES } from "@/lib/verticals/hair-salon";

export interface ServiceTemplate {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  priceCents: number;
  category: "cut" | "color" | "extensions" | "style" | "treatment" | "other";
  /** A group class; seats come from `capacity`. */
  isClass?: boolean;
  capacity?: number;
}

/** Column values for one template when it is seeded as a service. */
export function templateToServiceRow(t: ServiceTemplate) {
  return {
    name: t.name,
    defaultDurationMinutes: t.defaultDurationMinutes,
    priceCents: t.priceCents,
    category: t.category,
    isClass: t.isClass ? 1 : 0,
    classCapacity: t.capacity ?? null,
  };
}

export const SERVICE_TEMPLATES: ServiceTemplate[] = HAIR_SALON_ONBOARDING_TEMPLATES;
