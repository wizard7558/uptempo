import { HAIR_SALON_ONBOARDING_TEMPLATES } from "@/lib/verticals/hair-salon";
import { getVertical } from "@/lib/verticals";

export interface ServiceTemplate {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  priceCents: number;
  category: string;
  description?: string;
  activeMinutes?: number;
  processingMinutes?: number;
  deposit?: { type: "fixed" | "percent"; amount: number };
  /** A group class; seats come from `capacity`. */
  isClass?: boolean;
  capacity?: number;
}

/** Column values for one template when it is seeded as a service. */
export function templateToServiceRow(t: ServiceTemplate) {
  const row: {
    name: string;
    defaultDurationMinutes: number;
    priceCents: number;
    category: string;
    isClass: number;
    classCapacity: number | null;
    description?: string;
    activeMinutes?: number;
    processingMinutes?: number;
    depositType?: "fixed" | "percent";
    depositAmount?: number;
  } = {
    name: t.name,
    defaultDurationMinutes: t.defaultDurationMinutes,
    priceCents: t.priceCents,
    category: t.category,
    isClass: t.isClass ? 1 : 0,
    classCapacity: t.capacity ?? null,
  };
  if (t.description !== undefined) row.description = t.description;
  if (t.activeMinutes !== undefined) row.activeMinutes = t.activeMinutes;
  if (t.processingMinutes !== undefined) {
    row.processingMinutes = t.processingMinutes;
  }
  if (t.deposit !== undefined) {
    row.depositType = t.deposit.type;
    row.depositAmount = t.deposit.amount;
  }
  return row;
}

export const SERVICE_TEMPLATES: ServiceTemplate[] = HAIR_SALON_ONBOARDING_TEMPLATES;

/** Returns onboarding templates for one pack with ids aligned to preset keys. */
export function getServiceTemplatesForIndustry(
  industry: string | null | undefined,
): ServiceTemplate[] {
  const vertical = getVertical(industry);
  if (vertical.id === "hair_salon") return SERVICE_TEMPLATES;

  return vertical.serviceTemplates.map((template) => {
    const mapped: ServiceTemplate = {
      id: `${vertical.id}:${encodeURIComponent(template.name)}`,
      name: template.name,
      defaultDurationMinutes: template.minutes,
      priceCents: template.priceCents,
      category: template.category,
    };
    if (template.description !== undefined) {
      mapped.description = template.description;
    }
    if (template.activeMinutes !== undefined) {
      mapped.activeMinutes = template.activeMinutes;
    }
    if (template.processingMinutes !== undefined) {
      mapped.processingMinutes = template.processingMinutes;
    }
    if (template.deposit !== undefined) mapped.deposit = template.deposit;
    if (template.isClass !== undefined) mapped.isClass = template.isClass;
    if (template.capacity !== undefined) mapped.capacity = template.capacity;
    return mapped;
  });
}
