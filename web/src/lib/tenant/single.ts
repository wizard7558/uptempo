import { asc } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema/tenants";

const NULL_TTL_MS = 5_000;

let cachedSlug: string | null | undefined;
let nullCachedAt = 0;

export async function queryFirstTenantSlug(): Promise<string | null> {
  const [row] = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .orderBy(asc(tenants.createdAt))
    .limit(1);
  return row?.slug ?? null;
}

/** Found slugs stay for the process. A missing tenant is cached for 5 seconds. */
export async function getSingleTenantSlug(): Promise<string | null> {
  if (cachedSlug) return cachedSlug;
  if (cachedSlug === null && Date.now() - nullCachedAt < NULL_TTL_MS) return null;

  const slug = await queryFirstTenantSlug();
  if (slug) {
    cachedSlug = slug;
    return slug;
  }
  cachedSlug = null;
  nullCachedAt = Date.now();
  return null;
}

export function rememberSingleTenantSlug(slug: string): void {
  cachedSlug = slug;
}

export function clearSingleTenantSlugCache(): void {
  cachedSlug = undefined;
  nullCachedAt = 0;
}
