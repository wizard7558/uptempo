"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, useState } from "react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com";

/**
 * Initialize PostHog on the client. Generates an anonymous UUID for
 * unidentified users automatically. When identify() is called later,
 * PostHog merges all prior anonymous events with the real user.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!POSTHOG_KEY) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false, // we track events explicitly
    });
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;

  // posthog-js/react context is not safe during static prerender (e.g. /404); hydrate first.
  if (!mounted) return <>{children}</>;

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

/**
 * Call this when a user is identified (login, signup, booking verification).
 * PostHog will merge all anonymous session data to this user's profile.
 */
export function identifyPostHogUser(
  userId: string,
  traits?: { email?: string; name?: string; tenantSlug?: string; role?: string },
) {
  if (typeof window === "undefined") return;
  posthog.identify(userId, {
    email: traits?.email,
    name: traits?.name,
    tenant_slug: traits?.tenantSlug,
    role: traits?.role,
  });
}

/**
 * Reset PostHog identity (call on logout).
 */
export function resetPostHogUser() {
  if (typeof window === "undefined") return;
  posthog.reset();
}

/**
 * Extract UTM parameters from the current URL or localStorage.
 * Captures first-touch (stored in localStorage on first visit)
 * and last-touch (current URL params) for multi-touch attribution.
 */
function getUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const current: Record<string, string> = {};

  for (const key of utmKeys) {
    const val = params.get(key);
    if (val) current[key] = val;
  }

  // Store first-touch UTMs on first visit with UTMs
  if (Object.keys(current).length > 0) {
    const existing = localStorage.getItem("_first_touch_utm");
    if (!existing) {
      localStorage.setItem("_first_touch_utm", JSON.stringify(current));
    }
  }

  // Build attribution object
  const result: Record<string, string> = {};
  const firstTouch = localStorage.getItem("_first_touch_utm");
  if (firstTouch) {
    const ft = JSON.parse(firstTouch) as Record<string, string>;
    for (const [k, v] of Object.entries(ft)) {
      result[`first_touch_${k}`] = v;
    }
  }
  for (const [k, v] of Object.entries(current)) {
    result[`last_touch_${k}`] = v;
  }

  return result;
}

/**
 * Forward an event to GA4 via gtag if available.
 */
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function forwardToGA4(
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
) {
  if (typeof window === "undefined" || !window.gtag) return;

  // GA4 event names: lowercase, underscores, max 40 chars
  const ga4Event = event.replace(/\./g, "_").slice(0, 40);
  const params: Record<string, string | number | boolean> = {};
  if (properties) {
    for (const [k, v] of Object.entries(properties)) {
      if (v != null) params[k] = v;
    }
  }
  window.gtag("event", ga4Event, params);
}

/**
 * Track a client-side event. Automatically attaches UTM parameters
 * for multi-touch attribution on conversion events.
 * Fires to both PostHog and GA4.
 */
export function trackClientEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
) {
  if (typeof window === "undefined") return;
  const merged = { ...getUtmParams(), ...properties };
  posthog.capture(event, merged);
  forwardToGA4(event, merged);
}
