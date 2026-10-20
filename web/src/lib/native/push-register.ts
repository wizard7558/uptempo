"use client";

import { isNativeApp } from "./client";
import { safeNativeLocalPath } from "./links";

type PluginListener = { remove: () => Promise<void> | void };
type PushEventData = {
  value?: string;
  error?: string;
  isActive?: boolean;
  notification?: { data?: Record<string, unknown> };
};
type PushEventName =
  | "registration"
  | "registrationError"
  | "pushNotificationActionPerformed";
type PushPlugin = {
  requestPermissions?: () => Promise<{ receive?: string }>;
  register?: () => Promise<void>;
  addListener?: (
    event: PushEventName,
    callback: (data: PushEventData) => void,
  ) => Promise<PluginListener> | PluginListener;
};
type AppPlugin = {
  addListener?: (
    event: "appStateChange",
    callback: (data: { isActive: boolean }) => void,
  ) => Promise<PluginListener> | PluginListener;
};

function plugin<T>(name: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  return cap?.Plugins?.[name] as T | undefined;
}

const TOKEN_STORAGE_KEY = "uptempo.apnsToken";
const STORAGE_PROBE_KEY = "uptempo.apnsStorageProbe";
export const NATIVE_AUTH_SUCCESS_EVENT = "uptempo:native-auth-success";

let pushSessionVersion = 0;
let logoutPending = false;
const registeredTokens = new Set<string>();
const registrationOperations = new Map<string, Promise<void>>();
const pushSessionInvalidators = new Set<() => void>();

function apnsEnvironment(): "sandbox" | "production" {
  const value = (window as unknown as { __APNS_ENV__?: string }).__APNS_ENV__;
  return value === "sandbox" ? "sandbox" : "production";
}

function storageAvailable(): boolean {
  try {
    localStorage.setItem(STORAGE_PROBE_KEY, "1");
    localStorage.removeItem(STORAGE_PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

type SafeSubscription = {
  ready: Promise<boolean>;
  cleanup: () => void;
};

function listenSafely<T>(
  register: (callback: (data: T) => void) => Promise<PluginListener> | PluginListener,
  signal: AbortSignal,
  callback: (data: T) => void,
): SafeSubscription {
  let active = true;
  let listener: PluginListener | undefined;
  let readySettled = false;
  let resolveReady!: (ready: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });
  const settleReady = (value: boolean) => {
    if (readySettled) return;
    readySettled = true;
    resolveReady(value);
  };
  const removeListener = () => {
    const current = listener;
    listener = undefined;
    if (current) {
      try {
        void Promise.resolve(current.remove()).catch(() => {});
      } catch {
        // Listener removal is best-effort.
      }
    }
  };

  if (!signal.aborted) {
    try {
      void Promise.resolve(
        register((data) => {
          if (active && !signal.aborted) callback(data);
        }),
      )
        .then((created) => {
          if (active && !signal.aborted) {
            listener = created;
            settleReady(true);
          } else {
            try {
              void Promise.resolve(created.remove()).catch(() => {});
            } catch {
              // Listener removal is best-effort.
            }
            settleReady(false);
          }
        })
        .catch(() => settleReady(false));
    } catch {
      // Plugin setup is best-effort; a later foreground or login event retries.
      settleReady(false);
    }
  } else {
    settleReady(false);
  }

  const cleanup = () => {
    active = false;
    settleReady(false);
    removeListener();
  };
  return { ready, cleanup };
}

async function revokeToken(token: string): Promise<void> {
  try {
    const response = await fetch("/api/push/register", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apnsToken: token }),
    });
    if (!response.ok) return;

    registeredTokens.delete(token);
    try {
      if (localStorage.getItem(TOKEN_STORAGE_KEY) === token) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // The server-side revoke succeeded even if local storage is unavailable.
    }
  } catch {
    // Keep the token so a later sign-out can retry the revoke.
  }
}

