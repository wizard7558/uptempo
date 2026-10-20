// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import {
  notifyNativeAuthSuccess,
  registerNativePush,
  revokeNativePush,
} from "./push-register";

const TOKEN = "a".repeat(64);

type PluginEvent = {
  value?: string;
  isActive?: boolean;
  url?: string;
  notification?: { data?: Record<string, unknown> };
};
type PluginCallback = (event: PluginEvent) => void;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function installNativePlugins(options?: {
  permission?: "granted" | "denied";
  deferListeners?: boolean;
  failRegistrationListenerOnce?: boolean;
  failRegisterOnce?: boolean;
}) {
  const pushListeners = new Map<string, Set<PluginCallback>>();
  const appListeners = new Map<string, Set<PluginCallback>>();
  let registrationListenerFailed = false;
  let registerFailed = false;
  const pendingListeners: Array<{
    callback: PluginCallback;
    resolve: (listener: { remove: () => void }) => void;
  }> = [];

  const addListener = (
    bucket: Map<string, Set<PluginCallback>>,
    event: string,
    callback: PluginCallback,
  ) => {
    if (
      event === "registration" &&
      options?.failRegistrationListenerOnce &&
      !registrationListenerFailed
    ) {
      registrationListenerFailed = true;
      return Promise.reject(new Error("native listener unavailable"));
    }

    const listeners = bucket.get(event) ?? new Set<PluginCallback>();
    listeners.add(callback);
    bucket.set(event, listeners);
    const remove = vi.fn(() => listeners.delete(callback));
    const handle = { remove };
    if (options?.deferListeners) {
      return new Promise<{ remove: () => void }>((resolve) => {
        pendingListeners.push({ callback, resolve });
      });
    }
    return handle;
  };

  const push = {
    requestPermissions: vi.fn(async () => ({
      receive: options?.permission ?? "granted",
    })),
    register: vi.fn(async () => {
      if (options?.failRegisterOnce && !registerFailed) {
        registerFailed = true;
        throw new Error("native registration failed");
      }
      for (const callback of pushListeners.get("registration") ?? []) {
        callback({ value: TOKEN });
      }
    }),
    addListener: vi.fn(
      (event: string, callback: PluginCallback) =>
        addListener(pushListeners, event, callback),
    ),
  };
  const app = {
    addListener: vi.fn(
      (event: string, callback: PluginCallback) =>
        addListener(appListeners, event, callback),
    ),
    getLaunchUrl: vi.fn(async () => null),
  };

  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true, Plugins: { PushNotifications: push, App: app } },
  });

  return { push, app, pushListeners, appListeners, pendingListeners };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  Reflect.deleteProperty(window, "Capacitor");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native push lifecycle", () => {
  it("does nothing on web", () => {
    const permissions = vi.fn();
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        isNativePlatform: () => false,
        Plugins: { PushNotifications: { requestPermissions: permissions } },
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    registerNativePush();
    notifyNativeAuthSuccess();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissions).not.toHaveBeenCalled();
  });

  it("does not prompt on a public launch and retries after successful same-launch OTP auth", async () => {
    const plugins = installNativePlugins();
    const getResponses = [
      jsonResponse({ authenticated: false }, 401),
      jsonResponse({ authenticated: true }),
    ];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return getResponses.shift()!;
      if (init?.method === "POST") return jsonResponse({ success: true });
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(plugins.push.requestPermissions).not.toHaveBeenCalled();
    expect(plugins.push.register).not.toHaveBeenCalled();

    notifyNativeAuthSuccess();
    await waitFor(() =>
      expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN),
    );
    expect(plugins.push.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugins.push.register).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
    stop();
  });

  it("does not persist a failed POST and retries on foreground", async () => {
    const plugins = installNativePlugins();
    let postCount = 0;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      if (init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ success: postCount > 1 }, postCount > 1 ? 200 : 503);
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() => expect(postCount).toBe(1));
    expect(localStorage.getItem("uptempo.apnsToken")).toBeNull();

    for (const callback of plugins.appListeners.get("appStateChange") ?? []) {
      callback({ isActive: true });
    }
    await waitFor(() =>
      expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN),
    );
    expect(postCount).toBe(2);
    stop();
  });

  it("does not register when push permission is denied", async () => {
    const plugins = installNativePlugins({ permission: "denied" });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() =>
      expect(plugins.push.requestPermissions).toHaveBeenCalledTimes(1),
    );
    expect(plugins.push.register).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
    expect(localStorage.getItem("uptempo.apnsToken")).toBeNull();
    stop();
  });

  it("retries a failed registration listener on the next foreground check", async () => {
    const plugins = installNativePlugins({ failRegistrationListenerOnce: true });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() =>
      expect(plugins.push.addListener).toHaveBeenCalledWith(
        "registration",
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(plugins.push.requestPermissions).not.toHaveBeenCalled();

    for (const callback of plugins.appListeners.get("appStateChange") ?? []) {
      callback({ isActive: true });
    }
    await waitFor(() =>
      expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN),
    );
    expect(plugins.push.addListener).toHaveBeenCalledTimes(4);
    expect(plugins.push.requestPermissions).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps a native registration exception from persisting a token and retries", async () => {
    const plugins = installNativePlugins({ failRegisterOnce: true });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() => expect(plugins.push.register).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem("uptempo.apnsToken")).toBeNull();

    for (const callback of plugins.appListeners.get("appStateChange") ?? []) {
      callback({ isActive: true });
    }
    await waitFor(() =>
      expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN),
    );
    expect(plugins.push.register).toHaveBeenCalledTimes(2);
    stop();
  });

  it("serializes a new foreground registration behind stale POST cleanup", async () => {
    const plugins = installNativePlugins();
    notifyNativeAuthSuccess();
    const firstPost = deferred<Response>();
    let postCount = 0;
    let deleteCount = 0;
    let concurrentPosts = 0;
    let maxConcurrentPosts = 0;
    let serverTokenActive = false;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      if (init?.method === "POST") {
        postCount += 1;
        concurrentPosts += 1;
        maxConcurrentPosts = Math.max(maxConcurrentPosts, concurrentPosts);
        const response = postCount === 1
          ? await firstPost.promise
          : jsonResponse({ success: true });
        serverTokenActive = true;
        concurrentPosts -= 1;
        return response;
      }
      if (init?.method === "DELETE") {
        deleteCount += 1;
        serverTokenActive = false;
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() => expect(postCount).toBe(1));
    for (const callback of plugins.appListeners.get("appStateChange") ?? []) {
      callback({ isActive: true });
    }
    await waitFor(() => expect(plugins.push.register).toHaveBeenCalledTimes(2));
    expect(postCount).toBe(1);
    expect(maxConcurrentPosts).toBe(1);

    firstPost.resolve(jsonResponse({ success: true }));
    await waitFor(() =>
      expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN),
    );

    expect(postCount).toBe(2);
    expect(deleteCount).toBe(1);
    expect(maxConcurrentPosts).toBe(1);
    expect(serverTokenActive).toBe(true);
    stop();
  });

  it("revokes a pending successful POST when sign-out wins the race", async () => {
    const plugins = installNativePlugins();
    notifyNativeAuthSuccess();
    const firstPost = deferred<Response>();
    let postCount = 0;
    let deleteCount = 0;
    let serverTokenActive = false;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      if (init?.method === "POST") {
        postCount += 1;
        const response = await firstPost.promise;
        serverTokenActive = true;
        return response;
      }
      if (init?.method === "DELETE") {
        deleteCount += 1;
        serverTokenActive = false;
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() => expect(postCount).toBe(1));
    const signOut = revokeNativePush();
    const callsAfterSignOut = fetchMock.mock.calls.length;
    for (const callback of plugins.appListeners.get("appStateChange") ?? []) {
      callback({ isActive: true });
    }
    firstPost.resolve(jsonResponse({ success: true }));
    await signOut;

    expect(fetchMock.mock.calls.length).toBe(callsAfterSignOut + 1);
    expect(postCount).toBe(1);
    expect(deleteCount).toBe(1);
    expect(serverTokenActive).toBe(false);
    expect(localStorage.getItem("uptempo.apnsToken")).toBeNull();
    stop();
  });

  it("cleans listeners and revokes a stale POST after lifecycle cleanup", async () => {
    const plugins = installNativePlugins();
    notifyNativeAuthSuccess();
    const firstPost = deferred<Response>();
    let postCount = 0;
    let deleteCount = 0;
    let serverTokenActive = false;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      if (init?.method === "POST") {
        postCount += 1;
        const response = await firstPost.promise;
        serverTokenActive = true;
        return response;
      }
      if (init?.method === "DELETE") {
        deleteCount += 1;
        serverTokenActive = false;
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const stop = registerNativePush(controller.signal);
    await waitFor(() => expect(postCount).toBe(1));
    controller.abort();
    stop();
    expect([...plugins.pushListeners.values()].every((set) => set.size === 0)).toBe(true);
    expect([...plugins.appListeners.values()].every((set) => set.size === 0)).toBe(true);

    firstPost.resolve(jsonResponse({ success: true }));
    await waitFor(() => expect(deleteCount).toBe(1));
    expect(postCount).toBe(1);
    expect(serverTokenActive).toBe(false);
    expect(localStorage.getItem("uptempo.apnsToken")).toBeNull();
  });

  it("does not request permission when token storage is unavailable", async () => {
    const plugins = installNativePlugins();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "uptempo.apnsStorageProbe") {
        throw new Error("storage unavailable");
      }
      return originalSetItem.call(this, key, value);
    });

    const stop = registerNativePush();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(1),
    );
    await Promise.resolve();
    expect(plugins.push.requestPermissions).not.toHaveBeenCalled();
    expect(plugins.push.register).not.toHaveBeenCalled();
    stop();
  });

  it("keeps the token after a failed DELETE and disables old listeners during sign-out", async () => {
    const plugins = installNativePlugins();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse({ authenticated: true });
      if (init?.method === "POST") return jsonResponse({ success: true });
      if (init?.method === "DELETE") return jsonResponse({ success: false }, 503);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = registerNativePush();
    await waitFor(() =>
      expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN),
    );
    await revokeNativePush();
    expect(localStorage.getItem("uptempo.apnsToken")).toBe(TOKEN);

    const requestCountAfterSignOut = fetchMock.mock.calls.length;
    for (const callback of plugins.appListeners.get("appStateChange") ?? []) {
      callback({ isActive: true });
    }
    for (const callback of plugins.pushListeners.get("registration") ?? []) {
      callback({ value: TOKEN });
    }
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterSignOut);

    stop();
    notifyNativeAuthSuccess();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterSignOut);
  });

  it("removes listeners that resolve after lifecycle cleanup", async () => {
    const plugins = installNativePlugins({ deferListeners: true });
    const fetchMock = vi.fn(async () => jsonResponse({ authenticated: false }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const stop = registerNativePush(controller.signal);

    controller.abort();
    stop();
    const removals: Array<ReturnType<typeof vi.fn>> = [];
    for (const pending of plugins.pendingListeners) {
      const remove = vi.fn();
      removals.push(remove);
      pending.resolve({ remove });
    }
    await waitFor(() =>
      expect(removals).toHaveLength(plugins.pendingListeners.length),
    );
    await Promise.resolve();

    for (const pending of plugins.pendingListeners) {
      pending.callback({ value: TOKEN, isActive: true });
    }
    await Promise.resolve();
    expect(removals.every((remove) => remove.mock.calls.length === 1)).toBe(true);
    expect(plugins.push.requestPermissions).not.toHaveBeenCalled();
    expect(localStorage.getItem("uptempo.apnsToken")).toBeNull();
  });
});
