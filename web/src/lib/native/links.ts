"use client";

import { isNativeApp } from "./client";

const LINK_BASE = "https://www.bookuptempo.com";
const ALLOWED_WEB_ORIGINS = new Set([
  "https://bookuptempo.com",
  "https://www.bookuptempo.com",
]);

const CALLBACK_PATHS: Record<string, string> = {
  "calendar-callback": "/settings/calendars",
  "connect-callback": "/settings/billing",
};
const ALLOWED_SCHEMES = new Set(["uptempo-owner:", "uptempo-client:"]);
const SCHEME_APP_KIND: Record<string, NativeAppKind> = {
  "uptempo-owner:": "owner",
  "uptempo-client:": "client",
};
const COLD_LAUNCH_MARKER_KEY = "uptempo.native.cold-launch-process";
const consumedColdLaunchProcesses = new Set<string>();
let legacyColdLaunchConsumed = false;

const UNSAFE_RAW_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\\]/;
const ENCODED_UNSAFE_CHARACTERS = /%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/i;

function hasExplicitPort(value: string): boolean {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
  return !authority || authority.includes(":");
}

function hasUnsafeCharacters(value: string): boolean {
  if (
    UNSAFE_RAW_CHARACTERS.test(value) ||
    ENCODED_UNSAFE_CHARACTERS.test(value)
  ) {
    return true;
  }

  try {
    return UNSAFE_RAW_CHARACTERS.test(decodeURIComponent(value));
  } catch {
    return true;
  }
}

/**
 * Validate a same-origin path before using it in window.location.assign.
 * Encoded separators and controls are rejected too, since servers and routers
 * may decode a path after the browser has parsed it.
 */
