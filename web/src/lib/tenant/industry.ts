import { getVertical, MODULE_IDS } from "@/lib/verticals";
import type { ModuleId, VerticalId, VerticalTerms } from "@/lib/verticals";
import { getTenantBySlug } from "@/lib/tenant/registry";

const KNOWN_MODULES: ReadonlySet<string> = new Set(MODULE_IDS);

/**
 * Keeps only known module ids from a raw `tenants.modules` value. Non-arrays
 * yield []; unknown or non-string entries and duplicates are dropped.
 */
export function sanitizeModules(raw: unknown): ModuleId[] {
  if (!Array.isArray(raw)) return [];
  const out: ModuleId[] = [];
  for (const item of raw) {
    if (
      typeof item === "string" &&
      KNOWN_MODULES.has(item) &&
      !out.includes(item as ModuleId)
    ) {
      out.push(item as ModuleId);
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merges tenant terminology overrides over a pack's terms. Only keys that
 * exist in `base` are honored, and a value must match the base's shape (string
 * for strings, object for { one, other }); anything else is ignored.
 */
export function mergeTerms(
  base: VerticalTerms,
  overrides: unknown,
): VerticalTerms {
  const merge = (b: unknown, o: unknown): unknown => {
    if (isPlainObject(b)) {
      if (!isPlainObject(o)) return b;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(b)) {
        result[key] = key in o ? merge(b[key], o[key]) : b[key];
      }
      return result;
    }
    return typeof o === "string" && o.trim() !== "" ? o : b;
  };
  return merge(base, overrides) as VerticalTerms;
}

/** The tenant's industry pack id; unknown or missing values map to "general". */
export async function getTenantIndustry(slug: string): Promise<VerticalId> {
  const tenant = await getTenantBySlug(slug);
  return getVertical(tenant?.industry).id;
}

/** The tenant's enabled modules, with unknown ids filtered out. */
export async function getTenantModules(slug: string): Promise<ModuleId[]> {
  const tenant = await getTenantBySlug(slug);
  return sanitizeModules(tenant?.modules);
}

/** The pack's terms with the tenant's `terminology` overrides applied. */
export async function getTenantTerms(slug: string): Promise<VerticalTerms> {
  const tenant = await getTenantBySlug(slug);
  return mergeTerms(getVertical(tenant?.industry).terms, tenant?.terminology);
}
