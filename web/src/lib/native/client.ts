"use client";

/**
 * Client-side helpers for detecting the Capacitor native runtime and opening
 * URLs in the system browser. We intentionally do NOT take a build dependency
 * on `@capacitor/*` packages here — the native shells inject the Capacitor
 * bridge (`window.Capacitor`) at runtime, so we reach it through the global.
 * On the plain web these helpers degrade gracefully (native = false, open =
 * normal navigation).
 */

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Browser?: { open?: (opts: { url: string }) => Promise<void> };
  };
};

function bridge(): CapacitorBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
}

/** True only when running inside a Capacitor native shell (iOS app). */
export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

/**
 * Open a URL in the system browser (ASWebAuthenticationSession on iOS) when
 * running natively, so flows like Google OAuth that refuse embedded WebViews
 * work. Falls back to normal navigation on the web.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
  const open = bridge()?.Plugins?.Browser?.open;
  if (open) {
    await open({ url });
  } else if (typeof window !== "undefined") {
    window.location.href = url;
  }
}