function saveRegisteredToken(
  token: string,
  isCurrent: () => boolean,
): Promise<void> {
  const previous = registrationOperations.get(token) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    // A newer auth/foreground attempt is queued behind stale work. Skip it if
    // sign-out or another retry made this callback obsolete before its turn.
    if (!isCurrent()) return;

    try {
      const response = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apnsToken: token,
          environment: apnsEnvironment(),
        }),
      });
      if (!response.ok) return;

      registeredTokens.add(token);
      if (!isCurrent()) {
        await revokeToken(token);
        return;
      }

      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } catch {
        await revokeToken(token);
      }
    } catch {
      // Do not store a token the server did not confirm.
    }
  });

  registrationOperations.set(token, operation);
  void operation.finally(() => {
    if (registrationOperations.get(token) === operation) {
      registrationOperations.delete(token);
    }
  });
  return operation;
}

/**
 * Notify the native bridge after an existing web session flow succeeds. The
 * bridge then verifies the cookie with the server before requesting push.
 */
export function notifyNativeAuthSuccess(): void {
  if (!isNativeApp() || typeof window === "undefined") return;
  logoutPending = false;
  window.dispatchEvent(new Event(NATIVE_AUTH_SUCCESS_EVENT));
}

/**
 * Install the native push lifecycle. Permission is requested only after a
 * read-only server check confirms a client booking session or owner session.
 * The returned cleanup removes listeners and invalidates pending async work.
 */
