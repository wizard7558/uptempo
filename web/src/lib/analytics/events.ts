/**
 * Server-side analytics event tracking.
 *
 * Provider-agnostic: logs structured events to stdout (Vercel Logs) and
 * optionally forwards to PostHog. Each user gets a stable distinct_id
 * (their Better Auth user.id UUID) so actions can be tied to revenue
 * and post-signup behavior.
 *
 * To enable PostHog: set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN and NEXT_PUBLIC_POSTHOG_HOST env vars.
 */

type EventProperties = Record<string, string | number | boolean | null | undefined>;

interface AnalyticsEvent {
  event: string;
  properties: EventProperties;
  timestamp: string;
  distinctId: string;
  tenantSlug?: string;
}

/**
 * Track a server-side analytics event.
 * Fire-and-forget — never throws or blocks the caller.
 */
export function trackEvent(
  event: string,
  properties: EventProperties = {},
  context?: { tenantSlug?: string; userId?: string },
): void {
  const distinctId = context?.userId || context?.tenantSlug || "anonymous";
  const analyticsEvent: AnalyticsEvent = {
    event,
    distinctId,
    properties,
    timestamp: new Date().toISOString(),
    tenantSlug: context?.tenantSlug,
  };

  // Always log to stdout (Vercel Logs / structured logging)
  console.log("[analytics]", JSON.stringify(analyticsEvent));

  // Forward to PostHog if configured
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (apiKey) {
    forwardToPostHog(apiKey, analyticsEvent).catch(() => {});
  }
}

/**
 * Identify a user — call on signup and login to associate the user's
 * UUID with their profile properties for attribution and cohort analysis.
 */
export function identifyUser(
  userId: string,
  traits: { email?: string; name?: string; tenantSlug?: string; role?: string },
): void {
  console.log("[analytics:identify]", JSON.stringify({ userId, ...traits, timestamp: new Date().toISOString() }));

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (apiKey) {
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com";
    fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "$identify",
        distinct_id: userId,
        $set: {
          email: traits.email,
          name: traits.name,
          tenant_slug: traits.tenantSlug,
          role: traits.role,
        },
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  }
}

async function forwardToPostHog(apiKey: string, event: AnalyticsEvent): Promise<void> {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com";
  await fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: event.event,
      distinct_id: event.distinctId,
      properties: {
        ...event.properties,
        tenant_slug: event.tenantSlug,
        $lib: "uptempo-server",
      },
      timestamp: event.timestamp,
    }),
  });
}
