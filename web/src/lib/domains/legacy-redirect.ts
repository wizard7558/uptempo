/**
 * Canonical host redirects onto `https://www.bookuptempo.com`.
 *
 * Apex `bookuptempo.com` 308s to the www host so cookies and emailed links
 * share one origin. `www.bookuptempo.com` is absent from the redirect set
 * on purpose.
 *
 * A few server callbacks do not follow redirects, so they stay on the host
 * that received them. Stripe, Twilio, LoopMessage, and Vercel cron are
 * exempt. Apple association files stay on the requested host too.
 */

/** Canonical origin. Every redirect lands here. */
export const NEW_PRIMARY_ORIGIN = "https://www.bookuptempo.com";

/**
 * Hosts that should not serve the app themselves.
 * `www.bookuptempo.com` is absent on purpose.
 */
const REDIRECT_HOSTS = new Set(["bookuptempo.com"]);

/**
 * Path prefixes left on the incoming host. A prefix matches exactly or as
 * `/prefix/...`.
 */
const EXEMPT_PREFIXES = [
  "/api/stripe",
  "/api/twilio",
  "/api/cron",
  "/api/loopmessage",
  "/.well-known",
] as const;

function isExemptPath(pathname: string): boolean {
  if (pathname === "/apple-app-site-association") return true;
  return EXEMPT_PREFIXES.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

/**
 * Given the incoming host header, pathname, and search string, return the
 * absolute URL to redirect to, or `null` when the request should be handled
 * in place.
 *
 * @param host - Raw `Host` header value (may include a port, may be null).
 * @param pathname - Request pathname (e.g. `/book/demo-salon`).
 * @param search - Request search string including the leading `?`, or `""`.
 */
export function legacyRedirectTarget(
  host: string | null | undefined,
  pathname: string,
  search: string,
): string | null {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  if (!REDIRECT_HOSTS.has(hostname)) return null;
  if (isExemptPath(pathname)) return null;
  return `${NEW_PRIMARY_ORIGIN}${pathname}${search}`;
}