export function safeNativeLocalPath(value: string): string | null {
  if (
    !value ||
    value.length > 4096 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafeCharacters(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, LINK_BASE);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (
      parsed.origin !== LINK_BASE ||
      decodedPath.startsWith("//") ||
      UNSAFE_RAW_CHARACTERS.test(decodedPath)
    ) {
      return null;
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

export type ResolvedNativeLink = {
  path: string;
  closeBrowser: boolean;
};

export type NativeAppKind = "client" | "owner";

function currentNativeAppKind(): NativeAppKind | undefined {
  if (typeof window === "undefined") return undefined;
  const kind = (window as unknown as { __UPTEMPO_NATIVE_APP__?: unknown })
    .__UPTEMPO_NATIVE_APP__;
  return kind === "client" || kind === "owner" ? kind : undefined;
}

function currentNativeLaunchId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = (window as unknown as {
    __UPTEMPO_NATIVE_LAUNCH_ID__?: unknown;
  }).__UPTEMPO_NATIVE_LAUNCH_ID__;
  return typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value)
    ? value
    : undefined;
}

/**
 * Persist only the opaque process ID, never the link or its query parameters.
 * Older shells and denied storage fall back to per-document memory plus the
 * current-location check below, which prevents a reload loop.
 */
function consumeColdLaunch(): boolean {
  const launchId = currentNativeLaunchId();
  if (!launchId) {
    if (legacyColdLaunchConsumed) return false;
    legacyColdLaunchConsumed = true;
    return true;
  }

  try {
    if (window.sessionStorage.getItem(COLD_LAUNCH_MARKER_KEY) === launchId) {
      return false;
    }
    window.sessionStorage.setItem(COLD_LAUNCH_MARKER_KEY, launchId);
    return true;
  } catch {
    if (consumedColdLaunchProcesses.has(launchId)) return false;
    consumedColdLaunchProcesses.add(launchId);
    return true;
  }
}

function currentLocalPath(): string | null {
  if (typeof window === "undefined") return null;
  return safeNativeLocalPath(
    window.location.pathname + window.location.search + window.location.hash,
  );
}

/**
 * Resolve a trusted Universal Link or one of the app's fixed OAuth return
 * callbacks to a local WebView path. No supplied URL can choose a destination
 * origin or an arbitrary custom scheme.
 */
export function resolveNativeLink(
  value: string,
  appKind: NativeAppKind | undefined = currentNativeAppKind(),
): ResolvedNativeLink | null {
  if (!value || value.length > 8192 || hasUnsafeCharacters(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.protocol === "https:" &&
    ALLOWED_WEB_ORIGINS.has(parsed.origin) &&
    !hasExplicitPort(value) &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === ""
  ) {
    const path = safeNativeLocalPath(
      parsed.pathname + parsed.search + parsed.hash,
    );
    return path ? { path, closeBrowser: false } : null;
  }

  if (
    !ALLOWED_SCHEMES.has(parsed.protocol) ||
    (appKind !== undefined && SCHEME_APP_KIND[parsed.protocol] !== appKind) ||
    hasExplicitPort(value) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    return null;
  }

  const targetPath = CALLBACK_PATHS[parsed.hostname];
  if (!targetPath) return null;

  const path = safeNativeLocalPath(
    targetPath + parsed.search + parsed.hash,
  );
  return path ? { path, closeBrowser: true } : null;
}

type PluginListener = { remove: () => Promise<void> | void };
type AppPlugin = {
  addListener?: (
    event: "appUrlOpen",
    callback: (data: { url: string }) => void,
  ) => Promise<PluginListener> | PluginListener;
  getLaunchUrl?: () => Promise<{ url?: string } | null>;
};
type BrowserPlugin = {
  close?: () => Promise<void>;
};

export type NativeLinkHandlers = {
  navigate?: (path: string) => void;
  closeBrowser?: () => Promise<void> | void;
};

export type NativeLinkCleanup = (() => void) & {
  navigationCompleted: () => void;
};

function noOpLinkCleanup(): NativeLinkCleanup {
  const cleanup = (() => {}) as NativeLinkCleanup;
  cleanup.navigationCompleted = () => {};
  return cleanup;
}

function nativePlugin<T>(name: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  return cap?.Plugins?.[name] as T | undefined;
}

function subscribeSafely(
  register: () => Promise<PluginListener> | PluginListener,
  signal: AbortSignal,
): () => void {
  let active = true;
  let listener: PluginListener | undefined;
  if (!signal.aborted) {
    try {
      void Promise.resolve(register())
        .then((created) => {
          if (active && !signal.aborted) listener = created;
          else {
            try {
              void Promise.resolve(created.remove()).catch(() => {});
            } catch {
              // Listener removal is best-effort.
            }
          }
        })
        .catch(() => {});
    } catch {
      // A later app open may retry listener setup.
    }
  }

  return () => {
    active = false;
    if (listener) {
      const current = listener;
      listener = undefined;
      try {
        void Promise.resolve(current.remove()).catch(() => {});
      } catch {
        // Listener removal is best-effort.
      }
    }
  };
}

/**
 * Listen for warm links and resolve the launch URL for cold starts. Capacitor
 * listeners are removed on abort, including the case where addListener
 * resolves after the React effect has already unmounted.
 */
export function handleNativeDeepLinks(
  signal?: AbortSignal,
  handlers: NativeLinkHandlers = {},
): NativeLinkCleanup {
  if (typeof window === "undefined" || !isNativeApp()) return noOpLinkCleanup();
  const app = nativePlugin<AppPlugin>("App");
  if (!app) return noOpLinkCleanup();

  const lifecycle = signal ?? new AbortController().signal;
  let active = !lifecycle.aborted;
  let cleaned = false;
  const pendingNavigationOrigins = new Map<string, string>();
  const removeListeners: Array<() => void> = [];

  const navigateLink = (rawUrl: string, source: "cold" | "warm") => {
    if (!active || lifecycle.aborted) return;
    const result = resolveNativeLink(rawUrl);
    if (!result) return;
    const firstColdDelivery = source === "cold" ? consumeColdLaunch() : true;

    if (result.closeBrowser) {
      try {
        const close =
          handlers.closeBrowser ??
          (() => nativePlugin<BrowserPlugin>("Browser")?.close?.());
        void Promise.resolve(close()).catch(() => {});
      } catch {
        // Returning to the WebView is still useful if Browser.close fails.
      }
    }

    if (!active || lifecycle.aborted) return;
    const currentPath = currentLocalPath();
    if (currentPath === result.path) {
      pendingNavigationOrigins.delete(result.path);
      return;
    }
    if (source === "cold" && !firstColdDelivery) return;

    if (pendingNavigationOrigins.has(result.path)) {
      const originalPath = pendingNavigationOrigins.get(result.path);
      if (originalPath === currentPath) return;
      // Navigation already completed elsewhere; a later identical warm link
      // is a new user action and must be allowed to route again.
      pendingNavigationOrigins.delete(result.path);
    }

    pendingNavigationOrigins.set(result.path, currentPath ?? "");
    try {
      (handlers.navigate ?? ((path) => window.location.assign(path)))(result.path);
    } catch {
      pendingNavigationOrigins.delete(result.path);
      // A failed navigation should not affect later link events.
    }
  };

  if (app.addListener) {
    const addListener = app.addListener;
    removeListeners.push(
      subscribeSafely(
        () =>
          addListener.call(app, "appUrlOpen", ({ url }) => {
            navigateLink(url, "warm");
          }),
        lifecycle,
      ),
    );
  }

  try {
    const launchUrl = app.getLaunchUrl?.();
    if (launchUrl) {
      void launchUrl
        .then((result) => {
          const url = result?.url;
          if (url) return navigateLink(url, "cold");
        })
        .catch(() => {});
    }
  } catch {
    // No initial URL is a normal launch.
  }

  const cleanup = (() => {
    if (cleaned) return;
    cleaned = true;
    active = false;
    for (const remove of removeListeners.splice(0)) remove();
    lifecycle.removeEventListener("abort", cleanup);
  }) as NativeLinkCleanup;
  cleanup.navigationCompleted = () => pendingNavigationOrigins.clear();
  if (lifecycle.aborted) cleanup();
  else lifecycle.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
