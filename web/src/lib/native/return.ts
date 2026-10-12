/**
 * Helpers for handing control back to a native iOS app (Capacitor) after a
 * flow that must run in the system browser (Google Calendar OAuth, Stripe
 * Connect onboarding). Web behavior is unchanged; these are only used when a
 * flow was initiated from inside the native app.
 *
 * The native shells register custom URL schemes; redirecting the system
 * browser to `<scheme>://<path>` hands control back to the app, which then
 * closes the browser and routes its WebView to the right screen.
 */

export type NativeApp = "owner" | "client";

const SCHEMES: Record<NativeApp, string> = {
  owner: (process.env.NATIVE_OWNER_URL_SCHEME ?? "uptempo-owner").trim(),
  client: (process.env.NATIVE_CLIENT_URL_SCHEME ?? "uptempo-client").trim(),
};

/** Deep-link return targets the native shells know how to handle. */
export const NATIVE_RETURN_PATHS = [
  "calendar-callback",
  "connect-callback",
] as const;
export type NativeReturnPath = (typeof NATIVE_RETURN_PATHS)[number];

export function isNativeApp(value: string | null | undefined): value is NativeApp {
  return value === "owner" || value === "client";
}

export function isNativeReturnPath(
  value: string | null | undefined,
): value is NativeReturnPath {
  return (NATIVE_RETURN_PATHS as readonly string[]).includes(value ?? "");
}

/** Build a custom-scheme deep link, e.g. `uptempo-owner://calendar-callback?connected=123`. */
export function buildNativeReturnUrl(
  app: NativeApp,
  path: NativeReturnPath,
  params: Record<string, string | undefined> = {},
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, v);
  }
  const query = qs.toString();
  return `${SCHEMES[app]}://${path}${query ? `?${query}` : ""}`;
}
