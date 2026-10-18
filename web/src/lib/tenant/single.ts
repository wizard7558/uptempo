import { asc } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema/tenants";

const NULL_TTL_MS = 5_000;

// Next compiles server actions and pages into separate bundles, each with its
// own copy of this module. Keep the cache on globalThis so a slug remembered by
// the setup action is seen by the page that redirects `/` right afterwards,
// instead of that page serving a stale "no tenant" for up to 5 seconds.
interface SingleSlugCache {
  slug: string | null | undefined;
  nullCachedAt: number;
}
const globalCache = globalThis as typeof globalThis & {
  __uptempoSingleSlugCache?: SingleSlugCache;
};
const cache: SingleSlugCache = (globalCache.__uptempoSingleSlugCache ??= {
  slug: undefined,
  nullCachedAt: 0,
});

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
  if (cache.slug) return cache.slug;
  if (cache.slug === null && Date.now() - cache.nullCachedAt < NULL_TTL_MS) return null;

  const slug = await queryFirstTenantSlug();
  if (slug) {
    cache.slug = slug;
    return slug;
  }
  cache.slug = null;
  cache.nullCachedAt = Date.now();
  return null;
}

export function rememberSingleTenantSlug(slug: string): void {
  cache.slug = slug;
}

export function clearSingleTenantSlugCache(): void {
  cache.slug = undefined;
  cache.nullCachedAt = 0;
}
