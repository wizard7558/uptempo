import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSingleMode } from "@/lib/config/mode";
import { legacyRedirectTarget } from "@/lib/domains/legacy-redirect";
import { getDomainMapReader } from "@/lib/providers/domain-map/reader";

const SINGLE_MODE_HIDDEN = [
  "/signup",
  "/discover",
  "/pricing",
  "/for",
  "/waitlist",
  "/quiz",
  "/create-my-business",
  "/create-my-salon",
  "/components",
  "/mockups",
];

const TENANT_HEADER = "x-tenant-slug";

/**
 * API routes, framework internals, and files never resolve a tenant from the
 * path. They still run through middleware so a client-supplied tenant header
 * is removed before a handler can read it.
 */
function isUnresolvedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/public") ||
    /\.[^/]*$/.test(pathname)
  );
}

/**
 * Forward the request with any client-supplied `x-tenant-slug` removed, and
 * set it only to the slug this middleware resolved itself. `getTenantSlug`
 * trusts this header ahead of the signed-in user, so only middleware may write it.
 */
function forwardWithTenant(
  request: NextRequest,
  slug: string | null,
  rewriteTo?: URL,
) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TENANT_HEADER);
  if (slug) requestHeaders.set(TENANT_HEADER, slug);
  return rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // The bookuptempo.com apex 308s to www.bookuptempo.com before tenant
  // resolution. This runs ahead of the /api early return so /api/auth follows
  // the canonical host. Webhook paths return null and stay.
  const legacyTarget = legacyRedirectTarget(
    request.headers.get("host"),
    pathname,
    request.nextUrl.search,
  );
  if (legacyTarget) {
    return NextResponse.redirect(legacyTarget, 308);
  }

  if (isUnresolvedPath(pathname)) {
    return forwardWithTenant(request, null);
  }

  const hostname = request.headers.get("host")?.split(":")[0] || "";
  const primaryRootDomain = (process.env.ROOT_DOMAIN || "bookuptempo.com").trim();
  // bookuptempo.com is the canonical brand root; it stays recognized as a
  // platform root even when ROOT_DOMAIN is overridden per environment.
  const rootDomains = new Set([primaryRootDomain, "bookuptempo.com"]);
  const isRootDomain =
    rootDomains.has(hostname) ||
    [...rootDomains].some((domain) => hostname === `www.${domain}`);

  if (isSingleMode()) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/single-home";
      return NextResponse.rewrite(url);
    }
    if (
      SINGLE_MODE_HIDDEN.some(
        (path) => pathname === path || pathname.startsWith(`${path}/`),
      )
    ) {
      return NextResponse.redirect(new URL("/", request.url), 307);
    }
  }

  let slug: string | null = null;

  // www.bookuptempo.com is the canonical host. The apex is redirected above.
  // Custom domains are not.

  // 2) Custom domain lookup via Edge Config (for salons with their own domains)
  if (
    !isRootDomain &&
    !hostname.includes("localhost") &&
    !hostname.includes("vercel.app")
  ) {
    slug = await getDomainMapReader().lookup(hostname);

    // Custom domain root → rewrite to booking page
    if (slug && pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = `/book/${slug}`;
      return forwardWithTenant(request, slug, url);
    }
  }

  // 3) Path-based booking: /book/:slug, /subscribe/:slug, /store/:slug, /q/:slug (walk-in line) or /gift/:slug
  if (!slug) {
    const tenantPathMatch = pathname.match(
      /^\/(?:book|subscribe|store|q|gift)\/([a-z0-9][a-z0-9-]*[a-z0-9])(?:\/|$)/,
    );
    if (tenantPathMatch) {
      slug = tenantPathMatch[1];
    }
  }

  // Always strips a spoofed header. Sets it only when this middleware resolved a slug.
  return forwardWithTenant(request, slug);
}

export const config = {
  // API routes are included so a spoofed `x-tenant-slug` is stripped before any
  // handler sees it. Static assets stay out of middleware.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