export function registerNativePush(signal?: AbortSignal): () => void {
  if (!isNativeApp()) return () => {};

  const push = plugin<PushPlugin>("PushNotifications");
  const app = plugin<AppPlugin>("App");
  if (!push?.register || !push.requestPermissions || !push.addListener) {
    return () => {};
  }

  const lifecycle = signal ?? new AbortController().signal;
  let active = !lifecycle.aborted;
  let nextAttemptId = 0;
  let nextRequestId = 0;
  let requestedChecks = 0;
  let completedChecks = 0;
  let checksRunning = false;
  let authorized: {
    attemptId: number;
    requestId: number;
    sessionVersion: number;
  } | null = null;
  const removeListeners: Array<() => void> = [];
  let registrationSubscription: SafeSubscription | null = null;
  let registrationSetup: Promise<boolean> | null = null;

  const isCurrent = (
    attemptId: number,
    requestId: number,
    sessionVersion: number,
  ) =>
    active &&
    !lifecycle.aborted &&
    !logoutPending &&
    attemptId === nextAttemptId &&
    requestId === nextRequestId &&
    requestId === requestedChecks &&
    sessionVersion === pushSessionVersion;

  const listenPush = (
    event: PushEventName,
    callback: (data: PushEventData) => void,
  ): SafeSubscription | null => {
    const addListener = push.addListener;
    if (!addListener) return null;
    const subscription = listenSafely<PushEventData>(
      (handler) => addListener.call(push, event, handler),
      lifecycle,
      callback,
    );
    removeListeners.push(subscription.cleanup);
    return subscription;
  };

  const ensureRegistrationListener = (): Promise<boolean> => {
    if (registrationSubscription) return registrationSubscription.ready;
    if (registrationSetup) return registrationSetup;

    const subscription = listenPush("registration", ({ value }) => {
      if (!value || !/^[0-9a-fA-F]{32,200}$/.test(value)) return;
      const current = authorized;
      if (!current) return;
      void saveRegisteredToken(value, () =>
        isCurrent(
          current.attemptId,
          current.requestId,
          current.sessionVersion,
        ) &&
        authorized?.attemptId === current.attemptId &&
        authorized?.requestId === current.requestId,
      );
    });
    if (!subscription) return Promise.resolve(false);

    registrationSubscription = subscription;
    const ready = subscription.ready.then((available) => {
      if (!available && registrationSubscription === subscription) {
        registrationSubscription = null;
        const cleanupIndex = removeListeners.indexOf(subscription.cleanup);
        if (cleanupIndex >= 0) removeListeners.splice(cleanupIndex, 1);
        subscription.cleanup();
      }
      return available;
    });
    registrationSetup = ready;
    void ready.finally(() => {
      if (registrationSetup === ready) registrationSetup = null;
    });
    return ready;
  };

  const runCheck = async (
    attemptId: number,
    requestId: number,
    sessionVersion: number,
  ) => {
    authorized = null;

    const response = await fetch("/api/push/register", {
      method: "GET",
      cache: "no-store",
      signal: lifecycle,
    });
    if (!response.ok || !isCurrent(attemptId, requestId, sessionVersion)) {
      return;
    }

    const result = (await response.json().catch(() => null)) as
      | { authenticated?: unknown }
      | null;
    if (
      result?.authenticated !== true ||
      !isCurrent(attemptId, requestId, sessionVersion)
    ) {
      return;
    }

    const canReceiveToken = await ensureRegistrationListener();
    if (
      !canReceiveToken ||
      !isCurrent(attemptId, requestId, sessionVersion) ||
      !storageAvailable()
    ) {
      return;
    }

    const permission = await push.requestPermissions?.();
    if (
      permission?.receive !== "granted" ||
      !isCurrent(attemptId, requestId, sessionVersion)
    ) {
      return;
    }

    authorized = { attemptId, requestId, sessionVersion };
    try {
      await push.register?.();
    } catch {
      if (authorized?.attemptId === attemptId) authorized = null;
    }
  };

  const drainChecks = async () => {
    if (checksRunning || !active) return;
    checksRunning = true;
    while (active && completedChecks < requestedChecks) {
      const requestId = requestedChecks;
      const attemptId = ++nextAttemptId;
      const sessionVersion = pushSessionVersion;
      completedChecks = requestId;
      try {
        await runCheck(attemptId, requestId, sessionVersion);
      } catch {
        // A network or plugin failure leaves push disabled until a retry event.
      }
    }
    checksRunning = false;
    if (active && completedChecks < requestedChecks) void drainChecks();
  };

  const requestCheck = (reason: "launch" | "login" | "foreground") => {
    if (!active || lifecycle.aborted) return;
    if (reason === "login") logoutPending = false;
    if (logoutPending) return;
    requestedChecks += 1;
    nextRequestId = requestedChecks;
    void drainChecks();
  };

  listenPush("registrationError", () => {
    authorized = null;
  });
  listenPush("pushNotificationActionPerformed", ({ notification }) => {
    const path = notification?.data?.path;
    if (typeof path !== "string") return;
    const safePath = safeNativeLocalPath(path);
    if (safePath) window.location.assign(safePath);
  });

  if (app?.addListener) {
    const addListener = app.addListener;
    const subscription = listenSafely<{ isActive: boolean }>(
        (handler) =>
          addListener.call(app, "appStateChange", ({ isActive }) =>
            handler({ isActive }),
          ),
        lifecycle,
        ({ isActive }) => {
          if (isActive) requestCheck("foreground");
        },
      );
    removeListeners.push(subscription.cleanup);
  }

  const handleAuthSuccess = () => requestCheck("login");
  window.addEventListener(NATIVE_AUTH_SUCCESS_EVENT, handleAuthSuccess);

  const invalidate = () => {
    authorized = null;
    nextAttemptId += 1;
    completedChecks = requestedChecks;
  };
  pushSessionInvalidators.add(invalidate);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    active = false;
    invalidate();
    pushSessionInvalidators.delete(invalidate);
    window.removeEventListener(NATIVE_AUTH_SUCCESS_EVENT, handleAuthSuccess);
    for (const remove of removeListeners.splice(0)) remove();
    lifecycle.removeEventListener("abort", cleanup);
  };
  if (lifecycle.aborted) cleanup();
  else lifecycle.addEventListener("abort", cleanup, { once: true });

  requestCheck("launch");
  return cleanup;
}

/**
 * Revoke the stored APNs token before signing out. Failed DELETE responses
 * retain the token locally so a later sign-out can retry.
 */
export async function revokeNativePush(): Promise<void> {
  if (!isNativeApp()) return;

  pushSessionVersion += 1;
  logoutPending = true;
  for (const invalidate of pushSessionInvalidators) invalidate();

  await Promise.allSettled([...registrationOperations.values()]);

  const tokens = new Set(registeredTokens);
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) tokens.add(stored);
  } catch {
    // Continue with tokens retained in memory from confirmed registrations.
  }
  await Promise.all([...tokens].map((token) => revokeToken(token)));
}
