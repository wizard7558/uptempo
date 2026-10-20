"use client";

import { useEffect } from "react";

/**
 * Starts PostHog on public pages without importing the provider module up
 * front. That module is shared with the signed-in app, and a static import
 * makes a marketing page request the scripts of every route that shares it.
 * The import below runs after hydration, like the provider's own effect.
 */
export function PostHogLazy() {
  useEffect(() => {
    void import("./posthog-provider").then(({ startPostHog }) => startPostHog());
  }, []);
  return null;
}
