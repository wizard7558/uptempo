"use client";

import { isNativeApp } from "./client";

/**
 * Web-side glue that runs inside the Capacitor native shells. We reach the
 * Capacitor plugins through the runtime-injected `window.Capacitor` bridge
 * instead of importing `@capacitor/*` (those live in the native projects, not
 * in this web bundle). All functions are safe no-ops on the plain web.
 */

type PluginListener = { remove: () => void };
type PushPlugin = {
  requestPermissions?: () => Promise<{ receive: string }>;
  register?: () => Promise<void>;
  addListener?: (
    event: string,
    cb: (data: {
      value?: string;
      error?: string;
      notification?: { data?: Record<string, unknown> };
    }) => void,
  ) => Promise<PluginListener> | PluginListener;
};
type AppPlugin = {
  addListener?: (
    event: "appUrlOpen",
    cb: (data: { url: string }) => void,
  ) => Promise<PluginListener> | PluginListener;
};

function plugin<T>(name: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.[name] as T | undefined;
}

const TOKEN_STORAGE_KEY = "uptempo.apnsToken";

function apnsEnvironment(): "sandbox" | "production" {
  // The native build can set window.__APNS_ENV__ = "sandbox" for debug builds.
  const v = (window as unknown as { __APNS_ENV__?: string }).__APNS_ENV__;
  return v === "sandbox" ? "sandbox" : "production";
}

/**
 * Request push permission and register the device's APNs token with the
 * backend (`POST /api/push/register`). The token is delivered asynchronously
 * via the plugin's "registration" event. Uses the existing session cookie for
 * auth, so call this after the user is signed in.
 */
export async function registerNativePush(): Promise<void> {
  if (!isNativeApp()) return;
  const push = plugin<PushPlugin>("PushNotifications");
  if (!push?.register || !push.addListener) return;

  await push.addListener("registration", async (data) => {
    const apnsToken = data.value;
    if (!apnsToken) return;
    try {
      await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apnsToken, environment: apnsEnvironment() }),
      });
      // Remember the token so sign-out can revoke it for this account.
      localStorage.setItem(TOKEN_STORAGE_KEY, apnsToken);
    } catch {
      // Best-effort; the app will retry on next launch.
    }
  });

  await push.addListener("registrationError", () => {
    // Permission or APNs error — nothing to register.
  });

  // Tapping a notification deep-links into the app — the APNs payload carries
  // a `path` (e.g. "/schedule" for owner new-booking, "/account" for client
  // reminders).
  await push.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const path = notification?.data?.path;
    if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) {
      window.location.assign(path);
    }
  });

  const perm = await push.requestPermissions?.();
  if (perm && perm.receive !== "granted") return;
  await push.register();
}

/**
 * Revoke this device's push token on the backend. Call before signing out so
 * the next account on this device doesn't receive the previous account's
 * pushes. No-op on the web or when no token was ever registered. Must run
 * while the session cookie is still valid (i.e. before signOut).
 */
export async function revokeNativePush(): Promise<void> {
  if (!isNativeApp()) return;
  let apnsToken: string | null = null;
  try {
    apnsToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return;
  }
  if (!apnsToken) return;
  try {
    await fetch("/api/push/register", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apnsToken }),
    });
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Best-effort — the token is re-owned on the next sign-in registration.
  }
}

/**
 * Handle returns from the system browser (OAuth / Stripe Connect) that come
 * back via a custom URL scheme like `uptempo-owner://calendar-callback?...`.
 * Maps the deep-link host to the corresponding in-app web route and navigates
 * the WebView there.
 */
export async function handleNativeDeepLinks(): Promise<void> {
  if (!isNativeApp()) return;
  const app = plugin<AppPlugin>("App");
  if (!app?.addListener) return;

  await app.addListener("appUrlOpen", ({ url }) => {
    try {
      const parsed = new URL(url);
      // host is the deep-link target (e.g. "calendar-callback"); search carries params.
      const target = parsed.host;
      const search = parsed.search; // includes leading "?"
      const path =
        target === "calendar-callback"
          ? "/settings/calendars"
          : target === "connect-callback"
            ? "/settings/billing"
            : null;
      if (path) {
        window.location.assign(`${path}${search}`);
      }
    } catch {
      // Ignore malformed deep links.
    }
  });
}
