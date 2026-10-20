"use client";

import type { PostHog } from "posthog-js";
import { useEffect } from "react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com";

let client: Promise<PostHog | null> | null = null;

/**
 * posthog-js is about 60 KB gzipped, so it loads in its own chunk after
 * hydration instead of in every page's first-load bundle. Calls made before
 * it loads wait for it.
 */
function loadPostHog(): Promise<PostHog | null> {
  if (!POSTHOG_KEY || typeof window === "undefined") return Promise.resolve(null);
  const key = POSTHOG_KEY;
  client ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false, // we track events explicitly
    });
    return posthog;
  });
  return client;
}

/** Starts PostHog without wrapping anything. Used by `PostHogLazy`. */
export function startPostHog(): void {
  void loadPostHog();
}

/**
 * Initialize PostHog on the client. Generates an anonymous UUID for
 * unidentified users automatically. When identify() is called later,
 * PostHog merges all prior anonymous events with the real user.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void loadPostHog();
  }, []);

  return <>{children}</>;
}

/**
 * Call this when a user is identified (login, signup, booking verification).
 * PostHog will merge all anonymous session data to this user's profile.
 */
export function identifyPostHogUser(
  userId: string,
  traits?: { email?: string; name?: string; tenantSlug?: string; role?: string },
) {
  void loadPostHog().then((posthog) =>
    posthog?.identify(userId, {
      email: traits?.email,
      name: traits?.name,
      tenant_slug: traits?.tenantSlug,
      role: traits?.role,
    }),
  );
}

/**
 * Reset PostHog identity (call on logout).
 */
export function resetPostHogUser() {
  void loadPostHog().then((posthog) => posthog?.reset());
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
  void loadPostHog().then((posthog) => posthog?.capture(event, merged));
  forwardToGA4(event, merged);
}
